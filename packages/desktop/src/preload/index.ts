import type { ZoteroLocalWriteStatus, ZoteroStatus } from "@drone/shared";
import {
	AppContract,
	BackgroundJobsContract,
	ComputeContract,
	DailyContract,
	DecisionsContract,
	DiscoveryContract,
	EvidenceContract,
	InquiryContract,
	InstitutionalContract,
	IpcChannels,
	KnowledgeContract,
	McpContract,
	MemoryContract,
	PackagesContract,
	PermissionsContract,
	type PiApi,
	PluginCredentialsContract,
	PluginRuntimeContract,
	ResearchContract,
	SessionsContract,
	SettingsContract,
	SubagentsContract,
	UiPluginsContract,
	ZoteroContract,
} from "@drone/shared";
import { contextBridge, ipcRenderer } from "electron";
import { exposeContract } from "./expose-contract";

type InvokeFn = (...args: any[]) => Promise<any>;
const invoke = (client: Record<string, unknown>, method: string): InvokeFn =>
	((...args: any[]) => (client[method] as InvokeFn)(...args)) as InvokeFn;

const channelFrom = (channels: Record<string, string>, method: string): string => {
	const channel = channels[method];
	if (!channel) throw new Error(`Missing IPC channel mapping: ${method}`);
	return channel;
};

