import type { ZoteroLocalWriteStatus, ZoteroStatus } from "@drone/shared";
import {
	AppContract,
	BackgroundJobsContract,
	ComputeContract,
	DailyContract,
	DiscoveryContract,
	EvidenceContract,
	InstitutionalContract,
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
import { contextBridge } from "electron";
import { exposeContract } from "./expose-contract";

type InvokeFn = (...args: any[]) => Promise<any>;
const invoke = (client: Record<string, unknown>, method: string): InvokeFn =>
	((...args: any[]) => (client[method] as InvokeFn)(...args)) as InvokeFn;

const { getInfo: getAppInfo, filePreview, resourceOpenExternal, ...appClient } = exposeContract(AppContract);
const knowledgeClient = exposeContract(KnowledgeContract);
const dailyClient = exposeContract(DailyContract);
const zoteroClient = exposeContract(ZoteroContract);
const researchClient = exposeContract(ResearchContract);
const settingsClient = exposeContract(SettingsContract);
const { onLoginEvent: onProviderLoginEvent, ...settingsMethods } = settingsClient;
const permissionsClient = exposeContract(PermissionsContract);
const sessionsClient = exposeContract(SessionsContract);
const subagentsClient = exposeContract(SubagentsContract);
const packagesClient = exposeContract(PackagesContract);
const institutionalClient = exposeContract(InstitutionalContract);
const memoryClient = exposeContract(MemoryContract);
const mcpClient = exposeContract(McpContract);
const pluginRuntimeClient = exposeContract(PluginRuntimeContract);
const pluginCredentialsClient = exposeContract(PluginCredentialsContract);
const backgroundJobsClient = exposeContract(BackgroundJobsContract);
const uiPluginsClient = exposeContract(UiPluginsContract);
const computeClient = exposeContract(ComputeContract);
const evidenceClient = exposeContract(EvidenceContract);
const discoveryClient = exposeContract(DiscoveryContract);
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
	...knowledgeApi,
	...researchClient,
	listSessionSubagents: invoke(subagentsClient, "list"),
	dispatchSubagents: invoke(subagentsClient, "dispatch"),
	abortSubagentRun: invoke(subagentsClient, "abort"),
	listSubagentRuns: invoke(subagentsClient, "runs"),
	...packagesClient,
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
	...settingsMethods,
	getPermissionConfig: permissionsClient.getConfig,
	getPermissionSettings: permissionsClient.load,
	savePermissionSettings: permissionsClient.save,
	resetPermissionSettings: permissionsClient.reset,
	probePermission: permissionsClient.probe,
	getPermissionAuditTail: permissionsClient.auditTail as PiApi["getPermissionAuditTail"],
	openPermissionSettingsLocation: permissionsClient.openLocation,
	respondAsk: permissionsClient.respondAsk,
	respondPermission: permissionsClient.respondPermission,
	getPermissionMode: permissionsClient.getMode,
	setPermissionMode: permissionsClient.setMode,
	getContextManagerConfig: permissionsClient.contextManagerGetConfig,
	setContextManagerMode: permissionsClient.contextManagerSetMode,
	getChannelWatchConfig: permissionsClient.channelWatchGetConfig,
	setChannelWatchEnabled: permissionsClient.channelWatchSetEnabled,
	respondTrust: permissionsClient.respondTrust,
};

const api: PiApi = {
	...invokeApi,
	...appClient,
	...sessionsClient,
	...pluginCredentialsClient,
	...backgroundJobsClient,
	getAppInfo,
	previewFile: filePreview as PiApi["previewFile"],
	openResourceExternal: resourceOpenExternal as PiApi["openResourceExternal"],
	pickPath: appClient.pickPath as PiApi["pickPath"],
	htmlPreviewUrl: appClient.htmlPreviewUrl as PiApi["htmlPreviewUrl"],
	getFigureAnnotations: appClient.getFigureAnnotations as PiApi["getFigureAnnotations"],
	// platform：同步值，preload 注入供 renderer 按平台分流 UI
	platform: process.platform,
	onKnowledgeEvent: knowledgeClient.onEvent,
	onMcpEvent: mcpClient.onEvent,
	onProviderLoginEvent,
	onAskRequest: permissionsClient.onAskRequest,
	onAskResolved: permissionsClient.onAskResolved,
	onUiPluginsEvent: uiPluginsClient.onEvent,
	onPluginRuntimeEvent: pluginRuntimeClient.onEvent,
	onPermissionRequest: permissionsClient.onPermissionRequest,
	onPermissionResolved: permissionsClient.onPermissionResolved,
	onTrustRequest: permissionsClient.onTrustRequest,
};

contextBridge.exposeInMainWorld("pi", api);
