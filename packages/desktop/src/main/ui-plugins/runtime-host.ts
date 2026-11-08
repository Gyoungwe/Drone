import { realpathSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import {
	createExecutionIntegrityKey,
	createPluginExecutionCapabilities,
	createProcessPluginRuntime,
	hostText,
	type PluginNativeIntegration,
	type PluginRuntimeSource,
	type SessionServicePort,
} from "@drone/backend";
import type { ExecutionIdentity } from "@gyoungwe/plugin-api/node/execution";
import { app, BrowserWindow, dialog, webContents } from "electron";
import { createDesktopResourceCapabilities } from "./desktop-resource-capabilities";
import type { UiPluginManager } from "./manager";
import {
	DesktopRuntimeBridge,
	type DesktopRuntimeBridgeOptions,
	type DesktopRuntimeOwner,
} from "./runtime-bridge";

export { createDesktopResourceCapabilities };

/** The host asks before the worker imports code; UI trust alone grants no Node privileges. */
export function createDesktopRuntime(
	manager: UiPluginManager,
	runtimeDirectory: string,
	sessions: Pick<
		SessionServicePort,
		| "getPluginCallerContext"
		| "getStorageRegistry"
		| "getPluginSessionCapabilities"
		| "getPluginSourceCapabilities"
		| "getTaskGrants"
		| "getPluginWorkspaceCapabilities"
	>,
	questionTransport: NonNullable<DesktopRuntimeBridgeOptions["questionTransport"]>,
): DesktopRuntimeBridge {
	// pdf.js ships with the app; the plain-Node parser process can read it only outside app.asar.
	const pdfjsRoot = realpathSync(
		dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json")).replace(
			/app\.asar(?=[\\/])/,
			"app.asar.unpacked",
		),
	);
	const executionIntegrityKey = createExecutionIntegrityKey();
	const executionAcceptedFacts = new Map<string, ExecutionIdentity>();
	return new DesktopRuntimeBridge({
		source: (name) => manager.runtimeSource(name),
		sources: () => manager.runtimeSources(),
		classifySelectedPath: (path) => manager.classifyNativeSelection(path),
		getSessionContext: (sessionId) => sessions.getPluginCallerContext(sessionId),
		taskGrants: sessions.getTaskGrants(),
		questionTransport,
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
					if (kind === "binary-state" || kind === "binary-state-write") {
						const writable = kind === "binary-state-write";
						const result = await dialog.showOpenDialog(window, {
							title: writable
								? hostText("授权插件二进制状态读写目录", "Authorize plugin binary state writes")
								: hostText("选择插件只读二进制状态目录", "Select read-only binary state directory"),
							message: writable
								? hostText(
										`${source.pluginId} 申请读取和原子替换所选目录内最多 4 MiB 的原始二进制状态文件。此授权独立于 JSON/笔记权限；每次替换仍需独占写者租约、版本校验和批准。取消将终止启用。`,
										`${source.pluginId} requests raw binary state reads and atomic replacements up to 4 MiB under this directory. This is independent of JSON/notes permissions; each replacement still needs an exclusive writer lease, version checks and approval. Cancel to stop activation.`,
									)
								: hostText(
										`${source.pluginId} 只能通过宿主读取所选目录内最多 4 MiB 的原始二进制状态文件。取消将终止启用。`,
										`${source.pluginId} may only read raw binary state files up to 4 MiB through the host under this directory. Cancel to stop activation.`,
									),
							properties: ["openDirectory"],
							buttonLabel: writable
								? hostText("授权二进制状态读写", "Allow binary state writes")
								: hostText("授权只读访问", "Allow read-only access"),
						});
						if (contents.isDestroyed())
							throw new Error("Plugin approving window closed during directory selection");
						return result.canceled ? [] : result.filePaths;
					}
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
							acceptedFacts: executionAcceptedFacts,
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
					...sessions.getPluginSourceCapabilities(source),
					...(source.requestsWorkspaceRead
						? sessions.getPluginWorkspaceCapabilities({ runtimeDirectory, pdfjsRoot })
						: {}),
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
								"model.toolStep": capabilities["model.toolStep"],
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
		// Starting a built-in's runtime is not a separate permission; every capability it uses still asks.
		approve: (owner, source, operation, detail, signal) =>
			operation === undefined && manager.builtinPackages.has(source.packageRoot)
				? Promise.resolve(true)
				: approveDesktopRuntime(owner, source, operation, detail, signal),
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
		message:
			operation === "capability:task.grant.request"
				? hostText("开始执行这个任务？", "Start this task?")
				: operation
					? hostText(
							`允许 ${source.pluginId} 执行 ${operation}？`,
							`Allow ${source.pluginId} to execute ${operation}?`,
						)
					: hostText(
							`启动 ${source.pluginId} 的桌面后台？`,
							`Start the desktop runtime for ${source.pluginId}?`,
						),
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
		manages: (path) => manager().classifyNativeSelection(path).kind !== "ordinary",
		childExtensionPaths: () => manager().nativeChildExtensionPaths(),
		extensionPaths: () => manager().builtinExtensionPaths(),
		begin: (facts) => {
			const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
			if (!window || window.isDestroyed())
				throw new Error("Native plugin activation requires an available host window");
			return runtime().beginNative(window.webContents, findName, facts);
		},
	};
}
