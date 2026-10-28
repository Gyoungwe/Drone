import { randomBytes } from "node:crypto";
import { realpath } from "node:fs/promises";
import {
	type ContainerSandboxOptions,
	ContainerSandboxRunner,
	describeContainerExecution,
	type ExecutionIdentity,
	ExecutionTransactions,
	NodeExecutionReceiptStorage,
	prepareSandboxRunDirectory,
	type SignedExecutionReceipt,
} from "@gyoungwe/plugin-api/node/execution";
import type { PluginExecutionInput } from "@gyoungwe/plugin-api/runtime";
import { Type } from "typebox";
import { JsonStore } from "../json-store";
import { canonicalProjectId } from "../project-id";
import { hostText } from "../reply-language";
import type { StorageRegistry } from "../storage/registry";
import type { PluginCapabilityContext, PluginCapabilityHandler } from "./runtime-capabilities";
import type { PluginSessionCallerContext } from "./session-caller";

export interface PluginExecutionCapabilitiesOptions {
	readonly directory: string;
	readonly sourceIdentity: string;
	readonly integrityKey: Uint8Array;
	readonly storage: StorageRegistry;
	getSessionContext(sessionId: string): PluginSessionCallerContext | undefined;
	/** Host-configured images only; acceptance supplies an already-cached exact identity. */
	readonly container?: Omit<ContainerSandboxOptions, "projectRoot" | "process">;
}
const id = Type.String({ minLength: 1, maxLength: 128, pattern: "^[a-zA-Z0-9._-]+$" });
const language = Type.Union([Type.Literal("python"), Type.Literal("r")]);
const image = Type.String({ pattern: "^sha256:[a-f0-9]{64}$" });
const status = Type.Union(
	["accepted", "succeeded", "failed", "cancelled", "cleanup-failed"].map((value) => Type.Literal(value)),
);
const classification = Type.Union(
	["public", "internal", "controlled", "restricted"].map((value) => Type.Literal(value)),
);
const receipt = Type.Object(
	{
		id,
		requestId: id,
		language,
		codeSha256: Type.String({ pattern: "^[a-f0-9]{64}$" }),
		runDirectory: Type.String({ minLength: 1 }),
		image,
		status,
		acceptedAt: Type.String(),
		finishedAt: Type.Optional(Type.String()),
		exitCode: Type.Optional(Type.Integer()),
		durationMs: Type.Optional(Type.Number({ minimum: 0 })),
		producedBytes: Type.Optional(Type.Integer({ minimum: 0 })),
	},
	{ additionalProperties: false },
);
const result = Type.Object(
	{
		exitCode: Type.Integer(),
		durationMs: Type.Number({ minimum: 0 }),
		producedBytes: Type.Integer({ minimum: 0 }),
		outputs: Type.Array(
			Type.Object(
				{
					text: Type.String(),
					contentKind: Type.Union(["summary", "plot", "table", "raw"].map((value) => Type.Literal(value))),
					classification,
				},
				{ additionalProperties: false },
			),
		),
	},
	{ additionalProperties: false },
);

