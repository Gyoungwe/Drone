import {
	IpcChannels,
	type PiApi,
	type SessionEventEnvelope,
	type UiPluginsEventPayload,
	type UpdateState,
} from "@percho/shared";
import { contextBridge, ipcRenderer } from "electron";

const api: PiApi = {
	setKnowledgeSpecialistSettings: (input) => ipcRenderer.invoke(IpcChannels.KnowledgeSpecialistsSettings, input),
	getKnowledgeOverview: (input) => ipcRenderer.invoke(IpcChannels.KnowledgeOverview, input),
	previewKnowledgeSetup: (input) => ipcRenderer.invoke(IpcChannels.KnowledgeSetupPreview, input),
	startKnowledgeSetup: (input) => ipcRenderer.invoke(IpcChannels.KnowledgeSetupStart, input),
	getKnowledgeJobs: (input) => ipcRenderer.invoke(IpcChannels.KnowledgeJobs, input),
	getKnowledgeReviews: (input) => ipcRenderer.invoke(IpcChannels.KnowledgeReviews, input),
	previewKnowledgeReview: (input) => ipcRenderer.invoke(IpcChannels.KnowledgeReviewPreview, input),
	decideKnowledgeReview: (input) => ipcRenderer.invoke(IpcChannels.KnowledgeReviewDecide, input),
	readKnowledgeNote: (input) => ipcRenderer.invoke(IpcChannels.KnowledgeReadNote, input),
	maintainKnowledge: (input) => ipcRenderer.invoke(IpcChannels.KnowledgeMaintain, input),
	openKnowledgeTarget: (input) => ipcRenderer.invoke(IpcChannels.KnowledgeOpen, input),
	resumeKnowledgeCheck: (input) => ipcRenderer.invoke(IpcChannels.KnowledgeResume, input),
	onKnowledgeEvent: (cb) => {
		const listener = (_event: unknown, value: Parameters<typeof cb>[0]) => cb(value);
		ipcRenderer.on(IpcChannels.KnowledgeEvent, listener);
		return () => ipcRenderer.removeListener(IpcChannels.KnowledgeEvent, listener);
	},
	platform: process.platform,
	createSession: (options) => ipcRenderer.invoke(IpcChannels.SessionCreate, options),
	listSessions: (cwd) => ipcRenderer.invoke(IpcChannels.SessionList, cwd),
	listAllSessions: () => ipcRenderer.invoke(IpcChannels.SessionListAll),
	openSession: (filePath) => ipcRenderer.invoke(IpcChannels.SessionOpen, filePath),
	closeSession: (sessionId) => ipcRenderer.invoke(IpcChannels.SessionClose, sessionId),
	deleteSession: (sessionId, sessionFile) =>
		ipcRenderer.invoke(IpcChannels.SessionDelete, sessionId, sessionFile),
	prompt: (sessionId, text, images) => ipcRenderer.invoke(IpcChannels.SessionPrompt, sessionId, text, images),
	abort: (sessionId) => ipcRenderer.invoke(IpcChannels.SessionAbort, sessionId),
	setModel: (sessionId, provider, modelId) =>
		ipcRenderer.invoke(IpcChannels.SessionSetModel, sessionId, provider, modelId),
	setThinkingLevel: (sessionId, level) =>
		ipcRenderer.invoke(IpcChannels.SessionSetThinkingLevel, sessionId, level),
	compact: (sessionId, customInstructions) =>
		ipcRenderer.invoke(IpcChannels.SessionCompact, sessionId, customInstructions),
	getStats: (sessionId) => ipcRenderer.invoke(IpcChannels.SessionStats, sessionId),
	getContextUsage: (sessionId) => ipcRenderer.invoke(IpcChannels.SessionGetContextUsage, sessionId),
	clearQueue: (sessionId) => ipcRenderer.invoke(IpcChannels.SessionClearQueue, sessionId),
	getFollowUpMessages: (sessionId) => ipcRenderer.invoke(IpcChannels.SessionGetFollowUpMessages, sessionId),
	listSlashCommands: (sessionId) => ipcRenderer.invoke(IpcChannels.SessionListSlashCommands, sessionId),
	listSlashCommandsForCwd: (cwd) => ipcRenderer.invoke(IpcChannels.SessionListSlashCommandsForCwd, cwd),
	setSessionName: (sessionId, name) => ipcRenderer.invoke(IpcChannels.SessionSetName, sessionId, name),
	exportSession: (sessionId, format) => ipcRenderer.invoke(IpcChannels.SessionExport, sessionId, format),
	forkSession: (sessionId, ref) => ipcRenderer.invoke(IpcChannels.SessionFork, sessionId, ref),
	recallMessage: (sessionId, ref) => ipcRenderer.invoke(IpcChannels.SessionRecall, sessionId, ref),
	getLoadedResources: (sessionId) => ipcRenderer.invoke(IpcChannels.SessionGetLoadedResources, sessionId),
	searchCatalog: (query, type, page) =>
		ipcRenderer.invoke(IpcChannels.PackagesSearchCatalog, query, type, page),
	installPackage: (name) => ipcRenderer.invoke(IpcChannels.PackagesInstall, name),
	removePackage: (source, scope) => ipcRenderer.invoke(IpcChannels.PackagesRemove, source, scope),
	listConfiguredPackages: () => ipcRenderer.invoke(IpcChannels.PackagesListConfigured),
	saveFileDialog: (defaultName, content) =>
		ipcRenderer.invoke(IpcChannels.FileSaveDialog, defaultName, content),
	previewFile: (target, cwd) => ipcRenderer.invoke(IpcChannels.FilePreview, target, cwd),
	openResourceExternal: (target, cwd) => ipcRenderer.invoke(IpcChannels.ResourceOpenExternal, target, cwd),
	getSessionMessages: (sessionId) => ipcRenderer.invoke(IpcChannels.SessionGetMessages, sessionId),
	peekSubagentMessages: (filePath) => ipcRenderer.invoke(IpcChannels.SessionPeekSubagentMessages, filePath),
	steerSubagent: (sessionId, message, mode) => ipcRenderer.invoke(IpcChannels.SessionSteerSubagent, sessionId, message, mode),
	replySubagentSupervisor: (sessionId, requestId, message) =>
		ipcRenderer.invoke(IpcChannels.SessionReplySubagentSupervisor, sessionId, requestId, message),
	getTodos: (sessionId) => ipcRenderer.invoke(IpcChannels.SessionGetTodos, sessionId),
	listModels: () => ipcRenderer.invoke(IpcChannels.ModelsList),
	listProviders: (options) => ipcRenderer.invoke(IpcChannels.SettingsListProviders, options),
	getMcpStatus: (cwd) => ipcRenderer.invoke(IpcChannels.McpGetStatus, cwd),
	getMcpConfig: (cwd) => ipcRenderer.invoke(IpcChannels.McpGetConfig, cwd),
	setMcpServerEnabled: (name, enabled, cwd) =>
		ipcRenderer.invoke(IpcChannels.McpSetServerEnabled, name, enabled, cwd),
	openMcpConfig: async (cwd) => {
		await ipcRenderer.invoke(IpcChannels.McpOpenConfig, cwd);
	},
	onMcpEvent: (cb) => {
		const listener = (_event: unknown, status: Parameters<typeof cb>[0]) => cb(status);
		ipcRenderer.on(IpcChannels.McpEvent, listener);
		return () => ipcRenderer.removeListener(IpcChannels.McpEvent, listener);
	},
	saveApiKey: (providerId, key) => ipcRenderer.invoke(IpcChannels.SettingsSaveApiKey, providerId, key),
	removeCredential: (providerId) => ipcRenderer.invoke(IpcChannels.SettingsRemoveCredential, providerId),
	addCustomProvider: (input) => ipcRenderer.invoke(IpcChannels.SettingsAddCustomProvider, input),
	updateCustomProvider: (input) => ipcRenderer.invoke(IpcChannels.SettingsUpdateCustomProvider, input),
	removeCustomProvider: (providerId) =>
		ipcRenderer.invoke(IpcChannels.SettingsRemoveCustomProvider, providerId),
	setProviderBaseUrl: (providerId, baseUrl, apiKey) =>
		ipcRenderer.invoke(IpcChannels.SettingsSetProviderBaseUrl, providerId, baseUrl, apiKey),
	testProvider: (providerId, modelId) =>
		ipcRenderer.invoke(IpcChannels.SettingsTestProvider, providerId, modelId),
	getModelPrefs: () => ipcRenderer.invoke(IpcChannels.SettingsGetModelPrefs),
	setModelHidden: (provider, modelId, hidden) =>
		ipcRenderer.invoke(IpcChannels.SettingsSetModelHidden, provider, modelId, hidden),
	setModelsHidden: (provider, modelIds, hidden) =>
		ipcRenderer.invoke(IpcChannels.SettingsSetModelsHidden, provider, modelIds, hidden),
	setSubagentModel: (agent, modelRef) =>
		ipcRenderer.invoke(IpcChannels.SettingsSetSubagentModel, agent, modelRef),
	listSubagents: () => ipcRenderer.invoke(IpcChannels.SettingsListSubagents),
	startProviderLogin: (loginId, providerId) =>
		ipcRenderer.invoke(IpcChannels.SettingsLoginStart, loginId, providerId),
	cancelProviderLogin: (loginId) => ipcRenderer.invoke(IpcChannels.SettingsLoginCancel, loginId),
	respondProviderLogin: (loginId, promptId, value) =>
		ipcRenderer.invoke(IpcChannels.SettingsLoginRespond, loginId, promptId, value),
	onProviderLoginEvent: (cb) => {
		const listener = (_event: unknown, payload: Parameters<typeof cb>[0]) => cb(payload);
		ipcRenderer.on(IpcChannels.SettingsLoginEvent, listener);
		return () => ipcRenderer.removeListener(IpcChannels.SettingsLoginEvent, listener);
	},
	respondAsk: (requestId, response) => ipcRenderer.invoke(IpcChannels.AskRespond, requestId, response),
	onAskRequest: (cb) => {
		const listener = (_event: unknown, req: Parameters<typeof cb>[0]) => cb(req);
		ipcRenderer.on(IpcChannels.AskRequest, listener);
		return () => ipcRenderer.removeListener(IpcChannels.AskRequest, listener);
	},
	respondPermission: (requestId, answer) =>
		ipcRenderer.invoke(IpcChannels.PermissionRespond, requestId, answer),
	getPermissionConfig: () => ipcRenderer.invoke(IpcChannels.PermissionGetConfig),
	getPermissionMode: (sessionId) => ipcRenderer.invoke(IpcChannels.PermissionGetMode, sessionId),
	setPermissionMode: (sessionId, mode) => ipcRenderer.invoke(IpcChannels.PermissionSetMode, sessionId, mode),
	getContextManagerConfig: () => ipcRenderer.invoke(IpcChannels.ContextManagerGetConfig),
	setContextManagerMode: (mode) => ipcRenderer.invoke(IpcChannels.ContextManagerSetMode, mode),
	getChannelWatchConfig: () => ipcRenderer.invoke(IpcChannels.ChannelWatchGetConfig),
	setChannelWatchEnabled: (enabled) => ipcRenderer.invoke(IpcChannels.ChannelWatchSetEnabled, enabled),
	lanGetStatus: () => ipcRenderer.invoke(IpcChannels.LanGetStatus),
	lanSetEnabled: (enabled) => ipcRenderer.invoke(IpcChannels.LanSetEnabled, enabled),
	lanSetRemoteControl: (enabled) => ipcRenderer.invoke(IpcChannels.LanSetRemoteControl, enabled),
	respondTrust: (requestId, answer) => ipcRenderer.invoke(IpcChannels.TrustRespond, requestId, answer),
	ensureProjectTrust: (cwd) => ipcRenderer.invoke(IpcChannels.ProjectEnsureTrust, cwd),
	pickDirectory: () => ipcRenderer.invoke(IpcChannels.ProjectPickDirectory),
	listProjectFiles: (cwd) => ipcRenderer.invoke(IpcChannels.ProjectListFiles, cwd),
	getGitBranch: (cwd) => ipcRenderer.invoke(IpcChannels.ProjectGetGitBranch, cwd),
	listGitBranches: (cwd) => ipcRenderer.invoke(IpcChannels.ProjectListGitBranches, cwd),
	checkoutBranch: (cwd, branch) => ipcRenderer.invoke(IpcChannels.ProjectCheckoutBranch, cwd, branch),
	openExternal: (url) => ipcRenderer.invoke(IpcChannels.AppOpenExternal, url),
	getAppInfo: () => ipcRenderer.invoke(IpcChannels.AppGetInfo),
	getDailyDir: () => ipcRenderer.invoke(IpcChannels.AppGetDailyDir),
	loadTabs: () => ipcRenderer.invoke(IpcChannels.TabsLoad),
	saveTabs: (tabs) => ipcRenderer.invoke(IpcChannels.TabsSave, tabs),
	loadUiState: () => ipcRenderer.invoke(IpcChannels.UiStateLoad),
	saveUiState: (state) => ipcRenderer.invoke(IpcChannels.UiStateSave, state),
	pickBackgroundImage: () => ipcRenderer.invoke(IpcChannels.BackgroundPick),
	checkForUpdates: () => ipcRenderer.invoke(IpcChannels.UpdateCheck),
	downloadUpdate: () => ipcRenderer.invoke(IpcChannels.UpdateDownload),
	installUpdate: () => ipcRenderer.invoke(IpcChannels.UpdateInstall),
	uiPluginsGetConfig: () => ipcRenderer.invoke(IpcChannels.UiPluginsGetConfig),
	uiPluginsSetEnabled: (enabled) => ipcRenderer.invoke(IpcChannels.UiPluginsSetEnabled, enabled),
	uiPluginsList: () => ipcRenderer.invoke(IpcChannels.UiPluginsList),
	uiPluginsReadCode: (name) => ipcRenderer.invoke(IpcChannels.UiPluginsReadCode, name),
	uiPluginsSetPluginEnabled: (name, enabled) =>
		ipcRenderer.invoke(IpcChannels.UiPluginsSetPluginEnabled, name, enabled),
	uiPluginsAssignSlot: (slot, pluginName) =>
		ipcRenderer.invoke(IpcChannels.UiPluginsAssignSlot, slot, pluginName),
	uiPluginsRebuild: (name) => ipcRenderer.invoke(IpcChannels.UiPluginsRebuild, name),
	uiPluginsOpenDir: (name) => ipcRenderer.invoke(IpcChannels.UiPluginsOpenDir, name),
	onUiPluginsEvent: (cb) => {
		const listener = (_event: unknown, payload: UiPluginsEventPayload) => cb(payload);
		ipcRenderer.on(IpcChannels.UiPluginsEvent, listener);
		return () => ipcRenderer.removeListener(IpcChannels.UiPluginsEvent, listener);
	},
	onUpdateEvent: (cb) => {
		const listener = (_event: unknown, state: UpdateState) => cb(state);
		ipcRenderer.on(IpcChannels.UpdateEvent, listener);
		return () => ipcRenderer.removeListener(IpcChannels.UpdateEvent, listener);
	},
	onEvent: (cb) => {
		const listener = (_event: unknown, payload: SessionEventEnvelope) => cb(payload);
		ipcRenderer.on(IpcChannels.Event, listener);
		return () => ipcRenderer.removeListener(IpcChannels.Event, listener);
	},
	onPermissionRequest: (cb) => {
		const listener = (_event: unknown, req: Parameters<typeof cb>[0]) => cb(req);
		ipcRenderer.on(IpcChannels.PermissionRequest, listener);
		return () => ipcRenderer.removeListener(IpcChannels.PermissionRequest, listener);
	},
	onPermissionResolved: (cb) => {
		const listener = (_event: unknown, result: Parameters<typeof cb>[0]) => cb(result);
		ipcRenderer.on(IpcChannels.PermissionResolved, listener);
		return () => ipcRenderer.removeListener(IpcChannels.PermissionResolved, listener);
	},
	onTrustRequest: (cb) => {
		const listener = (_event: unknown, req: Parameters<typeof cb>[0]) => cb(req);
		ipcRenderer.on(IpcChannels.TrustRequest, listener);
		return () => ipcRenderer.removeListener(IpcChannels.TrustRequest, listener);
	},
};

contextBridge.exposeInMainWorld("pi", api);