const appClient = exposeContract(AppContract, {
	channelForMethod: (_contract, method) =>
		channelFrom(
			{
				getInfo: IpcChannels.AppGetInfo,
				getDiagnostics: IpcChannels.AppGetDiagnostics,
				getDailyDir: IpcChannels.AppGetDailyDir,
				openExternal: IpcChannels.AppOpenExternal,
				filePreview: IpcChannels.FilePreview,
				htmlPreviewUrl: IpcChannels.FileHtmlPreviewUrl,
				getFigureAnnotations: IpcChannels.FigureAnnotationsGet,
				saveFigureAnnotations: IpcChannels.FigureAnnotationsSave,
				importDroppedFile: IpcChannels.FileImportDropped,
				resourceOpenExternal: IpcChannels.ResourceOpenExternal,
				fileAction: IpcChannels.FileAction,
				hostEnvironment: IpcChannels.HostEnvironment,
				pickDownloadDir: IpcChannels.DownloadDirPick,
				setAttentionBadge: IpcChannels.AttentionBadgeSet,
				loadTabs: IpcChannels.TabsLoad,
				saveTabs: IpcChannels.TabsSave,
				loadUiState: IpcChannels.UiStateLoad,
				saveUiState: IpcChannels.UiStateSave,
				pickBackgroundImage: IpcChannels.BackgroundPick,
				checkForUpdates: IpcChannels.UpdateCheck,
				downloadUpdate: IpcChannels.UpdateDownload,
				installUpdate: IpcChannels.UpdateInstall,
				checkResearchSkills: IpcChannels.ResearchSkillCheck,
				updateResearchSkills: IpcChannels.ResearchSkillUpdate,
				restartForResearchSkills: IpcChannels.ResearchSkillRestart,
				listSkillRepositories: IpcChannels.SkillRepositoryList,
				addSkillRepository: IpcChannels.SkillRepositoryAdd,
				checkSkillRepository: IpcChannels.SkillRepositoryCheck,
				updateSkillRepository: IpcChannels.SkillRepositoryUpdate,
				removeSkillRepository: IpcChannels.SkillRepositoryRemove,
				saveFileDialog: IpcChannels.FileSaveDialog,
				pickPath: IpcChannels.FilePickPath,
				pickDirectory: IpcChannels.ProjectPickDirectory,
				formalKnowledgeVault: IpcChannels.KnowledgeFormalVault,
				getGitBranch: IpcChannels.ProjectGetGitBranch,
				listGitBranches: IpcChannels.ProjectListGitBranches,
				checkoutBranch: IpcChannels.ProjectCheckoutBranch,
			},
			method,
		),
});
const knowledgeClient = exposeContract(KnowledgeContract);
const dailyClient = exposeContract(DailyContract);
const zoteroClient = exposeContract(ZoteroContract);
const researchClient = exposeContract(ResearchContract);
const settingsClient = exposeContract(SettingsContract, {
	channelForMethod: (_contract, method) =>
		channelFrom(
			{
				listProviders: IpcChannels.SettingsListProviders,
				saveApiKey: IpcChannels.SettingsSaveApiKey,
				removeCredential: IpcChannels.SettingsRemoveCredential,
				addCustomProvider: IpcChannels.SettingsAddCustomProvider,
				updateCustomProvider: IpcChannels.SettingsUpdateCustomProvider,
				removeCustomProvider: IpcChannels.SettingsRemoveCustomProvider,
				setProviderBaseUrl: IpcChannels.SettingsSetProviderBaseUrl,
				testProvider: IpcChannels.SettingsTestProvider,
				getModelPrefs: IpcChannels.SettingsGetModelPrefs,
				setModelHidden: IpcChannels.SettingsSetModelHidden,
				setModelsHidden: IpcChannels.SettingsSetModelsHidden,
				setSubagentModel: IpcChannels.SettingsSetSubagentModel,
				setSubagentThinking: IpcChannels.SettingsSetSubagentThinking,
				setBackgroundReviewerModel: IpcChannels.SettingsSetBackgroundReviewerModel,
				listSubagents: IpcChannels.SettingsListSubagents,
				startProviderLogin: IpcChannels.SettingsLoginStart,
				cancelProviderLogin: IpcChannels.SettingsLoginCancel,
				respondProviderLogin: IpcChannels.SettingsLoginRespond,
			},
			method,
		),
});
const permissionsClient = exposeContract(PermissionsContract, {
	channelForMethod: (_contract, method) =>
		channelFrom(
			{
				load: IpcChannels.PermissionSettingsLoad,
				save: IpcChannels.PermissionSettingsSave,
				reset: IpcChannels.PermissionSettingsReset,
				probe: IpcChannels.PermissionSettingsProbe,
				auditTail: IpcChannels.PermissionSettingsAuditTail,
				respondAsk: IpcChannels.AskRespond,
				respondPermission: IpcChannels.PermissionRespond,
				getConfig: IpcChannels.PermissionGetConfig,
				getMode: IpcChannels.PermissionGetMode,
				setMode: IpcChannels.PermissionSetMode,
				contextManagerGetConfig: IpcChannels.ContextManagerGetConfig,
				contextManagerSetMode: IpcChannels.ContextManagerSetMode,
				channelWatchGetConfig: IpcChannels.ChannelWatchGetConfig,
				channelWatchSetEnabled: IpcChannels.ChannelWatchSetEnabled,
				respondTrust: IpcChannels.TrustRespond,
				openLocation: IpcChannels.PermissionSettingsOpenLocation,
			},
			method,
		),
});
const subagentsClient = exposeContract(SubagentsContract, {
	channelForMethod: (_contract, method) =>
		channelFrom(
			{
				list: IpcChannels.SubagentsList,
				dispatch: IpcChannels.SubagentsDispatch,
				abort: IpcChannels.SubagentsAbort,
				runs: IpcChannels.SubagentsRuns,
			},
			method,
		),
});
const packagesClient = exposeContract(PackagesContract, {
	channelForMethod: (_contract, method) =>
		channelFrom(
			{
				searchCatalog: IpcChannels.PackagesSearchCatalog,
				installPackage: IpcChannels.PackagesInstall,
				updatePackage: IpcChannels.PackagesUpdate,
				rollbackPackage: IpcChannels.PackagesRollback,
				removePackage: IpcChannels.PackagesRemove,
				listConfiguredPackages: IpcChannels.PackagesListConfigured,
				latestPackageVersions: IpcChannels.PackagesLatestVersions,
				pluginPackageMetadata: IpcChannels.PackagesPluginMetadata,
			},
			method,
		),
});
const institutionalClient = exposeContract(InstitutionalContract, {
	channelForMethod: (_contract, method) =>
		channelFrom(
			{
				getStatus: IpcChannels.InstitutionalGetStatus,
				saveConfig: IpcChannels.InstitutionalSaveConfig,
				openLogin: IpcChannels.InstitutionalOpenLogin,
				openUrl: IpcChannels.InstitutionalOpenUrl,
				clear: IpcChannels.InstitutionalClear,
				testAccess: IpcChannels.InstitutionalTestAccess,
			},
			method,
		),
});
const memoryClient = exposeContract(MemoryContract, {
	channelForMethod: (_contract, method) =>
		channelFrom(
			{
				getStatus: IpcChannels.MemoryGetStatus,
				setEnabled: IpcChannels.MemorySetEnabled,
				clear: IpcChannels.MemoryClear,
				list: IpcChannels.MemoryList,
				remove: IpcChannels.MemoryRemove,
				promote: IpcChannels.MemoryPromote,
				promoteToKnowledge: IpcChannels.MemoryPromoteToKnowledge,
			},
			method,
		),
});
const mcpClient = exposeContract(McpContract, {
	channelForMethod: (_contract, method) =>
		channelFrom(
			{
				getStatus: IpcChannels.McpGetStatus,
				getConfig: IpcChannels.McpGetConfig,
				setServerEnabled: IpcChannels.McpSetServerEnabled,
				openConfig: IpcChannels.McpOpenConfig,
				addPreset: IpcChannels.McpAddPreset,
			},
			method,
		),
});
const pluginRuntimeClient = exposeContract(PluginRuntimeContract);
const pluginCredentialsClient = exposeContract(PluginCredentialsContract);
const backgroundJobsClient = exposeContract(BackgroundJobsContract);
const uiPluginsClient = exposeContract(UiPluginsContract, {
	channelForMethod: (_contract, method) =>
		channelFrom(
			{
				getConfig: IpcChannels.UiPluginsGetConfig,
				setEnabled: IpcChannels.UiPluginsSetEnabled,
				list: IpcChannels.UiPluginsList,
				readCode: IpcChannels.UiPluginsReadCode,
				setPluginEnabled: IpcChannels.UiPluginsSetPluginEnabled,
				assignSlot: IpcChannels.UiPluginsAssignSlot,
				rebuild: IpcChannels.UiPluginsRebuild,
				openDir: IpcChannels.UiPluginsOpenDir,
			},
			method,
		),
});
const computeClient = exposeContract(ComputeContract);
const evidenceClient = exposeContract(EvidenceContract);
const discoveryClient = exposeContract(DiscoveryContract);
const decisionsClient = exposeContract(DecisionsContract);
const inquiryClient = exposeContract(InquiryContract);
/**
 * 中性路由客户端：域由通道承载，域内操作名由载荷承载。
 * 宿主只保留操作名清单作为授权边界；域内的 schema 与校验归插件所有。
 */
