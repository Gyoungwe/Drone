import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import {
	fileCapabilityHandlers,
	hostText,
	PluginFileCapabilities,
	PluginResourceManager,
	type PluginRootGrant,
	type PluginRuntimeCapabilitiesProvider,
	type PluginRuntimeSource,
	type StorageRegistry,
} from "@drone/backend";

interface ResourceAccessSelection {
	readonly profileDirectory: string;
	readonly storage: StorageRegistry;
	selectDirectories(
		kind: "state" | "state-write" | "files" | "files-write" | "binary-state" | "binary-state-write",
	): Promise<readonly string[]>;
}

const writeOperations = [
	"state.reserve",
	"state.writeJson",
	"state.removeJson",
	"state.ensureDirectory",
	"files.writeText",
	"files.remove",
	"files.ensureDirectory",
] as const;

/** Inputs have passed the capability schema; only selected host grants identify OS directories. */
function fileWriteApprovalDetail(
	grants: readonly PluginRootGrant[],
	operation: (typeof writeOperations)[number],
	input: unknown,
): string {
	const request = input as {
		root: string;
		path: string;
		value?: unknown;
		expectedVersion?: string | null;
		expectedHash?: string | null;
		text?: string;
	};
	const isState = operation.startsWith("state.");
	const grant = grants.find(
		(entry) =>
			entry.handle === request.root &&
			(operation === "state.reserve"
				? entry.kind === "state" || entry.kind === "binary-state"
				: entry.kind === (isState ? "state" : "files")),
	);
	if (
		!grant ||
		!(operation === "state.reserve"
			? grant.stateWrite || grant.binaryStateWrite
			: isState
				? grant.stateWrite
				: grant.fileWrite)
	)
		throw new Error("Plugin write root was not granted");
	const action =
		operation === "state.reserve"
			? hostText("保留状态目录的独占写者租约", "Reserve the state directory for one writer")
			: operation === "state.writeJson"
				? hostText("写入 JSON", "Write JSON")
				: operation === "files.writeText"
					? hostText("写入文本文件", "Write text file")
					: operation === "state.removeJson" || operation === "files.remove"
						? hostText("删除文件", "Remove file")
						: hostText("创建目录（保留已有目录）", "Create directory (preserve existing directory)");
	const lines = [
		hostText(`动作：${action} (${operation})`, `Action: ${action} (${operation})`),
		hostText(
			`已授权目录：${JSON.stringify(grant.path)}`,
			`Authorized directory: ${JSON.stringify(grant.path)}`,
		),
		hostText(
			`目录内相对路径：${JSON.stringify(request.path)}`,
			`Root-relative path: ${JSON.stringify(request.path)}`,
		),
	];
	if (operation === "state.reserve")
		lines.push(
			hostText(
				"仅保留此目录的独占写者租约，不修改日志正文。完整 owner 与资源成功关闭后释放；清理失败时保留租约并要求显式恢复。后续持久化写入仍需单独批准。",
				"Reserves this directory for one writer without modifying journal contents. The lease is released after successful owner and resource cleanup; cleanup failures retain it for explicit recovery. Later durable writes still require separate approval.",
			),
		);
	if (
		operation !== "state.reserve" &&
		operation !== "state.ensureDirectory" &&
		operation !== "files.ensureDirectory"
	) {
		const expected = isState ? request.expectedVersion : request.expectedHash;
		lines.push(`${isState ? "expectedVersion" : "expectedHash"}: ${JSON.stringify(expected)}`);
		if (expected === null)
			lines.push(
				hostText(
					"目标必须不存在；不会覆盖已有文件。",
					"The target must be absent; an existing file will not be overwritten.",
				),
			);
	}
	if (operation === "state.writeJson" || operation === "files.writeText") {
		const content =
			operation === "state.writeJson" ? JSON.stringify(request.value, null, 2) : (request.text as string);
		const limit = 4000;
		lines.push(hostText("拟写入内容：", "Proposed content:"), content.slice(0, limit));
		lines.push(
			content.length > limit
				? hostText(
						`仅展示前 ${limit} 个字符，共 ${content.length} 个字符；全文未展示。若信息不足，请拒绝。`,
						`Only the first ${limit} of ${content.length} characters are shown; the full content is not displayed. Deny if this is insufficient.`,
					)
				: hostText("以上为拟写入内容全文。", "The complete proposed content is shown above."),
		);
	} else if (operation === "state.removeJson" || operation === "files.remove") {
		lines.push(
			hostText(
				"将删除版本匹配的文件；此确认未展示待删除文件的内容。",
				"Deletes the file only if its version matches. This confirmation does not display the file's contents.",
			),
		);
	}
	return lines.join("\n\n");
}

