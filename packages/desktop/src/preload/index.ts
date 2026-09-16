import { INVOKE_ROUTES, IpcChannels, type PiApi } from "@drone/shared";
import { contextBridge, ipcRenderer } from "electron";

// invoke 半区：从 INVOKE_ROUTES 单一事实源批量生成透传函数，不再逐条手抄。
// 参数/返回类型在 PiApi 处约束（下方 `api: PiApi` 兜底方法覆盖完整性）；此处 any 仅为桥接形状。
type InvokeApi = { [K in keyof typeof INVOKE_ROUTES]: (...args: any[]) => Promise<any> };
const invokeApi = Object.fromEntries(
	Object.entries(INVOKE_ROUTES).map(([method, channel]) => [
		method,
		(...args: any[]) => ipcRenderer.invoke(channel, ...args),
	]),
) as InvokeApi;

/** 事件订阅：main → renderer 单向推送，`on` + 退订函数（invoke 之外的第二种 adapter 形态）。 */
function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
	const listener = (_event: unknown, payload: T) => cb(payload);
	ipcRenderer.on(channel, listener);
	return () => ipcRenderer.removeListener(channel, listener);
}

const api: PiApi = {
	...invokeApi,
	// platform：同步值，preload 注入供 renderer 按平台分流 UI
	platform: process.platform,
	// openMcpConfig：await 后返回 void（不透传 main 的返回值）
	openMcpConfig: async (cwd) => {
		await ipcRenderer.invoke(IpcChannels.McpOpenConfig, cwd);
	},
	onKnowledgeEvent: (cb) => subscribe(IpcChannels.KnowledgeEvent, cb),
	onMcpEvent: (cb) => subscribe(IpcChannels.McpEvent, cb),
	onProviderLoginEvent: (cb) => subscribe(IpcChannels.SettingsLoginEvent, cb),
	onAskRequest: (cb) => subscribe(IpcChannels.AskRequest, cb),
	onUiPluginsEvent: (cb) => subscribe(IpcChannels.UiPluginsEvent, cb),
	onUpdateEvent: (cb) => subscribe(IpcChannels.UpdateEvent, cb),
	onEvent: (cb) => subscribe(IpcChannels.Event, cb),
	onPermissionRequest: (cb) => subscribe(IpcChannels.PermissionRequest, cb),
	onPermissionResolved: (cb) => subscribe(IpcChannels.PermissionResolved, cb),
	onTrustRequest: (cb) => subscribe(IpcChannels.TrustRequest, cb),
};

contextBridge.exposeInMainWorld("pi", api);
