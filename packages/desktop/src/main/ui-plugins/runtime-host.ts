import { createHash, randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { chmod, mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import {
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
import { app, BrowserWindow, dialog, webContents } from "electron";
import type { UiPluginManager } from "./manager";
import { DesktopRuntimeBridge } from "./runtime-bridge";

interface ResourceAccessSelection {
	readonly profileDirectory: string;
	readonly storage: StorageRegistry;
	selectDirectories(kind: "state" | "state-write" | "files"): Promise<readonly string[]>;
}

/** A native picker may remain open after cancellation; its late answer grants nothing. */
function selectWhileActive(
	selection: ResourceAccessSelection,
	kind: "state" | "state-write" | "files",
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
		if (!source.resources || Object.keys(source.resources).length === 0)
			return { resources: [], handlers: {} };
		activation.signal.throwIfAborted();
		const state = await selectWhileActive(
			selection,
			source.requestsStateWrite ? "state-write" : "state",
			activation.signal,
		);
		activation.signal.throwIfAborted();
		if (state.length !== 1 || state[0] === undefined)
			throw new Error("Plugin state directory selection was canceled");
		const files = await selectWhileActive(selection, "files", activation.signal);
		activation.signal.throwIfAborted();
		if (files.length === 0) throw new Error("Plugin data directory selection was canceled");
		const statePath = await realpath(state[0]);
		const filePaths = [...new Set(await Promise.all(files.map((path) => realpath(path))))];
		const stateEntry = selection.storage.registerDiscoveredRoot(
			`desktop-plugin-state-${createHash("sha256").update(source.pluginId).digest("hex").slice(0, 16)}`,
			statePath,
			`plugin:${source.pluginId}`,
			"private",
			"plugin-owned",
		);
		const grants: PluginRootGrant[] = [
			{
				handle: randomUUID(),
				path: statePath,
				kind: "state",
				scope: { kind: "application" },
				...(source.requestsStateWrite
					? { stateWrite: { registry: selection.storage, storageId: stateEntry.id } }
					: {}),
			},
			...filePaths.map((path) => ({
				handle: randomUUID(),
				path,
				kind: "files" as const,
				scope: { kind: "application" as const },
			})),
		];
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
		const resources = new PluginResourceManager({
			pluginId: activation.pluginId,
			applicationId: activation.applicationId,
			packageRoot: source.packageRoot,
			entries: source.resources,
			runtimeDirectory,
			files: ports,
			signal: activation.signal,
			events: activation.events,
		});
		return {
			resources: grants.map(({ handle, kind, stateWrite }) => ({
				handle,
				kind,
				access: stateWrite ? ("read-write" as const) : ("read" as const),
			})),
			handlers: { ...fileCapabilityHandlers(ports), ...resources.handlers() },
			dispose: () => resources.dispose(),
		};
	};
}

/** The host asks before the worker imports code; UI trust alone grants no Node privileges. */
export function createDesktopRuntime(
	manager: UiPluginManager,
	runtimeDirectory: string,
	sessions: Pick<SessionServicePort, "getPluginCallerContext" | "getStorageRegistry">,
): DesktopRuntimeBridge {
	return new DesktopRuntimeBridge({
		source: (name) => manager.runtimeSource(name),
		getSessionContext: (sessionId) => sessions.getPluginCallerContext(sessionId),
		enabled: (name) => manager.isEnabled(name),
		factory: (source) => createProcessPluginRuntime({ ...source, runtimeDirectory }),
		capabilities: (source, owner) =>
			createDesktopResourceCapabilities(source, runtimeDirectory, {
				profileDirectory: app.getPath("userData"),
				storage: sessions.getStorageRegistry(),
				selectDirectories: async (kind) => {
					const contents = webContents.fromId(owner.id);
					if (!contents || contents.isDestroyed()) throw new Error("Plugin approving window is unavailable");
					const window = BrowserWindow.fromWebContents(contents);
					if (!window) throw new Error("Plugin directory selection requires its approving window");
					const result = await dialog.showOpenDialog(window, {
						title:
							kind === "state-write"
								? hostText(
										"授权插件读写状态 JSON 的目录",
										"Authorize a directory for plugin state JSON writes",
									)
								: kind === "state"
									? hostText("选择插件只读状态目录", "Select the plugin's read-only state directory")
									: hostText("选择插件可只读访问的数据目录", "Select data directories the plugin may read"),
						message:
							kind === "state-write"
								? hostText(
										`${source.pluginId} 申请通过宿主读取并修改所选目录已有子目录内的状态 JSON。仅授权本次启用，具体写操作仍需批准。不会授权笔记或任意文件写入。取消将终止启用。`,
										`${source.pluginId} requests access to read and modify state JSON in this directory and existing subdirectories for this activation. Each write still requires approval. Notes and arbitrary file writes are not granted. Cancel to stop activation.`,
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
						properties: kind !== "files" ? ["openDirectory"] : ["openDirectory", "multiSelections"],
						buttonLabel:
							kind === "state-write"
								? hostText("授权状态 JSON 读写", "Allow state JSON access")
								: hostText("授权只读访问", "Allow read-only access"),
					});
					if (contents.isDestroyed())
						throw new Error("Plugin approving window closed during directory selection");
					return result.canceled ? [] : result.filePaths;
				},
			}),
		approve: async (owner, source, operation) => {
			const contents = webContents.fromId(owner.id);
			if (!contents || contents.isDestroyed()) return false;
			const window = BrowserWindow.fromWebContents(contents);
			if (!window) return false;
			const response = await dialog.showMessageBox(window, {
				type: "question",
				title: hostText("插件后台权限", "Plugin runtime permission"),
				message: operation
					? hostText(
							`允许 ${source.pluginId} 执行 ${operation}？`,
							`Allow ${source.pluginId} to execute ${operation}?`,
						)
					: hostText(
							`启动 ${source.pluginId} 的桌面后台？`,
							`Start the desktop runtime for ${source.pluginId}?`,
						),
				detail: hostText(
					"领域后台在独立进程中运行，不能直接访问数据目录或联网。声明独立资源的插件会另行选择状态与只读数据目录；状态 JSON 写入必须单独明确授权，受控索引子进程只能写宿主私有缓存。停用插件会撤销访问；窗口关闭撤销该窗口访问，已打开会话随会话关闭释放。",
					"The domain runtime runs in a separate process without direct data-directory or network access. Plugins declaring resources separately request state and read-only data directories; state JSON writes require explicit separate authorization, controlled index subprocesses write only private host caches. Disabling revokes access. Closing a window revokes that window's access; open sessions release their access when closed.",
				),
				buttons: [hostText("拒绝", "Deny"), hostText("允许", "Allow")],
				defaultId: 0,
				cancelId: 0,
			});
			return response.response === 1 && !contents.isDestroyed();
		},
	});
}

/** Native and UI discovery both select the same canonical installed package descriptor. */
export function createNativeRuntimeIntegration(
	manager: () => UiPluginManager,
	runtime: () => DesktopRuntimeBridge,
): PluginNativeIntegration {
	const findName = (path: string) => {
		const canonical = realpathSync(path);
		return manager()
			.list()
			.find((plugin) => manager().runtimeSource(plugin.name)?.nativeEntrypoint === canonical)?.name;
	};
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
