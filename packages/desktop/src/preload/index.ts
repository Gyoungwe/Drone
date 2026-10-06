import {
	AppContract,
	ComputeContract,
	DecisionsContract,
	DiscoveryContract,
	InquiryContract,
	InstitutionalContract,
	IpcChannels,
	KnowledgeContract,
	LanContract,
	McpContract,
	PackagesContract,
	PermissionsContract,
	type PiApi,
	SessionsContract,
	SettingsContract,
	SubagentsContract,
	UiPluginsContract,
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
	ipc: ipcRenderer,
	channelForMethod: (_contract, method) =>
		channelFrom(
			{
				getInfo: IpcChannels.AppGetInfo,
				getDiagnostics: IpcChannels.AppGetDiagnostics,
				getDailyDir: IpcChannels.AppGetDailyDir,
				openExternal: IpcChannels.AppOpenExternal,
				filePreview: IpcChannels.FilePreview,
				importDroppedFile: IpcChannels.FileImportDropped,
				resourceOpenExternal: IpcChannels.ResourceOpenExternal,
				loadTabs: IpcChannels.TabsLoad,
				saveTabs: IpcChannels.TabsSave,
				loadUiState: IpcChannels.UiStateLoad,
				saveUiState: IpcChannels.UiStateSave,
				pickBackgroundImage: IpcChannels.BackgroundPick,
				checkForUpdates: IpcChannels.UpdateCheck,
				downloadUpdate: IpcChannels.UpdateDownload,
				installUpdate: IpcChannels.UpdateInstall,
				saveFileDialog: IpcChannels.FileSaveDialog,
				pickPath: IpcChannels.FilePickPath,
				pickDirectory: IpcChannels.ProjectPickDirectory,
				getGitBranch: IpcChannels.ProjectGetGitBranch,
				listGitBranches: IpcChannels.ProjectListGitBranches,
				checkoutBranch: IpcChannels.ProjectCheckoutBranch,
			},
			method,
		),
});
const knowledgeClient = exposeContract(KnowledgeContract, {
	ipc: ipcRenderer,
	channelForMethod: (_contract, method) =>
		channelFrom(
			{
				setSpecialistSettings: IpcChannels.KnowledgeSpecialistsSettings,
				getOverview: IpcChannels.KnowledgeOverview,
				previewSetup: IpcChannels.KnowledgeSetupPreview,
				startSetup: IpcChannels.KnowledgeSetupStart,
				getJobs: IpcChannels.KnowledgeJobs,
				getReviews: IpcChannels.KnowledgeReviews,
				previewReview: IpcChannels.KnowledgeReviewPreview,
				reviewWithModel: IpcChannels.KnowledgeReviewModel,
				cancelModelReview: IpcChannels.KnowledgeReviewModelCancel,
				decideReview: IpcChannels.KnowledgeReviewDecide,
				readNote: IpcChannels.KnowledgeReadNote,
				maintain: IpcChannels.KnowledgeMaintain,
				openTarget: IpcChannels.KnowledgeOpen,
				resumeCheck: IpcChannels.KnowledgeResume,
				getSemanticStatus: IpcChannels.KnowledgeSemanticStatus,
				saveSemanticSettings: IpcChannels.KnowledgeSemanticSettingsSave,
				testSemanticProvider: IpcChannels.KnowledgeSemanticProviderTest,
				indexSemantic: IpcChannels.KnowledgeSemanticIndex,
				cancelSemanticIndex: IpcChannels.KnowledgeSemanticIndexCancel,
				search: IpcChannels.KnowledgeSearch,
				getTopics: IpcChannels.KnowledgeTopics,
				archiveTopic: IpcChannels.KnowledgeTopicArchive,
				getZoteroStatus: IpcChannels.ZoteroStatus,
			},
			method,
		),
});
const settingsClient = exposeContract(SettingsContract, {
	ipc: ipcRenderer,
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
	ipc: ipcRenderer,
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
	ipc: ipcRenderer,
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
	ipc: ipcRenderer,
	channelForMethod: (_contract, method) =>
		channelFrom(
			{
				searchCatalog: IpcChannels.PackagesSearchCatalog,
				installPackage: IpcChannels.PackagesInstall,
				removePackage: IpcChannels.PackagesRemove,
				listConfiguredPackages: IpcChannels.PackagesListConfigured,
			},
			method,
		),
});
const institutionalClient = exposeContract(InstitutionalContract, {
	ipc: ipcRenderer,
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
const lanClient = exposeContract(LanContract, {
	ipc: ipcRenderer,
	channelForMethod: (_contract, method) =>
		channelFrom(
			{
				getStatus: IpcChannels.LanGetStatus,
				setEnabled: IpcChannels.LanSetEnabled,
				setRemoteControl: IpcChannels.LanSetRemoteControl,
			},
			method,
		),
});
const mcpClient = exposeContract(McpContract, {
	ipc: ipcRenderer,
	channelForMethod: (_contract, method) =>
		channelFrom(
			{
				getStatus: IpcChannels.McpGetStatus,
				getConfig: IpcChannels.McpGetConfig,
				setServerEnabled: IpcChannels.McpSetServerEnabled,
				openConfig: IpcChannels.McpOpenConfig,
			},
			method,
		),
});
const uiPluginsClient = exposeContract(UiPluginsContract, {
	ipc: ipcRenderer,
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
const computeClient = exposeContract(ComputeContract, {
	ipc: ipcRenderer,
	channelForMethod: (_contract, method) =>
		channelFrom(
			{
				listHosts: IpcChannels.ComputeListHosts,
				getHost: IpcChannels.ComputeGetHost,
				saveHost: IpcChannels.ComputeSaveHost,
				removeHost: IpcChannels.ComputeRemoveHost,
				probeHost: IpcChannels.ComputeProbeHost,
				getHealthSnapshot: IpcChannels.ComputeHealth,
				listJobs: IpcChannels.ComputeJobs,
				getJob: IpcChannels.ComputeJob,
				submitJob: IpcChannels.ComputeSubmitJob,
				getLogs: IpcChannels.ComputeLogs,
				cancelJob: IpcChannels.ComputeCancelJob,
				openTerminal: IpcChannels.ComputeOpenTerminal,
				getTerminal: IpcChannels.ComputeGetTerminal,
				writeTerminal: IpcChannels.ComputeWriteTerminal,
				closeTerminal: IpcChannels.ComputeCloseTerminal,
				getOnboardingStatus: IpcChannels.ComputeOnboarding,
				checkOnboardingStep: IpcChannels.ComputeCheckOnboarding,
			},
			method,
		),
});
const discoveryClient = exposeContract(DiscoveryContract, {
	ipc: ipcRenderer,
	channelForMethod: (_contract, method) =>
		channelFrom(
			{
				getCapabilities: IpcChannels.DiscoveryCapabilities,
				listKernelSessions: IpcChannels.DiscoveryKernelSessions,
				getKernelSession: IpcChannels.DiscoveryKernelSession,
				closeKernelSession: IpcChannels.DiscoveryCloseKernelSession,
				listCriticReviews: IpcChannels.DiscoveryCriticReviews,
				listMultipathAssessments: IpcChannels.DiscoveryMultipathAssessments,
				listExplorationPlans: IpcChannels.DiscoveryExplorationPlans,
				listEvaluations: IpcChannels.DiscoveryEvaluations,
			},
			method,
		),
});
const decisionsClient = exposeContract(DecisionsContract, {
	ipc: ipcRenderer,
	channelForMethod: (_contract, method) =>
		channelFrom(
			{
				list: IpcChannels.DecisionsList,
				revoke: IpcChannels.DecisionsRevoke,
				confirm: IpcChannels.DecisionsConfirm,
			},
			method,
		),
});
const inquiryClient = exposeContract(InquiryContract, {
	ipc: ipcRenderer,
	channelForMethod: (_contract, method) =>
		channelFrom(
			{
				listArtifacts: IpcChannels.InquiryArtifacts,
				artifactProvenance: IpcChannels.InquiryArtifactProvenance,
				rerunArtifact: IpcChannels.InquiryRerunArtifact,
			},
			method,
		),
});
const knowledgeApi = {
	setKnowledgeSpecialistSettings: invoke(knowledgeClient, "setSpecialistSettings"),
	getKnowledgeOverview: invoke(knowledgeClient, "getOverview"),
	previewKnowledgeSetup: invoke(knowledgeClient, "previewSetup"),
	startKnowledgeSetup: invoke(knowledgeClient, "startSetup"),
	getKnowledgeJobs: invoke(knowledgeClient, "getJobs"),
	getKnowledgeReviews: invoke(knowledgeClient, "getReviews"),
	previewKnowledgeReview: invoke(knowledgeClient, "previewReview"),
	reviewKnowledgeWithModel: invoke(knowledgeClient, "reviewWithModel"),
	cancelKnowledgeModelReview: invoke(knowledgeClient, "cancelModelReview"),
	decideKnowledgeReview: invoke(knowledgeClient, "decideReview"),
	readKnowledgeNote: invoke(knowledgeClient, "readNote"),
	maintainKnowledge: invoke(knowledgeClient, "maintain"),
	openKnowledgeTarget: invoke(knowledgeClient, "openTarget"),
	resumeKnowledgeCheck: invoke(knowledgeClient, "resumeCheck"),
	getKnowledgeSemanticStatus: invoke(knowledgeClient, "getSemanticStatus"),
	saveKnowledgeSemanticSettings: invoke(knowledgeClient, "saveSemanticSettings"),
	testKnowledgeSemanticProvider: invoke(knowledgeClient, "testSemanticProvider"),
	indexKnowledgeSemantic: invoke(knowledgeClient, "indexSemantic"),
	cancelKnowledgeSemanticIndex: invoke(knowledgeClient, "cancelSemanticIndex"),
	searchKnowledge: invoke(knowledgeClient, "search"),
	getKnowledgeTopics: invoke(knowledgeClient, "getTopics"),
	archiveKnowledgeTopic: invoke(knowledgeClient, "archiveTopic"),
	getZoteroStatus: invoke(knowledgeClient, "getZoteroStatus"),
};
const invokeApi = {
	...computeClient,
	...discoveryClient,
	...decisionsClient,
	...inquiryClient,
	...knowledgeApi,
	listSessionSubagents: invoke(subagentsClient, "list"),
	dispatchSubagents: invoke(subagentsClient, "dispatch"),
	abortSubagentRun: invoke(subagentsClient, "abort"),
	listSubagentRuns: invoke(subagentsClient, "runs"),
	searchCatalog: invoke(packagesClient, "searchCatalog"),
	installPackage: invoke(packagesClient, "installPackage"),
	removePackage: invoke(packagesClient, "removePackage"),
	listConfiguredPackages: invoke(packagesClient, "listConfiguredPackages"),
	getInstitutionalStatus: invoke(institutionalClient, "getStatus"),
	saveInstitutionalConfig: invoke(institutionalClient, "saveConfig"),
	openInstitutionalLogin: invoke(institutionalClient, "openLogin"),
	openInstitutionalUrl: invoke(institutionalClient, "openUrl"),
	clearInstitutionalSession: invoke(institutionalClient, "clear"),
	testInstitutionalAccess: invoke(institutionalClient, "testAccess"),
	lanGetStatus: invoke(lanClient, "getStatus"),
	lanSetEnabled: invoke(lanClient, "setEnabled"),
	lanSetRemoteControl: invoke(lanClient, "setRemoteControl"),
	getMcpStatus: invoke(mcpClient, "getStatus"),
	getMcpConfig: invoke(mcpClient, "getConfig"),
	setMcpServerEnabled: invoke(mcpClient, "setServerEnabled"),
	openMcpConfig: invoke(mcpClient, "openConfig"),
	uiPluginsGetConfig: invoke(uiPluginsClient, "getConfig"),
	uiPluginsSetEnabled: invoke(uiPluginsClient, "setEnabled"),
	uiPluginsList: invoke(uiPluginsClient, "list"),
	uiPluginsReadCode: invoke(uiPluginsClient, "readCode"),
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
	importDroppedFile: invoke(appClient, "importDroppedFile"),
	openResourceExternal: invoke(appClient, "resourceOpenExternal"),
	loadTabs: invoke(appClient, "loadTabs"),
	saveTabs: invoke(appClient, "saveTabs"),
	loadUiState: invoke(appClient, "loadUiState"),
	saveUiState: invoke(appClient, "saveUiState"),
	pickBackgroundImage: invoke(appClient, "pickBackgroundImage"),
	checkForUpdates: invoke(appClient, "checkForUpdates"),
	downloadUpdate: invoke(appClient, "downloadUpdate"),
	installUpdate: invoke(appClient, "installUpdate"),
	pickDirectory: invoke(appClient, "pickDirectory"),
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
