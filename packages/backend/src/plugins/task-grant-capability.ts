import { randomUUID } from "node:crypto";
import { hostText } from "../reply-language";
import type { SessionDirectory } from "../session/registry";
import type { PluginRuntimeSource } from "./coordinator";
import type { PluginCapabilityHandler } from "./runtime-capabilities";
import { requirePluginSession } from "./session-caller";
import {
	MAX_TASK_WRITE_ROOTS,
	resolveTaskWriteRoots,
	type TaskGrant,
	type TaskGrantStore,
} from "./task-grants";

/** Plugin-facing capabilities and the host consent dialog for task grants (see task-grants.ts). */

export const continuationType = (pluginId: string) => `plugin-continue:${encodeURIComponent(pluginId)}`;

const text = (max: number) => ({ type: "string", minLength: 1, maxLength: max });
const requestSchema = {
	type: "object",
	properties: {
		taskId: text(128),
		contractHash: { type: "string", pattern: "^[0-9a-f]{64}$" },
		goal: text(2000),
		summary: text(2000),
		writeDirectories: { type: "array", items: text(512), maxItems: MAX_TASK_WRITE_ROOTS },
		acceptance: { type: "array", items: text(500), maxItems: 32 },
		compute: text(2000),
		maxCalls: { type: "integer", minimum: 1, maximum: 1000 },
		maxAutoResumes: { type: "integer", minimum: 0, maximum: 19 },
		allowances: {
			type: "array",
			maxItems: 24,
			items: {
				type: "object",
				properties: { id: text(128), role: text(128), member: text(128), label: text(300), consent: {} },
				required: ["id", "role", "member", "label"],
				additionalProperties: false,
			},
		},
	},
	required: [
		"taskId",
		"contractHash",
		"goal",
		"writeDirectories",
		"acceptance",
		"maxCalls",
		"maxAutoResumes",
	],
	additionalProperties: false,
};
interface TaskGrantRequest {
	readonly taskId: string;
	readonly contractHash: string;
	readonly goal: string;
	readonly summary?: string;
	readonly writeDirectories: readonly string[];
	readonly acceptance: readonly string[];
	readonly compute?: string;
	readonly maxCalls: number;
	readonly maxAutoResumes: number;
	readonly allowances?: readonly {
		id: string;
		role: string;
		member: string;
		label: string;
		consent?: unknown;
	}[];
}
const MAX_CONSENT_JSON = 4000;
const grantSchema = {
	type: "object",
	properties: {
		grantId: { type: "string" },
		taskId: { type: "string" },
		contractHash: { type: "string" },
		writeRoots: { type: "array", items: { type: "string" } },
		maxCalls: { type: "integer" },
		maxAutoResumes: { type: "integer" },
		issuedAt: { type: "string" },
	},
	required: ["grantId", "taskId", "contractHash", "writeRoots", "maxCalls", "maxAutoResumes", "issuedAt"],
	additionalProperties: false,
};
const view = (grant: TaskGrant) => ({
	grantId: grant.id,
	taskId: grant.taskId,
	contractHash: grant.contractHash,
	writeRoots: [...grant.writeRoots],
	maxCalls: grant.maxCalls,
	maxAutoResumes: grant.maxAutoResumes,
	issuedAt: grant.issuedAt,
});

/** The host-rendered task authorization text; the plugin only supplies validated plain fields. */
export function taskGrantDialog(
	request: TaskGrantRequest,
	writeRoots: readonly string[],
	providers: readonly string[] = [],
): string {
	const allowances = (request.allowances ?? []).map(
		(item, index) => `- ${item.label}（${providers[index]}）`,
	);
	return [
		hostText(`要做的事：${request.goal}`, `Task: ${request.goal}`),
		...(request.summary ? [request.summary] : []),
		writeRoots.length
			? hostText(
					`会写入这些文件夹（包括子文件夹），不再逐项询问：\n${writeRoots.map((root) => `- ${root}`).join("\n")}`,
					`It will write in these folders (and subfolders) without asking each time:\n${writeRoots.map((root) => `- ${root}`).join("\n")}`,
				)
			: hostText(
					"不会新增可写文件夹；改动文件仍按你现有的权限设置逐项确认。",
					"No folder becomes writable; file changes still follow your permission settings.",
				),
		request.compute ??
			hostText(
				"不包含远程计算；运行计算任务仍会单独询问。",
				"No remote computation; running compute jobs still asks separately.",
			),
		hostText(
			`预算：最多 ${request.maxCalls} 次工具调用，自动续作最多 ${request.maxAutoResumes} 次。`,
			`Budget: at most ${request.maxCalls} tool calls and ${request.maxAutoResumes} automatic resumptions.`,
		),
		request.acceptance.length
			? hostText(
					`做完的标准：\n${request.acceptance.map((line) => `- ${line}`).join("\n")}`,
					`Done when:\n${request.acceptance.map((line) => `- ${line}`).join("\n")}`,
				)
			: "",
		allowances.length
			? hostText(
					`以下外部写入各放行一次，不再单独询问（括号里是执行写入的插件）：\n${allowances.join("\n")}`,
					`These external writes are each allowed once without asking again (the plugin that writes is in brackets):\n${allowances.join("\n")}`,
				)
			: "",
		hostText(
			"同意后它会自己做完这些事，中途不再反复问你；删除文件、碰敏感文件、写到上面以外的位置或运行计算仍会先征得你同意。任务结束、会话关闭、插件停用或更新时授权自动失效，你随时可以停止。",
			"Once approved it finishes these steps without asking again; deleting files, sensitive files, writing elsewhere or running computation still asks first. The authorization ends with the task, the session, or when the plugin is disabled or updated. You can stop at any time.",
		),
	]
		.filter(Boolean)
		.join("\n\n");
}