const knowledgeApi = {
	invokeKnowledge: (route: { operation: string; input?: unknown }) => knowledgeClient.invoke(route),
	invokeDaily: (route: { operation: string; input?: unknown }) => dailyClient.invoke(route),
	invokeZotero: (route: { operation: string; input?: unknown }) => zoteroClient.invoke(route),
	/** 宿主自己的技能设置面板直接读 Zotero 状态；插件侧走 invokeZotero 路由。 */
	getZoteroStatus: () => zoteroClient.invoke({ operation: "status" }) as Promise<ZoteroStatus>,
	getZoteroLocalWrite: () =>
		zoteroClient.invoke({ operation: "localWrite.get" }) as Promise<ZoteroLocalWriteStatus>,
};
const invokeApi = {
	...computeClient,
	...discoveryClient,
	...evidenceClient,
	...decisionsClient,
	...inquiryClient,
	...knowledgeApi,
	...researchClient,
	listSessionSubagents: invoke(subagentsClient, "list"),
	dispatchSubagents: invoke(subagentsClient, "dispatch"),
	abortSubagentRun: invoke(subagentsClient, "abort"),
	listSubagentRuns: invoke(subagentsClient, "runs"),
	searchCatalog: invoke(packagesClient, "searchCatalog"),
	installPackage: invoke(packagesClient, "installPackage"),
	updatePackage: invoke(packagesClient, "updatePackage"),
	rollbackPackage: invoke(packagesClient, "rollbackPackage"),
	removePackage: invoke(packagesClient, "removePackage"),
	listConfiguredPackages: invoke(packagesClient, "listConfiguredPackages"),
	latestPackageVersions: invoke(packagesClient, "latestPackageVersions"),
	pluginPackageMetadata: invoke(packagesClient, "pluginPackageMetadata"),
	getInstitutionalStatus: invoke(institutionalClient, "getStatus"),
	saveInstitutionalConfig: invoke(institutionalClient, "saveConfig"),
	openInstitutionalLogin: invoke(institutionalClient, "openLogin"),
	openInstitutionalUrl: invoke(institutionalClient, "openUrl"),
	clearInstitutionalSession: invoke(institutionalClient, "clear"),
	testInstitutionalAccess: invoke(institutionalClient, "testAccess"),
	memoryGetStatus: invoke(memoryClient, "getStatus"),
	memorySetEnabled: invoke(memoryClient, "setEnabled"),
	memoryClear: invoke(memoryClient, "clear"),
	memoryList: invoke(memoryClient, "list"),
	memoryRemove: invoke(memoryClient, "remove"),
	memoryPromote: invoke(memoryClient, "promote"),
	memoryPromoteToKnowledge: invoke(memoryClient, "promoteToKnowledge"),
	getMcpStatus: invoke(mcpClient, "getStatus"),
	getMcpConfig: invoke(mcpClient, "getConfig"),
	setMcpServerEnabled: invoke(mcpClient, "setServerEnabled"),
	addMcpPreset: invoke(mcpClient, "addPreset"),
	openMcpConfig: invoke(mcpClient, "openConfig"),
	uiPluginsGetConfig: invoke(uiPluginsClient, "getConfig"),
	uiPluginsSetEnabled: invoke(uiPluginsClient, "setEnabled"),
	uiPluginsList: invoke(uiPluginsClient, "list"),
	uiPluginsReadCode: invoke(uiPluginsClient, "readCode"),
	pluginRuntimeInvoke: invoke(pluginRuntimeClient, "invoke"),
	pluginRuntimeCancel: invoke(pluginRuntimeClient, "cancel"),
	pluginRuntimeSelectSession: invoke(pluginRuntimeClient, "selectSession"),
	uiPluginsSetPluginEnabled: invoke(uiPluginsClient, "setPluginEnabled"),
	uiPluginsAssignSlot: invoke(uiPluginsClient, "assignSlot"),
	uiPluginsRebuild: invoke(uiPluginsClient, "rebuild"),
	uiPluginsOpenDir: invoke(uiPluginsClient, "openDir"),
	listProviders: invoke(settingsClient, "listProviders"),
	saveApiKey: invoke(settingsClient, "saveApiKey"),
	removeCredential: invoke(settingsClient, "removeCredential"),
	addCustomProvider: invoke(settingsClient, "addCustomProvider"),
	updateCustomProvider: invoke(settingsClient, "updateCustomProvider"),
	removeCustomProvider: invoke(settingsClient, "removeCustomProvider"),
	setProviderBaseUrl: invoke(settingsClient, "setProviderBaseUrl"),
	testProvider: invoke(settingsClient, "testProvider"),
	getModelPrefs: invoke(settingsClient, "getModelPrefs"),
	setModelHidden: invoke(settingsClient, "setModelHidden"),
	setModelsHidden: invoke(settingsClient, "setModelsHidden"),
	setSubagentModel: invoke(settingsClient, "setSubagentModel"),
	setSubagentThinking: invoke(settingsClient, "setSubagentThinking"),
	setBackgroundReviewerModel: invoke(settingsClient, "setBackgroundReviewerModel"),
	listSubagents: invoke(settingsClient, "listSubagents"),
	startProviderLogin: invoke(settingsClient, "startProviderLogin"),
	cancelProviderLogin: invoke(settingsClient, "cancelProviderLogin"),
	respondProviderLogin: invoke(settingsClient, "respondProviderLogin"),
	getPermissionConfig: invoke(permissionsClient, "getConfig"),
	getPermissionSettings: invoke(permissionsClient, "load"),
	savePermissionSettings: invoke(permissionsClient, "save"),
	resetPermissionSettings: invoke(permissionsClient, "reset"),
	probePermission: invoke(permissionsClient, "probe"),
	getPermissionAuditTail: invoke(permissionsClient, "auditTail"),
	openPermissionSettingsLocation: invoke(permissionsClient, "openLocation"),
	respondAsk: invoke(permissionsClient, "respondAsk"),
	respondPermission: invoke(permissionsClient, "respondPermission"),
	getPermissionMode: invoke(permissionsClient, "getMode"),
	setPermissionMode: invoke(permissionsClient, "setMode"),
	getContextManagerConfig: invoke(permissionsClient, "contextManagerGetConfig"),
	setContextManagerMode: invoke(permissionsClient, "contextManagerSetMode"),
	getChannelWatchConfig: invoke(permissionsClient, "channelWatchGetConfig"),
	setChannelWatchEnabled: invoke(permissionsClient, "channelWatchSetEnabled"),
	respondTrust: invoke(permissionsClient, "respondTrust"),
	getAppInfo: invoke(appClient, "getInfo"),
	getDiagnostics: invoke(appClient, "getDiagnostics"),
	getDailyDir: invoke(appClient, "getDailyDir"),
	openExternal: invoke(appClient, "openExternal"),
	saveFileDialog: invoke(appClient, "saveFileDialog"),
	pickPath: invoke(appClient, "pickPath"),
	previewFile: invoke(appClient, "filePreview"),
	htmlPreviewUrl: invoke(appClient, "htmlPreviewUrl"),
	getFigureAnnotations: invoke(appClient, "getFigureAnnotations"),
	saveFigureAnnotations: invoke(appClient, "saveFigureAnnotations"),
	importDroppedFile: invoke(appClient, "importDroppedFile"),
	openResourceExternal: invoke(appClient, "resourceOpenExternal"),
	fileAction: invoke(appClient, "fileAction"),
	hostEnvironment: invoke(appClient, "hostEnvironment"),
	pickDownloadDir: invoke(appClient, "pickDownloadDir"),
	setAttentionBadge: invoke(appClient, "setAttentionBadge"),
	loadTabs: invoke(appClient, "loadTabs"),
	saveTabs: invoke(appClient, "saveTabs"),
	loadUiState: invoke(appClient, "loadUiState"),
	saveUiState: invoke(appClient, "saveUiState"),
	pickBackgroundImage: invoke(appClient, "pickBackgroundImage"),
	checkForUpdates: invoke(appClient, "checkForUpdates"),
	downloadUpdate: invoke(appClient, "downloadUpdate"),
	installUpdate: invoke(appClient, "installUpdate"),
	checkResearchSkills: invoke(appClient, "checkResearchSkills"),
	updateResearchSkills: invoke(appClient, "updateResearchSkills"),
	restartForResearchSkills: invoke(appClient, "restartForResearchSkills"),
	listSkillRepositories: invoke(appClient, "listSkillRepositories"),
	addSkillRepository: invoke(appClient, "addSkillRepository"),
	checkSkillRepository: invoke(appClient, "checkSkillRepository"),
	updateSkillRepository: invoke(appClient, "updateSkillRepository"),
	removeSkillRepository: invoke(appClient, "removeSkillRepository"),
	pickDirectory: invoke(appClient, "pickDirectory"),
	formalKnowledgeVault: invoke(appClient, "formalKnowledgeVault"),
	getGitBranch: invoke(appClient, "getGitBranch"),
	listGitBranches: invoke(appClient, "listGitBranches"),
	checkoutBranch: invoke(appClient, "checkoutBranch"),
};

