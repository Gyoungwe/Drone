import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import {
	createExecutionIntegrityKey,
	createPluginExecutionCapabilities,
	createProcessPluginRuntime,
	fileCapabilityHandlers,
	hostText,
	PluginFileCapabilities,
	type PluginNativeIntegration,
	PluginResourceManager,
	type PluginRootGrant,
	type PluginRuntimeCapabilitiesProvider,
	type PluginRuntimeSource,
	type SessionServicePort,
	type StorageRegistry,
} from "@drone/backend";
import { IpcChannels } from "@drone/shared";
import { app, BrowserWindow, dialog, webContents } from "electron";
import type { UiPluginManager } from "./manager";
import { DesktopRuntimeBridge, type DesktopRuntimeOwner } from "./runtime-bridge";

interface ResourceAccessSelection {
	readonly profileDirectory: string;
	readonly storage: StorageRegistry;
	selectDirectories(kind: "state" | "state-write" | "files" | "files-write"): Promise<readonly string[]>;
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
		(entry) => entry.handle === request.root && entry.kind === (isState ? "state" : "files"),
	);
	if (!grant || !(isState ? grant.stateWrite : grant.fileWrite))
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
				"仅保留此目录的独占写者租约，不修改日志正文。完整 owner 与资源成功关闭后释放；清理失败时保留租约并要求显式恢复。后续 JSON 写入仍需单独批准。",
				"Reserves this directory for one writer without modifying journal contents. The lease is released after successful owner and resource cleanup; cleanup failures retain it for explicit recovery. Later JSON writes still require separate approval.",
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
	kind: "state" | "state-write" | "files" | "files-write",
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
		if (!hasResources && !requestsState && !requestsFiles) return { resources: [], handlers: {} };
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
		return {
			resources: grants.map(({ handle, kind, stateWrite, fileWrite }) => ({
				handle,
				kind,
				access: stateWrite || fileWrite ? ("read-write" as const) : ("read" as const),
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

/** The host asks before the worker imports code; UI trust alone grants no Node privileges. */
export function createDesktopRuntime(
	manager: UiPluginManager,
	runtimeDirectory: string,
	sessions: Pick<
		SessionServicePort,
		"getPluginCallerContext" | "getStorageRegistry" | "getPluginSessionCapabilities"
	>,
): DesktopRuntimeBridge {
	const executionIntegrityKey = createExecutionIntegrityKey();
	return new DesktopRuntimeBridge({
		source: (name) => manager.runtimeSource(name),
		sources: () => manager.runtimeSources(),
		getSessionContext: (sessionId) => sessions.getPluginCallerContext(sessionId),
		questionTransport: (owner) => ({
			ownerId: owner.id,
			send: (request) => {
				const contents = webContents.fromId(owner.id);
				if (!contents || contents.isDestroyed()) return false;
				contents.send(IpcChannels.AskRequest, request);
				return true;
			},
			resolved: (result) => {
				const contents = webContents.fromId(owner.id);
				if (contents && !contents.isDestroyed()) contents.send(IpcChannels.AskResolved, result);
			},
		}),
		enabled: (name) => manager.isEnabled(name) || manager.isNativeSourceAvailable(name),
		factory: (source) => createProcessPluginRuntime({ ...source, runtimeDirectory }),
		capabilities: (source, owner) => async (activation) => {
			const resourceCapabilities = await createDesktopResourceCapabilities(source, runtimeDirectory, {
				profileDirectory: app.getPath("userData"),
				storage: sessions.getStorageRegistry(),
				selectDirectories: async (kind) => {
					const contents = webContents.fromId(owner.id);
					if (!contents || contents.isDestroyed()) throw new Error("Plugin approving window is unavailable");
					const window = BrowserWindow.fromWebContents(contents);
					if (!window) throw new Error("Plugin directory selection requires its approving window");
					const result = await dialog.showOpenDialog(window, {
						title:
							kind === "files-write"
								? hostText(
										"授权插件创建、替换和删除文本文件的目录",
										"Authorize plugin text file creation, replacement and deletion",
									)
								: kind === "state-write"
									? hostText(
											"授权插件读写状态 JSON 的目录",
											"Authorize a directory for plugin state JSON writes",
										)
									: kind === "state"
										? hostText("选择插件只读状态目录", "Select the plugin's read-only state directory")
										: hostText("选择插件可只读访问的数据目录", "Select data directories the plugin may read"),
						message:
							kind === "files-write"
								? hostText(
										`${source.pluginId} 申请通过宿主读取、创建、替换和删除所选目录内的文本文件，以及创建子目录。仅授权本次启用；每次写入、删除和目录创建仍需批准并检查目标版本。JSON 状态仍需独立状态目录授权。取消将终止启用。`,
										`${source.pluginId} requests access through the host to read, create, replace and delete text files and create subdirectories in the selected directories for this activation. Each write, deletion and directory creation still requires approval and target-version checks. JSON state requires a separate state-directory grant. Cancel to stop activation.`,
									)
								: kind === "state-write"
									? hostText(
											`${source.pluginId} 申请通过宿主读取、修改和删除所选目录内的状态 JSON 并创建状态子目录。仅授权本次启用，每次文件写入、删除和目录创建仍需批准。不会授权笔记或任意文件写入。取消将终止启用。`,
											`${source.pluginId} requests access to read, modify and delete state JSON and create state subdirectories under this directory for this activation. Each file write, deletion and directory creation still requires approval. Notes and arbitrary file writes are not granted. Cancel to stop activation.`,
										)
									: kind === "state"
										? hostText(
												`${source.pluginId} 可通过宿主读取所选目录内的状态 JSON。此授权仅用于本次启用；取消将终止启用。`,
												`${source.pluginId} may read state JSON under this directory through the host for this activation. Cancel to stop activation.`,
											)
										: hostText(
												"插件可通过宿主读取所选目录及子目录的文件；不会自动授权状态文件引用的其他路径。受控索引进程只能写入宿主私有缓存。取消将终止启用。",
												"The plugin may read files under selected directories through the host. Paths mentioned in state files are not automatically approved. Controlled index processes write only to private host caches. Cancel to stop activation.",
											),
						properties:
							kind === "state" || kind === "state-write"
								? ["openDirectory"]
								: ["openDirectory", "multiSelections"],
						buttonLabel:
							kind === "files-write"
								? hostText("授权文本文件读写和删除", "Allow text file writes and deletion")
								: kind === "state-write"
									? hostText("授权状态 JSON 读写", "Allow state JSON access")
									: hostText("授权只读访问", "Allow read-only access"),
					});
					if (contents.isDestroyed())
						throw new Error("Plugin approving window closed during directory selection");
					return result.canceled ? [] : result.filePaths;
				},
			})(activation);
			const executionSourceIdentity = source.contentHash;
			if (source.requestsExecution && !executionSourceIdentity)
				throw new Error("Execution requires a current installed package content identity");
			const executionCapabilities =
				source.requestsExecution && executionSourceIdentity
					? await createPluginExecutionCapabilities({
							directory: join(await realpath(app.getPath("userData")), "plugin-execution-receipts"),
							sourceIdentity: executionSourceIdentity,
							integrityKey: executionIntegrityKey,
							storage: sessions.getStorageRegistry(),
							getSessionContext: (id) => sessions.getPluginCallerContext(id),
						})
					: undefined;
			const capabilities = sessions.getPluginSessionCapabilities(source.recordAdoptions);
			return {
				...resourceCapabilities,
				handlers: {
					...resourceCapabilities.handlers,
					...executionCapabilities?.handlers,
					"session.inspect": capabilities["session.inspect"],
					"session.tools": capabilities["session.tools"],
					"session.select": capabilities["session.select"],
					"session.input": capabilities["session.input"],
					"session.confirm": capabilities["session.confirm"],
					"session.records.read": capabilities["session.records.read"],
					"session.records.append": capabilities["session.records.append"],
					"session.notify": capabilities["session.notify"],
					...(source.recordAdoptions
						? {
								"session.records.adoption.inspect": capabilities["session.records.adoption.inspect"],
								"session.records.adoption.commit": capabilities["session.records.adoption.commit"],
							}
						: {}),
					...(source.requestsModel
						? {
								"model.selection": capabilities["model.selection"],
								"model.generate": capabilities["model.generate"],
							}
						: {}),
				},
				...(executionCapabilities
					? {
							dispose: async () => {
								const results = await Promise.allSettled([
									resourceCapabilities.dispose?.(),
									executionCapabilities.dispose(),
								]);
								const failures = results.filter((result) => result.status === "rejected");
								if (failures.length)
									throw new AggregateError(
										failures.map((result) => result.reason),
										"Plugin execution or resource cleanup failed",
									);
							},
						}
					: {}),
			};
		},
		approve: approveDesktopRuntime,
	});
}

export async function approveDesktopRuntime(
	owner: DesktopRuntimeOwner,
	source: PluginRuntimeSource,
	operation?: string,
	approvalDetail?: string,
	signal?: AbortSignal,
): Promise<boolean> {
	const contents = webContents.fromId(owner.id);
	if (!contents || contents.isDestroyed()) return false;
	const window = BrowserWindow.fromWebContents(contents);
	if (!window) return false;
	const response = await dialog.showMessageBox(window, {
		type: "question",
		signal,
		title: hostText("插件后台权限", "Plugin runtime permission"),
		message: operation
			? hostText(
					`允许 ${source.pluginId} 执行 ${operation}？`,
					`Allow ${source.pluginId} to execute ${operation}?`,
				)
			: hostText(`启动 ${source.pluginId} 的桌面后台？`, `Start the desktop runtime for ${source.pluginId}?`),
		detail:
			approvalDetail ??
			hostText(
				"领域后台在独立进程中运行，不能直接访问数据目录或联网。声明独立资源的插件会另行选择状态与只读数据目录；状态 JSON 与数据文本的写入和删除必须分别选择目录并明确授权；索引子进程只能写宿主私有缓存。停用插件会撤销访问；窗口关闭撤销该窗口访问，已打开会话随会话关闭释放。",
				"The domain runtime runs in a separate process without direct data-directory or network access. Plugins declaring resources separately request state and read-only data directories; state JSON and data text writes and deletion require separate explicit directory grants; index subprocesses write only private host caches. Disabling revokes access. Closing a window revokes that window's access; open sessions release their access when closed.",
			),
		buttons: [hostText("拒绝", "Deny"), hostText("允许", "Allow")],
		defaultId: 0,
		cancelId: 0,
	});
	return response.response === 1 && !contents.isDestroyed() && !signal?.aborted;
}

/** Native and UI discovery both select the same canonical installed package descriptor. */
export function createNativeRuntimeIntegration(
	manager: () => UiPluginManager,
	runtime: () => DesktopRuntimeBridge,
): PluginNativeIntegration {
	const findName = (path: string) => manager().nativeRuntimeName(path);
	return {
		manages: (path) => findName(path) !== undefined,
		begin: () => {
			const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
			if (!window || window.isDestroyed())
				throw new Error("Native plugin activation requires an available host window");
			return runtime().beginNative(window.webContents, findName);
		},
	};
}