/** Capabilities bound to one installed plugin source; the grant records exactly this source. */
export function taskGrantCapabilityHandlers(
	store: TaskGrantStore,
	sessions: SessionDirectory,
	source: PluginRuntimeSource,
): Record<
	| "task.grant.request"
	| "task.grant.release"
	| "task.grant.current"
	| "task.grant.allowances"
	| "task.grant.amend"
	| "task.continue",
	PluginCapabilityHandler
> {
	const writableEntry = (context: Parameters<PluginCapabilityHandler["execute"]>[1]) => {
		const entry = requirePluginSession(sessions, context);
		if (entry.readOnly || entry.nativeKind === "child" || !entry.session.settingsManager.isProjectTrusted())
			throw new Error("Task authorization requires a writable trusted primary session");
		return entry;
	};
	// The broker hands the same validated input object to the dialog formatter and to execute.
	const shown = new WeakMap<
		object,
		{ roots: readonly string[]; providers: readonly PluginRuntimeSource[] }
	>();
	// Each allowance names a member of a role this plugin consumes; exactly one available provider is shown.
	const providersOf = (request: TaskGrantRequest) => {
		const items = request.allowances ?? [];
		if (new Set(items.map((item) => item.id)).size !== items.length)
			throw new Error("Task allowances need unique ids");
		return items.map((item) => {
			if (JSON.stringify(item.consent ?? null).length > MAX_CONSENT_JSON)
				throw new Error("Task allowance consent is too large");
			const provider = store.provider(source, item.role, item.member);
			if (!provider?.contentHash)
				throw new Error(`No single available provider for ${item.role}/${item.member}`);
			return provider;
		});
	};
	return {
		"task.grant.request": {
			effect: "write",
			// The host dialog below is the user's decision; it is never skipped by an existing grant.
			approval: "always",
			readCallable: true,
			inputSchema: requestSchema,
			resultSchema: grantSchema,
			approvalDetail: (input, facts) => {
				if (facts.scope.kind !== "session") throw new Error("Task authorization requires a live session");
				const request = input as TaskGrantRequest;
				const roots = resolveTaskWriteRoots(facts.scope.workspaceDirectory, request.writeDirectories);
				const providers = providersOf(request);
				shown.set(input as object, { roots, providers });
				return taskGrantDialog(
					request,
					roots,
					providers.map((provider) => provider.pluginId),
				);
			},
			execute: async (input, context) => {
				const request = input as TaskGrantRequest;
				const entry = writableEntry(context);
				// Re-resolve after approval: a directory replaced while the dialog was open is refused.
				const writeRoots = resolveTaskWriteRoots(entry.cwd, request.writeDirectories);
				const approved = shown.get(input as object);
				shown.delete(input as object);
				if (!approved || writeRoots.join("\0") !== approved.roots.join("\0"))
					throw new Error("Task directories changed during authorization; ask again.");
				const providers = providersOf(request);
				if (providers.some((provider, index) => provider !== approved.providers[index]))
					throw new Error("Task allowance providers changed during authorization; ask again.");
				return view(
					store.issue(entry, {
						source,
						taskId: request.taskId,
						contractHash: request.contractHash,
						writeRoots,
						maxCalls: request.maxCalls,
						maxAutoResumes: request.maxAutoResumes,
						allowances: (request.allowances ?? []).map((item, index) => {
							const provider = providers[index] as PluginRuntimeSource;
							return {
								id: item.id,
								role: item.role,
								member: item.member,
								label: item.label,
								consent: item.consent ?? null,
								provider: { pluginId: provider.pluginId, contentHash: provider.contentHash as string },
							};
						}),
					}),
				);
			},
		},
		"task.grant.allowances": {
			// What the current task grant allows this plugin, as a provider, to write without asking.
			effect: "read",
			inputSchema: { type: "null" },
			resultSchema: {
				anyOf: [
					{ type: "null" },
					{
						type: "object",
						properties: {
							taskId: { type: "string" },
							allowances: {
								type: "array",
								items: {
									type: "object",
									properties: {
										id: { type: "string" },
										role: { type: "string" },
										member: { type: "string" },
										consent: {},
										used: { type: "boolean" },
									},
									required: ["id", "role", "member", "consent", "used"],
									additionalProperties: false,
								},
							},
						},
						required: ["taskId", "allowances"],
						additionalProperties: false,
					},
				],
			},
			execute: async (_input, context) =>
				store.allowancesFor(requirePluginSession(sessions, context), source),
		},
		"task.grant.amend": {
			effect: "write",
			// Changing what an allowance names widens the authorization: the host asks every time.
			approval: "always",
			readCallable: true,
			inputSchema: {
				type: "object",
				properties: { taskId: text(128), id: text(128), label: text(300), consent: {} },
				required: ["taskId", "id", "label"],
				additionalProperties: false,
			},
			resultSchema: {
				type: "object",
				properties: { amended: { type: "boolean" } },
				required: ["amended"],
				additionalProperties: false,
			},
			approvalDetail: (input, facts) => {
				if (facts.scope.kind !== "session") throw new Error("Task authorization requires a live session");
				const request = input as { id: string; label: string };
				const entry = sessions.get(facts.scope.sessionId);
				const current = entry ? store.allowance(entry, request.id) : undefined;
				return hostText(
					`更换授权里的一项写入：\n原来：${current?.label ?? "（不存在）"}\n改为：${request.label}`,
					`Change one write in the authorization:\nFrom: ${current?.label ?? "(missing)"}\nTo: ${request.label}`,
				);
			},
			execute: async (input, context) => {
				const request = input as { taskId: string; id: string; label: string; consent?: unknown };
				if (JSON.stringify(request.consent ?? null).length > MAX_CONSENT_JSON)
					throw new Error("Task allowance consent is too large");
				store.amend(
					writableEntry(context),
					source,
					request.taskId,
					request.id,
					request.label,
					request.consent ?? null,
				);
				return { amended: true };
			},
		},
		"task.grant.release": {
			effect: "write",
			// Releasing only removes authority.
			approval: "own",
			readCallable: true,
			inputSchema: {
				type: "object",
				properties: { taskId: text(128) },
				required: ["taskId"],
				additionalProperties: false,
			},
			resultSchema: {
				type: "object",
				properties: { released: { type: "boolean" } },
				required: ["released"],
				additionalProperties: false,
			},
			execute: async (input, context) => ({
				released: store.release(
					requirePluginSession(sessions, context),
					(input as { taskId: string }).taskId,
				),
			}),
		},
		"task.continue": {
			effect: "write",
			// The authority is the current grant itself, checked below; no further dialog.
			approval: "own",
			readCallable: true,
			inputSchema: {
				type: "object",
				properties: { taskId: text(128), prompt: text(4000) },
				required: ["taskId", "prompt"],
				additionalProperties: false,
			},
			resultSchema: {
				type: "object",
				properties: { continuationId: { type: "string" }, remaining: { type: "integer" } },
				required: ["continuationId", "remaining"],
				additionalProperties: false,
			},
			execute: async (input, context) => {
				const request = input as { taskId: string; prompt: string };
				const entry = writableEntry(context);
				const grant = store.current(entry);
				if (
					!grant ||
					grant.source.pluginId !== source.pluginId ||
					grant.source.contentHash !== source.contentHash
				)
					throw new Error("Automatic continuation requires this plugin's current task authorization");
				if (grant.taskId !== request.taskId)
					throw new Error("Automatic continuation is limited to the authorized task");
				if (!store.reserveResume(grant))
					throw new Error("The authorized number of automatic continuations is used up");
				const continuationId = randomUUID();
				// Only the host creates this message type; a sandboxed plugin cannot forge it, so the
				// plugin's message_start hook can trust customType + continuationId. A follow-up waits
				// for a running turn to finish, so the plugin may ask from its agent_end hook.
				await entry.session.sendCustomMessage(
					{
						customType: continuationType(source.pluginId),
						content: request.prompt,
						display: false,
						details: { continuationId, taskId: grant.taskId, grantId: grant.id },
					},
					{ triggerTurn: true, deliverAs: "followUp" },
				);
				return { continuationId, remaining: store.resumesLeft(grant) };
			},
		},
		"task.grant.current": {
			effect: "read",
			inputSchema: { type: "null" },
			resultSchema: { anyOf: [{ type: "null" }, grantSchema] },
			execute: async (_input, context) => {
				const grant = store.current(requirePluginSession(sessions, context));
				return grant && grant.source.pluginId === source.pluginId ? view(grant) : null;
			},
		},
	};
}