/** Session methods use the historical singular `session:*` channels. */
const SESSION_CHANNELS: Record<string, string> = {
	createSession: IpcChannels.SessionCreate,
	listSessions: IpcChannels.SessionList,
	listAllSessions: IpcChannels.SessionListAll,
	openSession: IpcChannels.SessionOpen,
	closeSession: IpcChannels.SessionClose,
	deleteSession: IpcChannels.SessionDelete,
	prompt: IpcChannels.SessionPrompt,
	command: IpcChannels.SessionCommand,
	abort: IpcChannels.SessionAbort,
	retry: IpcChannels.SessionRetry,
	setModel: IpcChannels.SessionSetModel,
	setThinkingLevel: IpcChannels.SessionSetThinkingLevel,
	setAgentMode: IpcChannels.SessionSetAgentMode,
	setSkillNamesEnabled: IpcChannels.SessionSetSkillNamesEnabled,
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
	...pluginCredentialsClient,
	...backgroundJobsClient,
	// platform：同步值，preload 注入供 renderer 按平台分流 UI
	platform: process.platform,
	onKnowledgeEvent: (cb) => subscribe(IpcChannels.KnowledgeEvent, cb),
	onMcpEvent: (cb) => subscribe(IpcChannels.McpEvent, cb),
	onProviderLoginEvent: (cb) => subscribe(IpcChannels.SettingsLoginEvent, cb),
	onAskRequest: (cb) => subscribe(IpcChannels.AskRequest, cb),
	onAskResolved: (cb) => subscribe(IpcChannels.AskResolved, cb),
	onUiPluginsEvent: (cb) => subscribe(IpcChannels.UiPluginsEvent, cb),
	onPluginRuntimeEvent: (cb) => subscribe(IpcChannels.PluginRuntimeEvent, cb),
	onUpdateEvent: (cb) => subscribe(IpcChannels.UpdateEvent, cb),
	onResearchSkillUpdateEvent: (cb) => subscribe(IpcChannels.ResearchSkillUpdateEvent, cb),
	onDesktopCommand: (cb) => subscribe(IpcChannels.DesktopCommand, cb),
	onEvent: (cb) => subscribe(IpcChannels.Event, cb),
	onPermissionRequest: (cb) => subscribe(IpcChannels.PermissionRequest, cb),
	onPermissionResolved: (cb) => subscribe(IpcChannels.PermissionResolved, cb),
	onTrustRequest: (cb) => subscribe(IpcChannels.TrustRequest, cb),
};

contextBridge.exposeInMainWorld("pi", api);
