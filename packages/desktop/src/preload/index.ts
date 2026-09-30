import { INVOKE_ROUTES, IpcChannels, type PiApi, SessionsContract } from "@drone/shared";
import { contextBridge, ipcRenderer } from "electron";
import { exposeContract } from "./expose-contract";

// invoke 半区：从 INVOKE_ROUTES 单一事实源批量生成透传函数，不再逐条手抄。
// 参数/返回类型在 PiApi 处约束（下方 `api: PiApi` 兜底方法覆盖完整性）；此处 any 仅为桥接形状。
type InvokeApi = { [K in keyof typeof INVOKE_ROUTES]: (...args: any[]) => Promise<any> };
const invokeApi = Object.fromEntries(
	Object.entries(INVOKE_ROUTES).map(([method, channel]) => [
		method,
		(...args: any[]) => ipcRenderer.invoke(channel, ...args),
	]),
) as InvokeApi;

/** Session methods use the historical singular `session:*` channels. */
const SESSION_CHANNELS: Record<string, string> = {
	createSession: IpcChannels.SessionCreate,
	listSessions: IpcChannels.SessionList,
	listAllSessions: IpcChannels.SessionListAll,
	openSession: IpcChannels.SessionOpen,
	closeSession: IpcChannels.SessionClose,
	deleteSession: IpcChannels.SessionDelete,
	prompt: IpcChannels.SessionPrompt,
	abort: IpcChannels.SessionAbort,
	retry: IpcChannels.SessionRetry,
	setModel: IpcChannels.SessionSetModel,
	setThinkingLevel: IpcChannels.SessionSetThinkingLevel,
	compact: IpcChannels.SessionCompact,
	getStats: IpcChannels.SessionStats,
	getContextUsage: IpcChannels.SessionGetContextUsage,
	clearQueue: IpcChannels.SessionClearQueue,
	getFollowUpMessages: IpcChannels.SessionGetFollowUpMessages,
	listSlashCommands: IpcChannels.SessionListSlashCommands,
	listSlashCommandsForCwd: IpcChannels.SessionListSlashCommandsForCwd,
	setSessionName: IpcChannels.SessionSetName,
	exportSession: IpcChannels.SessionExport,
	forkSession: IpcChannels.SessionFork,
	recallMessage: IpcChannels.SessionRecall,
	getLoadedResources: IpcChannels.SessionGetLoadedResources,
	getSessionMessages: IpcChannels.SessionGetMessages,
	peekSubagentMessages: IpcChannels.SessionPeekSubagentMessages,
	steerSubagent: IpcChannels.SessionSteerSubagent,
	replySubagentSupervisor: IpcChannels.SessionReplySubagentSupervisor,
	getTodos: IpcChannels.SessionGetTodos,
	listModels: IpcChannels.ModelsList,
	listProjectFiles: IpcChannels.ProjectListFiles,
	ensureProjectTrust: IpcChannels.ProjectEnsureTrust,
};
const sessionsApi = exposeContract(SessionsContract, {
	ipc: ipcRenderer,
	channelForMethod: (_contract, method) => {
		const channel = SESSION_CHANNELS[method];
		if (!channel) throw new Error(`Missing session channel: ${method}`);
		return channel;
	},
});

/** 事件订阅：main → renderer 单向推送，`on` + 退订函数（invoke 之外的第二种 adapter 形态）。 */
function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
	const listener = (_event: unknown, payload: T) => cb(payload);
	ipcRenderer.on(channel, listener);
	return () => ipcRenderer.removeListener(channel, listener);
}

const api: PiApi = {
	...invokeApi,
	...sessionsApi,
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