/** A native picker may remain open after cancellation; its late answer grants nothing. */
function selectWhileActive(
	selection: ResourceAccessSelection,
	kind: "state" | "state-write" | "files" | "files-write" | "binary-state" | "binary-state-write",
	signal: AbortSignal,
): Promise<readonly string[]> {
	signal.throwIfAborted();
	return new Promise((resolve, reject) => {
		const abort = () => reject(signal.reason);
		signal.addEventListener("abort", abort, { once: true });
		void Promise.resolve()
			.then(() => {
				signal.throwIfAborted();
				return selection.selectDirectories(kind);
			})
			.then(
				(paths) => {
					signal.removeEventListener("abort", abort);
					resolve(paths);
				},
				(error: unknown) => {
					signal.removeEventListener("abort", abort);
					reject(error);
				},
			);
	});
}

/** Selection is activation-local. A plugin manifest or its state cannot grant a filesystem root. */
export function createDesktopResourceCapabilities(
	source: PluginRuntimeSource,
	runtimeDirectory: string,
	selection: ResourceAccessSelection,
): PluginRuntimeCapabilitiesProvider {
	return async (activation) => {
		const declaredResources = source.resources;
		const hasResources = declaredResources !== undefined && Object.keys(declaredResources).length > 0;
		const requestsState = source.requestsStateRead || source.requestsStateWrite;
		const requestsFiles = source.requestsFileRead || source.requestsFileWrite;
		const requestsBinary = source.requestsBinaryStateRead || source.requestsBinaryStateWrite;
		if (!hasResources && !requestsState && !requestsFiles && !requestsBinary)
			return { resources: [], handlers: {} };
		activation.signal.throwIfAborted();
		const grants: PluginRootGrant[] = [];
		if (requestsState) {
			const state = await selectWhileActive(
				selection,
				source.requestsStateWrite ? "state-write" : "state",
				activation.signal,
			);
			activation.signal.throwIfAborted();
			if (state.length !== 1 || state[0] === undefined)
				throw new Error("Plugin state directory selection was canceled");
			const statePath = await realpath(state[0]);
			const stateEntry = selection.storage.registerDiscoveredRoot(
				`desktop-plugin-state-${createHash("sha256").update(source.pluginId).digest("hex").slice(0, 16)}`,
				statePath,
				`plugin:${source.pluginId}`,
				"private",
				"plugin-owned",
			);
			grants.push({
				handle: randomUUID(),
				path: statePath,
				kind: "state",
				scope: { kind: "application" },
				...(source.requestsStateWrite
					? { stateWrite: { registry: selection.storage, storageId: stateEntry.id } }
					: {}),
			});
		}
		if (requestsBinary) {
			const selected = await selectWhileActive(
				selection,
				source.requestsBinaryStateWrite ? "binary-state-write" : "binary-state",
				activation.signal,
			);
			activation.signal.throwIfAborted();
			if (selected.length !== 1 || selected[0] === undefined)
				throw new Error("Plugin binary state directory selection was canceled");
			const path = await realpath(selected[0]);
			const entry = selection.storage.registerDiscoveredRoot(
				`desktop-plugin-binary-state-${createHash("sha256").update(source.pluginId).digest("hex").slice(0, 16)}`,
				path,
				`plugin:${source.pluginId}`,
				"private",
				"plugin-owned-binary",
			);
			grants.push({
				handle: randomUUID(),
				path,
				kind: "binary-state",
				scope: { kind: "application" },
				...(source.requestsBinaryStateWrite
					? { binaryStateWrite: { registry: selection.storage, storageId: entry.id } }
					: {}),
			});
		}
		if (requestsFiles) {
			const files = await selectWhileActive(
				selection,
				source.requestsFileWrite ? "files-write" : "files",
				activation.signal,
			);
			activation.signal.throwIfAborted();
			if (files.length === 0) throw new Error("Plugin data directory selection was canceled");
			const filePaths = [...new Set(await Promise.all(files.map((path) => realpath(path))))];
			grants.push(
				...filePaths.map((path) => ({
					handle: randomUUID(),
					path,
					kind: "files" as const,
					scope: { kind: "application" as const },
					...(source.requestsFileWrite ? { fileWrite: true as const } : {}),
				})),
			);
		}
		const profile = await realpath(selection.profileDirectory);
		const cache = join(
			profile,
			"plugin-runtime-cache",
			createHash("sha256").update(source.pluginId).digest("hex"),
		);
		activation.signal.throwIfAborted();
		for (const directory of [join(profile, "plugin-runtime-cache"), cache]) {
			await mkdir(directory, { recursive: true, mode: 0o700 });
			if ((await realpath(directory)) !== directory)
				throw new Error("Plugin cache must remain inside the host profile");
			await chmod(directory, 0o700);
		}
		const ports = await PluginFileCapabilities.create(grants, cache);
		activation.signal.throwIfAborted();
		const resources =
			declaredResources && hasResources
				? new PluginResourceManager({
						pluginId: activation.pluginId,
						applicationId: activation.applicationId,
						packageRoot: source.packageRoot,
						entries: declaredResources,
						runtimeDirectory,
						files: ports,
						signal: activation.signal,
						events: activation.events,
					})
				: undefined;
		const fileHandlers = { ...fileCapabilityHandlers(ports) };
		for (const operation of writeOperations) {
			fileHandlers[operation] = {
				// biome-ignore lint/style/noNonNullAssertion: The host factory supplies all state/file mutation handlers.
				...fileHandlers[operation]!,
				approvalDetail: (input) => fileWriteApprovalDetail(grants, operation, input),
			};
		}
		fileHandlers["state.writeBinary"] = {
			// biome-ignore lint/style/noNonNullAssertion: fileCapabilityHandlers always supplies this exact binary handler.
			...fileHandlers["state.writeBinary"]!,
			approvalDetail: (input, facts) => {
				const request = input as {
					root: string;
					path: string;
					base64: string;
					expectedVersion: string | null;
					assertAbsent: string[];
				};
				const grant = grants.find(
					(entry) => entry.handle === request.root && entry.kind === "binary-state" && entry.binaryStateWrite,
				);
				if (!grant) throw new Error("Binary state write root was not granted");
				const bytes = Buffer.from(request.base64, "base64");
				return [
					hostText(
						"替换原始二进制状态；内容不透明，未展示逻辑差异。若信息不足请拒绝。",
						"Replace raw binary state; logical content/diff is not displayed. Deny if insufficient.",
					),
					`plugin: ${facts.pluginId}`,
					`application: ${facts.applicationId}`,
					`actual scope: ${JSON.stringify(facts.scope)}`,
					`root: ${JSON.stringify(grant.path)}`,
					`path: ${JSON.stringify(request.path)}`,
					`expectedVersion: ${JSON.stringify(request.expectedVersion)}`,
					`new SHA-256: ${createHash("sha256").update(bytes).digest("hex")}`,
					`bytes: ${bytes.length}`,
					`assertAbsent: ${JSON.stringify(request.assertAbsent)}`,
					hostText(
						"提交点之后取消可能已写入；须由新的合法调用者回读 SHA-256 核对。",
						"Cancellation after the commit point may leave committed bytes; a fresh authorized caller must reconcile SHA-256.",
					),
				].join("\n\n");
			},
		};
		return {
			resources: grants.map(({ handle, kind, stateWrite, binaryStateWrite, fileWrite }) => ({
				handle,
				kind,
				access: stateWrite || binaryStateWrite || fileWrite ? ("read-write" as const) : ("read" as const),
			})),
			handlers: { ...fileHandlers, ...resources?.handlers() },
			...(resources
				? {
						resourcesLifecycle: { dispose: () => resources.disposeResources() },
					}
				: {}),
			dispose: async () => {
				await resources?.disposeResources();
				await ports.drain();
			},
			finalRelease: async () => {
				resources?.releaseReservations();
				ports.releaseReservations();
			},
		};
	};
}