/** Optional execution owns only accepted transactions, independent of any research plugin. */
export async function createPluginExecutionCapabilities(
	options: PluginExecutionCapabilitiesOptions,
): Promise<{
	handlers: Readonly<
		Record<"execution.run" | "execution.describe" | "execution.receipt", PluginCapabilityHandler>
	>;
	dispose(): Promise<void>;
}> {
	const storage = await NodeExecutionReceiptStorage.create(
		options.directory,
		options.integrityKey,
		async (path, value, boundary) => {
			const registered = options.storage.registerDiscoveredRoot(
				"plugin-execution-receipt",
				path,
				"plugins/execution-capabilities",
				"private",
			);
			await new JsonStore<SignedExecutionReceipt>({
				path,
				storageId: registered.id,
				defaultValue: () => {
					throw new Error("Execution receipt is missing");
				},
				mode: 0o600,
			}).writeChecked(value, boundary);
		},
	);
	const transactions = new ExecutionTransactions(storage);
	function caller(context: PluginCapabilityContext): PluginSessionCallerContext {
		context.signal.throwIfAborted();
		if (context.scope.kind !== "session") throw new Error("Execution requires a selected live session");
		const selected = options.getSessionContext(context.scope.sessionId);
		if (
			!selected ||
			selected.identity !== context.callerIdentity ||
			selected.signal.aborted ||
			selected.readOnly ||
			!selected.projectTrusted ||
			selected.scope.workspaceId !== context.scope.workspaceId
		)
			throw new Error("Execution caller is stale, read-only, untrusted or belongs to another workspace");
		return selected;
	}
	const identity = (
		context: PluginCapabilityContext,
		selected: PluginSessionCallerContext,
	): ExecutionIdentity => ({
		pluginId: context.pluginId,
		sourceIdentity: options.sourceIdentity,
		applicationId: context.applicationId,
		sessionId: selected.scope.sessionId,
		workspaceId: selected.scope.workspaceId,
	});
	return {
		dispose: () => transactions.drain(),
		handlers: {
			"execution.describe": {
				effect: "read",
				inputSchema: Type.Null(),
				resultSchema: Type.Object(
					{
						kind: Type.Union([Type.Literal("container"), Type.Literal("unavailable")]),
						images: Type.Object(
							{ python: Type.Optional(image), r: Type.Optional(image) },
							{ additionalProperties: false },
						),
						networkDisabled: Type.Literal(true),
						writesOnlyToRunDirectory: Type.Literal(true),
					},
					{ additionalProperties: false },
				),
				execute: async (_input, context) => {
					caller(context);
					const available = await describeContainerExecution(options.container);
					caller(context);
					return {
						kind: Object.keys(available.images).length ? "container" : "unavailable",
						images: available.images,
						networkDisabled: true,
						writesOnlyToRunDirectory: true,
					};
				},
			},
			"execution.receipt": {
				effect: "read",
				inputSchema: Type.Object({ requestId: id }, { additionalProperties: false }),
				resultSchema: Type.Union([
					Type.Object({ kind: Type.Literal("missing") }, { additionalProperties: false }),
					Type.Object({ kind: Type.Literal("value"), receipt }, { additionalProperties: false }),
				]),
				execute: async (input, context) => {
					const selected = caller(context);
					const value = await transactions.receipt(
						identity(context, selected),
						(input as { requestId: string }).requestId,
					);
					caller(context);
					return value;
				},
			},
			"execution.run": {
				effect: "write",
				inputSchema: Type.Object(
					{
						requestId: id,
						language,
						code: Type.String({ minLength: 1, maxLength: 1_000_000, pattern: "^[^\\u0000]+$" }),
						runDirectory: Type.String({ minLength: 6, maxLength: 4096, pattern: "^runs/[^\\u0000]+$" }),
						image,
						timeoutMs: Type.Integer({ minimum: 1, maximum: 120_000 }),
						maxOutputBytes: Type.Integer({ minimum: 1, maximum: 1_000_000 }),
						dataClassification: classification,
					},
					{ additionalProperties: false },
				),
				resultSchema: Type.Object({ receipt, result }, { additionalProperties: false }),
				approvalDetail: (input) => {
					const request = input as PluginExecutionInput;
					return hostText(
						`受限容器执行\n请求：${request.requestId}\n语言：${request.language}\n工作区相对目录：${request.runDirectory}\n精确缓存镜像：${request.image}\n数据分类：${request.dataClassification}\n超时毫秒：${request.timeoutMs}\n输出字节上限：${request.maxOutputBytes}\n禁用网络；唯一可写挂载为该 runs 子目录；不拉取镜像。\n代码：\n${request.code}`,
						`Bounded container execution\nrequestId: ${request.requestId}\nlanguage: ${request.language}\nworkspace-relative directory: ${request.runDirectory}\nexact cached image: ${request.image}\ndata classification: ${request.dataClassification}\ntimeoutMs: ${request.timeoutMs}\nmaxOutputBytes: ${request.maxOutputBytes}\nnetwork: disabled; writable mount: this runs directory only; pull: never\nCode:\n${request.code}`,
					);
				},
				execute: async (input, context) => {
					const request = input as PluginExecutionInput;
					const selected = caller(context);
					const workspace = await realpath(selected.scope.workspaceDirectory);
					if (canonicalProjectId(workspace) !== selected.scope.workspaceId)
						throw new Error("Execution workspace identity changed");
					const available = await describeContainerExecution({
						...options.container,
						pythonImage: request.image,
						rImage: request.image,
					});
					if (!available.runtime || available.images[request.language] !== request.image)
						throw new Error("Requested exact container image is not cached; no image was pulled");
					await prepareSandboxRunDirectory(workspace, request.runDirectory, context.signal);
					const runner = await ContainerSandboxRunner.create({
						...options.container,
						runtime: available.runtime,
						projectRoot: workspace,
						pythonImage: request.image,
						rImage: request.image,
					});
					if (!runner) throw new Error("Container runtime became unavailable after approval");
					if (
						caller(context).identity !== selected.identity ||
						(await realpath(selected.scope.workspaceDirectory)) !== workspace
					)
						throw new Error("Execution caller or workspace changed after approval");
					return transactions.run(request, identity(context, selected), runner, context.signal);
				},
			},
		},
	};
}

/** One key per application bridge; never a global ledger or worker-visible grant. */
export const createExecutionIntegrityKey = () => randomBytes(32);
