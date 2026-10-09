import type { AskRequest, AskResponse } from "./ask";
import type { DecisionsApi } from "./decisions";
import type { DiagnosticsSnapshot } from "./diagnostics";
import type { ComputeApi } from "./host-api/compute";
import type { DiscoveryApi } from "./host-api/discovery";
import type { InquiryApi } from "./host-api/inquiry";
import type { LanStatus } from "./host-api/lan";
import type { SessionsApi } from "./host-api/sessions";
import type { InstitutionalSaveInput, InstitutionalStatus, InstitutionalTestResult } from "./institutional";
import type { KnowledgeApi } from "./knowledge";
import type { McpConfigSnapshot, McpPreset, McpStatus, McpStatusEvent } from "./mcp";
import type { CatalogPackageType, CatalogSearchResult, ConfiguredPackageInfo } from "./packages";
import type {
	PermissionAuditTailEntry,
	PermissionProbeInput,
	PermissionProbeResult,
	PermissionSettingsSaveInput,
	PermissionSettingsSaveResult,
	PermissionSettingsSnapshot,
} from "./permission-settings";
import type {
	AppInfo,
	ChannelWatchConfigInfo,
	ContextManagerConfigInfo,
	ContextManagerMode,
	GitBranches,
	PermissionAnswer,
	PermissionConfigInfo,
	PermissionMode,
	PermissionRequest,
	PermissionResolved,
	SavedTabs,
	SessionEventEnvelope,
	TrustAnswer,
	TrustRequest,
	UiState,
} from "./session";
import type {
	CustomProviderInput,
	CustomProviderUpdateInput,
	ListProvidersOptions,
	LoginEventPayload,
	LoginResult,
	ModelPrefs,
	ProviderInfo,
	ProviderTestResult,
	SubagentInfo,
} from "./settings";
import type {
	SubagentDispatchInput,
	SubagentDispatchReceipt,
	SubagentPanelRun,
	SubagentPanelSnapshot,
} from "./subagent";
import type { UiPluginInfo, UiPluginManifest, UiPluginsConfig, UiPluginsEventPayload } from "./ui-plugins";
import type { UpdateState } from "./update";
import type {
	ZoteroLocalWriteStatus,
	ZoteroStatus,
	ZoteroWebApiSaveInput,
	ZoteroWebApiStatus,
} from "./zotero";

export interface ResourcePreviewResult {
	encoding?: string;
	compression?: "gzip";
	path: string;
	name: string;
	mimeType: string;
	size: number;
	kind: "text" | "image" | "pdf" | "binary";
	text?: string;
	data?: string;
	truncated?: boolean;
}

/** 图上的一处标注：坐标为相对图像/页面宽高的比例（0–1） */
export interface FigureAnnotation {
	id: string;
	x: number;
	y: number;
	text: string;
	createdAt: string;
}

/** A user-dropped file copied into the app-owned session attachment store. */
export interface ImportedAttachment {
	path: string;
	name: string;
	bytes: number;
}

/** IPC 通道名常量 */
export const IpcChannels = {
	KnowledgeCloudStatus: "knowledge:cloudStatus",
	KnowledgeCloudProbe: "knowledge:cloudProbe",
	KnowledgeCloudInitialize: "knowledge:cloudInitialize",
	KnowledgeCloudReadNote: "knowledge:cloudReadNote",
	KnowledgeCloudWriteNote: "knowledge:cloudWriteNote",
	KnowledgeCloudSync: "knowledge:cloudSync",
	KnowledgeOverview: "knowledge:overview",
	KnowledgeResearchRuns: "knowledge:researchRuns",
	KnowledgeResearchRun: "knowledge:researchRun",
	KnowledgeSpecialistsSettings: "knowledge:specialistsSettings",
	KnowledgeSetupPreview: "knowledge:setupPreview",
	KnowledgeSetupStart: "knowledge:setupStart",
	KnowledgeJobs: "knowledge:jobs",
	KnowledgeReviews: "knowledge:reviews",
	KnowledgeReviewPreview: "knowledge:reviewPreview",
	KnowledgeReviewModel: "knowledge:reviewModel",
	KnowledgeReviewModelCancel: "knowledge:reviewModelCancel",
	KnowledgeReviewDecide: "knowledge:reviewDecide",
	KnowledgeReadNote: "knowledge:readNote",
	KnowledgeMaintain: "knowledge:maintain",
	KnowledgeOpen: "knowledge:open",
	KnowledgeResume: "knowledge:resume",
	KnowledgeEvent: "knowledge:event",
	KnowledgeSemanticStatus: "knowledge:semanticStatus",
	KnowledgeSemanticSettingsSave: "knowledge:semanticSettingsSave",
	KnowledgeSemanticProviderTest: "knowledge:semanticProviderTest",
	KnowledgeSemanticIndex: "knowledge:semanticIndex",
	KnowledgeSemanticIndexCancel: "knowledge:semanticIndexCancel",
	KnowledgeSearch: "knowledge:search",
	KnowledgeNoteLinks: "knowledge:noteLinks",
	KnowledgeGraph: "knowledge:graph",
	KnowledgeDailyDiscovery: "knowledge:dailyDiscovery",
	KnowledgeDailyDiscoveryUpdate: "knowledge:dailyDiscoveryUpdate",
	KnowledgeDailyIdeaDecide: "knowledge:dailyIdeaDecide",
	KnowledgeTopics: "knowledge:topics",
	KnowledgeTopicArchive: "knowledge:topicArchive",
	/** 远程计算：主机、健康、作业、终端与引导（由 ComputeContract 投影） */
	ComputeListHosts: "compute:listHosts",
	ComputeGetHost: "compute:getHost",
	ComputeSaveHost: "compute:saveHost",
	ComputeRemoveHost: "compute:removeHost",
	ComputeProbeHost: "compute:probeHost",
	ComputeHealth: "compute:getHealthSnapshot",
	ComputeJobs: "compute:listJobs",
	ComputeJob: "compute:getJob",
	ComputeSubmitJob: "compute:submitJob",
	ComputeLogs: "compute:getLogs",
	ComputeCancelJob: "compute:cancelJob",
	ComputeOpenTerminal: "compute:openTerminal",
	ComputeGetTerminal: "compute:getTerminal",
	ComputeWriteTerminal: "compute:writeTerminal",
	ComputeCloseTerminal: "compute:closeTerminal",
	ComputeOnboarding: "compute:getOnboardingStatus",
	ComputeCheckOnboarding: "compute:checkOnboardingStep",
	ComputeHealthEvent: "compute:healthChanged",
	ComputeJobEvent: "compute:jobUpdated",
	ComputeLogEvent: "compute:logChunk",
	ComputeTerminalOutputEvent: "compute:terminalOutput",
	ComputeTerminalClosedEvent: "compute:terminalClosed",
	/** 研究发现：内核能力、会话、批评、多路径与评测只读投影。 */
	DiscoveryCapabilities: "discovery:getCapabilities",
	DiscoveryKernelSessions: "discovery:listKernelSessions",
	DiscoveryKernelSession: "discovery:getKernelSession",
	DiscoveryCloseKernelSession: "discovery:closeKernelSession",
	DiscoveryCriticReviews: "discovery:listCriticReviews",
	DiscoveryMultipathAssessments: "discovery:listMultipathAssessments",
	DiscoveryExplorationPlans: "discovery:listExplorationPlans",
	DiscoveryEvaluations: "discovery:listEvaluations",
	DecisionsList: "decisions:list",
	DecisionsRevoke: "decisions:revoke",
	DecisionsConfirm: "decisions:confirm",
	InquiryArtifacts: "inquiry:listArtifacts",
	InquiryArtifactProvenance: "inquiry:artifactProvenance",
	InquiryRerunArtifact: "inquiry:rerunArtifact",
	InquiryRerunUpdatedEvent: "inquiry:rerunUpdated",

	/** Zotero 文献库接入状态（Zotero 面板；独立于 Obsidian 知识库） */
	ZoteroStatus: "zotero:status",
	ZoteroWebApiGet: "zotero:webApiGet",
	ZoteroWebApiSave: "zotero:webApiSave",
	ZoteroWebApiClear: "zotero:webApiClear",
	ZoteroLocalWriteGet: "zotero:localWriteGet",
	ZoteroLocalWriteAuthorize: "zotero:localWriteAuthorize",
	ZoteroLocalWriteClear: "zotero:localWriteClear",

	/** 机构访问（合法机构通道，持久登录会话 + EZproxy 模板） */
	InstitutionalGetStatus: "institutional:getStatus",
	InstitutionalSaveConfig: "institutional:saveConfig",
	InstitutionalOpenLogin: "institutional:openLogin",
	InstitutionalOpenUrl: "institutional:openUrl",
	InstitutionalClear: "institutional:clear",
	InstitutionalTestAccess: "institutional:testAccess",
	InstitutionalEvent: "institutional:event",

	SessionCreate: "session:create",
	SessionList: "session:list",
	SessionListAll: "session:listAll",
	SessionOpen: "session:open",
	SessionClose: "session:close",
	SessionDelete: "session:delete",
	SessionPrompt: "session:prompt",
	SessionAbort: "session:abort",
	SessionRetry: "session:retry",
	SessionSetModel: "session:setModel",
	SessionSetThinkingLevel: "session:setThinkingLevel",
	SessionGetMessages: "session:getMessages",
	/** 只读预览子智能体会话文件，不注册/打开顶栏会话 */
	SessionPeekSubagentMessages: "session:peekSubagentMessages",
	SessionSteerSubagent: "session:steerSubagent",
	SessionReplySubagentSupervisor: "session:replySubagentSupervisor",
	/** 子智能体面板（会话内专属派发）：可用列表 / 派发 / 中止 / 本会话运行 */
	SubagentsList: "subagents:list",
	SubagentsDispatch: "subagents:dispatch",
	SubagentsAbort: "subagents:abort",
	SubagentsRuns: "subagents:runs",
	SessionGetTodos: "session:getTodos",
	SessionCompact: "session:compact",
	SessionStats: "session:stats",
	SessionGetContextUsage: "session:getContextUsage",
	SessionClearQueue: "session:clearQueue",
	SessionGetFollowUpMessages: "session:getFollowUpMessages",
	SessionListSlashCommands: "session:listSlashCommands",
	/** 无会话斜杠命令列表（draft 新会话按 cwd 拉取；信任未决不弹窗，只含用户级资源） */
	SessionListSlashCommandsForCwd: "session:listSlashCommandsForCwd",
	SessionSetName: "session:setName",
	SessionExport: "session:export",
	SessionFork: "session:fork",
	/** 撤回用户消息（回退到该消息之前，内容放回输入框） */
	SessionRecall: "session:recall",
	/** 已加载资源（skills/扩展，设置页展示用） */
	SessionGetLoadedResources: "session:getLoadedResources",
	/** pi.dev 社区包目录（设置页扩展面板浏览/安装用） */
	PackagesSearchCatalog: "packages:searchCatalog",
	PackagesInstall: "packages:install",
	PackagesRemove: "packages:remove",
	PackagesListConfigured: "packages:listConfigured",
	FileSaveDialog: "file:saveDialog",
	FilePickPath: "file:pickPath",
	FilePreview: "file:preview",
	FileHtmlPreviewUrl: "file:htmlPreviewUrl",
	FigureAnnotationsGet: "figure:annotationsGet",
	FigureAnnotationsSave: "figure:annotationsSave",
	FileImportDropped: "file:importDropped",
	ResourceOpenExternal: "resource:openExternal",
	ModelsList: "models:list",
	SettingsListProviders: "settings:listProviders",
	/** MCP server 状态与用户级配置 */
	McpGetStatus: "mcp:getStatus",
	McpGetConfig: "mcp:getConfig",
	McpSetServerEnabled: "mcp:setServerEnabled",
	McpAddPreset: "mcp:addPreset",
	McpOpenConfig: "mcp:openConfig",
	McpEvent: "mcp:event",
	SettingsSaveApiKey: "settings:saveApiKey",
	SettingsRemoveCredential: "settings:removeCredential",
	SettingsAddCustomProvider: "settings:addCustomProvider",
	SettingsUpdateCustomProvider: "settings:updateCustomProvider",
	SettingsRemoveCustomProvider: "settings:removeCustomProvider",
	SettingsSetProviderBaseUrl: "settings:setProviderBaseUrl",
	SettingsTestProvider: "settings:testProvider",
	/** 用户级模型偏好：隐藏模型 + 子代理模型覆盖 */
	SettingsGetModelPrefs: "settings:getModelPrefs",
	SettingsSetModelHidden: "settings:setModelHidden",
	SettingsSetModelsHidden: "settings:setModelsHidden",
	SettingsSetSubagentModel: "settings:setSubagentModel",
	SettingsSetSubagentThinking: "settings:setSubagentThinking",
	SettingsSetBackgroundReviewerModel: "settings:setBackgroundReviewerModel",
	/** 只列内置与用户级 subagent（设置是全局配置，不绑定项目） */
	SettingsListSubagents: "settings:listSubagents",
	/** provider 交互登录（OAuth / api_key，后者如 Google Vertex 的 ADC/服务账号）；loginId 由 renderer 生成用于事件归属 */
	SettingsLoginStart: "settings:loginStart",
	SettingsLoginCancel: "settings:loginCancel",
	SettingsLoginRespond: "settings:loginRespond",
	/** main → renderer 登录流程事件（event/prompt/prompt-cancel） */
	SettingsLoginEvent: "settings:loginEvent",
	/** 局域网观察页（默认关闭、只读服务）。 */
	LanGetStatus: "lan:getStatus",
	LanSetEnabled: "lan:setEnabled",
	/** 局域网远程控制二级开关（M2；默认关闭，开观察 ≠ 开控制）。 */
	LanSetRemoteControl: "lan:setRemoteControl",
	AskRequest: "ask:request",
	AskRespond: "ask:respond",
	PermissionRespond: "permission:respond",
	/** 权限门控配置（enabled 解析保留，UI 无入口；chip 逃生舱禁用态感知用） */
	PermissionGetConfig: "permission:getConfig",
	/** 设置 → 权限 面板：可视化编辑全局 ~/.pi/agent/permissions.json（保存即生效，无需重启） */
	PermissionSettingsLoad: "permissionSettings:load",
	PermissionSettingsSave: "permissionSettings:save",
	PermissionSettingsReset: "permissionSettings:reset",
	PermissionSettingsProbe: "permissionSettings:probe",
	PermissionSettingsAuditTail: "permissionSettings:auditTail",
	PermissionSettingsOpenLocation: "permissionSettings:openLocation",
	/** 会话权限模式（default / fullAccess；内存态，不落盘） */
	PermissionGetMode: "permission:getMode",
	PermissionSetMode: "permission:setMode",
	/** 上下文管理模式二态（设置 UI「通用」面板，默认蒸发） */
	ContextManagerGetConfig: "contextManager:getConfig",
	ContextManagerSetMode: "contextManager:setMode",
	/** channel-watch 跨会话频道唤醒开关（设置 UI「通用」面板） */
	ChannelWatchGetConfig: "channelWatch:getConfig",
	ChannelWatchSetEnabled: "channelWatch:setEnabled",
	/** 项目信任应答（选项下标） */
	TrustRespond: "trust:respond",
	/** 项目信任前置决策（添加项目/切换 draft cwd 时调用，未决则弹窗） */
	ProjectEnsureTrust: "project:ensureTrust",
	ProjectPickDirectory: "project:pickDirectory",
	ProjectGetGitBranch: "project:getGitBranch",
	ProjectListGitBranches: "project:listGitBranches",
	ProjectCheckoutBranch: "project:checkoutBranch",
	/** @ 补全数据源：项目文件相对路径列表（目录带尾 /） */
	ProjectListFiles: "project:listFiles",
	AppOpenExternal: "app:openExternal",
	/** 应用信息（版本/运行时版本/仓库地址，设置关于页用） */
	AppGetInfo: "app:getInfo",
	/** 诊断摘要（只含存储元数据与经脱敏的运行时信息） */
	AppGetDiagnostics: "app:getDiagnostics",
	/** 日常空间工作台目录（~/.drone/daily；懒创建后返回，日常会话的固定 cwd） */
	AppGetDailyDir: "app:getDailyDir",
	/** 顶栏 tabs 持久化（userData/tabs.json，不依赖 renderer localStorage） */
	TabsLoad: "tabs:load",
	TabsSave: "tabs:save",
	/** 应用 UI 状态持久化（userData/ui-state.json：上次使用的模型/思考级别 + 主题/背景） */
	UiStateLoad: "uiState:load",
	UiStateSave: "uiState:save",
	/** 自定义背景：弹图选框并拷贝进 userData/backgrounds/，返回文件名（取消返回 null） */
	BackgroundPick: "background:pick",
	/** 检查更新（纯检查：发现新版只提示不下载） */
	UpdateCheck: "update:check",
	/** 下载更新（已发现新版→下载；未发现→先检查）；仅用户显式点击触发 */
	UpdateDownload: "update:download",
	/** 重启并安装已下载的更新 */
	UpdateInstall: "update:install",
	/** main → renderer 更新状态 */
	UpdateEvent: "update:event",
	/** UI 插件：读全局配置 */
	UiPluginsGetConfig: "uiPlugins:getConfig",
	/** UI 插件：设全局总开关 */
	UiPluginsSetEnabled: "uiPlugins:setEnabled",
	/** UI 插件：列插件（含状态） */
	UiPluginsList: "uiPlugins:list",
	/** UI 插件：读构建产物代码 */
	UiPluginsReadCode: "uiPlugins:readCode",
	/** UI 插件：启用/停用单个插件（启用=信任） */
	UiPluginsSetPluginEnabled: "uiPlugins:setPluginEnabled",
	/** UI 插件：槽位指派（pluginName=null 取消指派） */
	UiPluginsAssignSlot: "uiPlugins:assignSlot",
	/** UI 插件：重新构建 */
	UiPluginsRebuild: "uiPlugins:rebuild",
	/** UI 插件：打开插件目录（shell.openPath） */
	UiPluginsOpenDir: "uiPlugins:openDir",
	/** main → renderer UI 插件事件（changed/config） */
	UiPluginsEvent: "uiPlugins:event",
	/** main → renderer 事件 */
	Event: "pi:event",
	PermissionRequest: "pi:permission-request",
	/** main → renderer 权限请求已裁决（含 LAN 远程应答；桌面端据此撤卡） */
	PermissionResolved: "pi:permission-resolved",
	/** main → renderer 项目信任请求（会话创建前） */
	TrustRequest: "pi:trust-request",
} as const;

/**
 * Prompt preflight receipt: tells the renderer whether this input owns an agent run.
 *
 * NOT a running-state authority. SDK events (agent_start/agent_end/agent_settled)
 * own agentActive; this ack can resolve *after* agent_settled on a fast completion,
 * so driving running-state from it would revive an already-finished run (the exact
 * v0.7.2 regression). Consumers must keep using `sending` for preflight and SDK
 * events for the live run — do not set agentActive from this value.
 */
export type PromptReceipt = { kind: "agent" } | { kind: "queued" } | { kind: "command" };

/** 渲染进程经 preload 暴露的 window.pi 类型 */
export interface PiApi extends KnowledgeApi, SessionsApi, ComputeApi, DiscoveryApi, DecisionsApi, InquiryApi {
	/** 运行平台（preload 同步注入，供 renderer 按平台分流 UI：如顶栏红绿灯/窗口按钮留白） */
	readonly platform: "darwin" | "win32" | "linux" | (string & {});
	/** 子智能体面板：会话可见的子智能体（含项目级 + 工具集 + MCP 访问 + 信任状态）与并发边界 */
	listSessionSubagents(sessionId: string): Promise<SubagentPanelSnapshot>;
	/** 子智能体面板：直接派发到会话（与 subagent 工具同一 runner；超出槽位排队） */
	dispatchSubagents(sessionId: string, input: SubagentDispatchInput): Promise<SubagentDispatchReceipt>;
	/** 子智能体面板：中止 / 取消一个面板运行（排队中取消，运行中 abort 子会话）；未知 runId 返回 false */
	abortSubagentRun(runId: string): Promise<boolean>;
	/** 子智能体面板：本会话的面板运行（切回会话时补水；只含进程内存里的记录） */
	listSubagentRuns(sessionId: string): Promise<SubagentPanelRun[]>;
	/** 搜索 pi.dev 社区包目录（服务端模糊匹配名称/描述/作者，50 条/页） */
	searchCatalog(query: string, type?: CatalogPackageType | "", page?: number): Promise<CatalogSearchResult>;
	/** 安装社区包（npm:<name>，用户级）；成功后热重载非流式活跃会话 */
	installPackage(name: string): Promise<void>;
	/** 卸载已配置的包（按 source + scope 移除并持久化）；成功后热重载非流式活跃会话 */
	removePackage(source: string, scope: "user" | "project"): Promise<void>;
	/** 列出 settings.json 已配置的包（「已安装」态匹配用） */
	listConfiguredPackages(): Promise<ConfiguredPackageInfo[]>;
	/** 弹保存对话框并写文件；用户取消返回 null，成功返回写入路径 */
	saveFileDialog(defaultName: string, content: string): Promise<string | null>;
	/** 弹打开对话框选文件或文件夹（示例任务表单的路径输入）；用户取消返回 null，不读文件内容 */
	pickPath(kind: "file" | "directory", defaultPath?: string): Promise<string | null>;
	/** 读取本地文件供右侧资源栏预览；路径可相对 cwd。大文本会截断，大二进制只返回元数据。 */
	previewFile(target: string, cwd?: string): Promise<ResourcePreviewResult>;
	/** 为本地 HTML 文件签发一次性 drone-html:// 地址：脚本可在无同源、无网络的沙箱里运行，只能读取该文件所在目录 */
	htmlPreviewUrl(target: string, cwd?: string): Promise<string>;
	/** 读取某个图像/HTML 图的标注 */
	getFigureAnnotations(target: string, cwd?: string): Promise<FigureAnnotation[]>;
	/** 整体替换某个图的标注（空数组即清除）；返回规整后的列表 */
	saveFigureAnnotations(
		target: string,
		cwd: string | null,
		annotations: FigureAnnotation[],
	): Promise<FigureAnnotation[]>;
	/** Copy a user-dropped file into the app-owned attachment directory. */
	importDroppedFile(sourcePath: string, sessionId: string): Promise<ImportedAttachment>;
	/** 使用系统默认应用打开资源：HTTP(S) 用浏览器，本地路径用系统文件关联。 */
	openResourceExternal(target: string, cwd?: string): Promise<void>;
	/** 列出 provider（默认只走内置目录+本地缓存；forceNetwork 时联网拉最新模型目录） */
	listProviders(options?: ListProvidersOptions): Promise<ProviderInfo[]>;
	getMcpStatus(cwd?: string): Promise<McpStatus>;
	getMcpConfig(cwd?: string): Promise<McpConfigSnapshot>;
	setMcpServerEnabled(name: string, enabled: boolean, cwd?: string): Promise<McpConfigSnapshot>;
	openMcpConfig(cwd?: string): Promise<void>;
	/** 一键接入预设 MCP（写入用户级 mcp.json，已存在则只重新启用） */
	addMcpPreset(id: McpPreset["id"]): Promise<McpConfigSnapshot>;
	onMcpEvent(cb: (event: McpStatusEvent) => void): () => void;
	/** Zotero 文献库接入状态（注册/启用/本机 API 可达/桌面端检测）；面板用，只读 */
	getZoteroStatus(): Promise<ZoteroStatus>;
	/** Zotero 网页 API（修改已有条目）配置状态；不返回密钥 */
	getZoteroWebApi(): Promise<ZoteroWebApiStatus>;
	/** 校验（须有写权限）后保存网页 API 密钥 */
	saveZoteroWebApi(input: ZoteroWebApiSaveInput): Promise<ZoteroWebApiStatus>;
	clearZoteroWebApi(): Promise<ZoteroWebApiStatus>;
	/** Zotero 10+ 本机写入授权状态；不返回 key */
	getZoteroLocalWrite(): Promise<ZoteroLocalWriteStatus>;
	/** 让 Zotero 弹出授权对话框；选「始终允许」才保存 key */
	authorizeZoteroLocalWrite(): Promise<ZoteroLocalWriteStatus>;
	clearZoteroLocalWrite(): Promise<ZoteroLocalWriteStatus>;
	/** 机构访问状态（配置 + 会话 Cookie + 是否已登录）；文献库面板用 */
	getInstitutionalStatus(): Promise<InstitutionalStatus>;
	/** 保存机构访问配置（EZproxy 模板 / OpenURL / 机构名 / 自动下载开关 / 上限） */
	saveInstitutionalConfig(input: InstitutionalSaveInput): Promise<InstitutionalStatus>;
	/** 打开机构登录窗口（可选 URL，未传则用上次或模板） */
	openInstitutionalLogin(url?: string): Promise<{ url: string }>;
	/** 在机构会话窗口中打开指定 URL（用于手动下载或测试） */
	openInstitutionalUrl(url: string): Promise<{ url: string }>;
	/** 清除机构会话（Cookie + 存储） */
	clearInstitutionalSession(): Promise<InstitutionalStatus>;
	/** 测试机构访问是否可达（经 EZproxy 模板与会话） */
	testInstitutionalAccess(url: string): Promise<InstitutionalTestResult>;
	saveApiKey(providerId: string, key: string): Promise<void>;
	removeCredential(providerId: string): Promise<void>;
	addCustomProvider(input: CustomProviderInput): Promise<void>;
	/** 更新自定义 provider（ID 不可改；apiKey 留空保持不变） */
	updateCustomProvider(input: CustomProviderUpdateInput): Promise<void>;
	removeCustomProvider(providerId: string): Promise<void>;
	/** 内置 provider 的可选 baseUrl 覆写（pi 官方语义：不写 models，共享官方模型列表）；baseUrl 空串 = 清除覆写回官方 */
	setProviderBaseUrl(providerId: string, baseUrl: string, apiKey?: string): Promise<void>;
	testProvider(providerId: string, modelId?: string): Promise<ProviderTestResult>;
	/** 读取用户级模型可见性与子代理模型偏好 */
	getModelPrefs(): Promise<ModelPrefs>;
	/** 设置模型在选择器中的可见性；隐藏不影响已经选中的会话运行 */
	setModelHidden(provider: string, modelId: string, hidden: boolean): Promise<ModelPrefs>;
	/** 批量设置一组模型可见性（一键全隐藏/全显示某 provider 的全部模型）；一次写盘 */
	setModelsHidden(provider: string, modelIds: string[], hidden: boolean): Promise<ModelPrefs>;
	/** 为子代理指定 provider/model；null = 继承父会话模型 */
	setSubagentModel(agent: string, modelRef: string | null): Promise<ModelPrefs>;
	/** 为子代理指定 thinking；null = 跟随父会话 thinking。 */
	setSubagentThinking(
		agent: string,
		level: import("./settings").SubagentThinkingLevel | null,
	): Promise<ModelPrefs>;
	/** 开关后台模型审稿；关闭时后台审稿只运行纯规则检查。 */
	setBackgroundReviewerModel(enabled: boolean): Promise<ModelPrefs>;
	/** 列内置与用户级 subagent 定义（不读项目级定义） */
	listSubagents(): Promise<SubagentInfo[]>;
	/** 启动 provider 交互登录（OAuth 浏览器/设备码流 · api_key 提示/选择流）；事件经 onProviderLoginEvent 推送，promise 在流程结束时 resolve（取消不算错误） */
	startProviderLogin(loginId: string, providerId: string): Promise<LoginResult>;
	/** 取消进行中的登录流程（未知 loginId 静默忽略） */
	cancelProviderLogin(loginId: string): Promise<void>;
	/** 应答登录过程中的输入/选择提示（promptId 已被外部取消时静默忽略） */
	respondProviderLogin(loginId: string, promptId: string, value: string): Promise<void>;
	/** 订阅登录流程事件（event/prompt/prompt-cancel，按 loginId 归属）；返回取消函数 */
	onProviderLoginEvent(cb: (payload: LoginEventPayload) => void): () => void;
	/** 读取局域网观察服务状态（URL/二维码只在启用并监听后提供）。 */
	lanGetStatus(): Promise<LanStatus>;
	/** 启用或停止局域网只读观察服务；启用时轮换访问 token。 */
	lanSetEnabled(enabled: boolean): Promise<LanStatus>;
	/** 设置远程控制开关（独立于观察开关；未开观察时允许配置但不生效）。 */
	lanSetRemoteControl(enabled: boolean): Promise<LanStatus>;
	respondAsk(requestId: string, response: AskResponse): Promise<boolean>;
	onAskRequest(cb: (req: AskRequest) => void): () => void;
	respondPermission(requestId: string, answer: PermissionAnswer): Promise<void>;
	/** 读取权限门控配置（enabled=false = 手改 permissions.json 的隐藏逃生舱态，chip 禁用提示用） */
	getPermissionConfig(): Promise<PermissionConfigInfo>;
	/** 设置 → 权限：读取规则文件快照（路径 / 原文 / 默认合并视图 / mtime） */
	getPermissionSettings(): Promise<PermissionSettingsSnapshot>;
	/** 设置 → 权限：保存（后端二次校验 + mtime 冲突检查；conflict 时不写盘，带回磁盘现状） */
	savePermissionSettings(input: PermissionSettingsSaveInput): Promise<PermissionSettingsSaveResult>;
	/** 设置 → 权限：恢复默认（enabled 保留文件原值） */
	resetPermissionSettings(): Promise<PermissionSettingsSnapshot>;
	/** 设置 → 权限：试算一条工具调用会命中哪条规则（可传未保存草稿；只跑规则链） */
	probePermission(input: PermissionProbeInput): Promise<PermissionProbeResult>;
	/** 设置 → 权限：审计日志尾部（最新在前，默认 20 条） */
	getPermissionAuditTail(limit?: number): Promise<PermissionAuditTailEntry[]>;
	/** 设置 → 权限：在文件管理器中定位 permissions.json（不存在则打开所在目录） */
	openPermissionSettingsLocation(): Promise<void>;
	/** 读取会话权限模式（default 缺省；关 tab 重开后端已归零，renderer 对齐真值用） */
	getPermissionMode(sessionId: string): Promise<PermissionMode>;
	/** 设置会话权限模式（内存态即时生效、不落盘、重启归零） */
	setPermissionMode(sessionId: string, mode: PermissionMode): Promise<void>;
	/** 读取上下文管理模式（evaporation / off 二态派生） */
	getContextManagerConfig(): Promise<ContextManagerConfigInfo>;
	/** 设置上下文管理模式（写后 ≤2s 生效，无需重开会话） */
	setContextManagerMode(mode: ContextManagerMode): Promise<void>;
	/** 读取 channel-watch 频道唤醒开关状态 */
	getChannelWatchConfig(): Promise<ChannelWatchConfigInfo>;
	/** 设置 channel-watch 开关（下一 session_start 生效：目录 init/watcher/工具注册全部跟随） */
	setChannelWatchEnabled(enabled: boolean): Promise<void>;
	/** 应答项目信任请求（optionIndex 为 TrustRequest.options 下标） */
	respondTrust(requestId: string, answer: TrustAnswer): Promise<void>;
	/** 项目信任前置决策（选目录/切 draft cwd 时调用；未决弹窗，结果落 trust.json） */
	ensureProjectTrust(cwd: string): Promise<boolean>;
	pickDirectory(): Promise<string | null>;
	/** @ 补全数据源：项目文件相对路径列表（目录带尾 /，TTL 缓存） */
	listProjectFiles(cwd?: string): Promise<string[]>;
	getGitBranch(cwd: string): Promise<string | null>;
	listGitBranches(cwd: string): Promise<GitBranches>;
	/** 切换分支；返回切换后的当前分支（失败抛错） */
	checkoutBranch(cwd: string, branch: string): Promise<string>;
	/** 用系统浏览器打开链接 */
	openExternal(url: string): Promise<void>;
	/** 读取应用信息（版本/运行时/仓库地址） */
	getAppInfo(): Promise<AppInfo>;
	/** 读取诊断摘要（不包含凭证、Vault 或会话正文） */
	getDiagnostics(): Promise<DiagnosticsSnapshot>;
	/** 日常空间工作台目录（不存在则懒创建；日常会话的固定 cwd，信任链无资源自动信任） */
	getDailyDir(): Promise<string>;
	/** 读取持久化的顶栏 tabs（无数据返回 null） */
	loadTabs(): Promise<SavedTabs | null>;
	/** 持久化顶栏 tabs（主进程写 userData/tabs.json） */
	saveTabs(tabs: SavedTabs): Promise<void>;
	/** 读取持久化 UI 状态（上次使用的模型/思考级别/主题/背景；无数据返回 null） */
	loadUiState(): Promise<UiState | null>;
	/** 持久化 UI 状态（主进程合并写入 userData/ui-state.json，传补丁即可） */
	saveUiState(state: Partial<UiState>): Promise<void>;
	/** 弹图选框选背景图并拷贝进 userData/backgrounds/；返回文件名（经 pi-bg://background/<name> 加载），取消返回 null */
	pickBackgroundImage(): Promise<string | null>;
	/** 检查更新（纯检查不下载，状态经 onUpdateEvent 推送） */
	checkForUpdates(): Promise<void>;
	/** 下载更新（已发现新版→下载；未发现→先检查） */
	downloadUpdate(): Promise<void>;
	/** 重启并安装已下载的更新 */
	installUpdate(): Promise<void>;
	/** 订阅更新状态（checking/available/downloading/downloaded/error）；返回取消函数 */
	onUpdateEvent(cb: (state: UpdateState) => void): () => void;
	/** 读 UI 插件全局配置（总开关/启用信任表/槽位指派） */
	uiPluginsGetConfig(): Promise<UiPluginsConfig>;
	/** 设 UI 插件全局总开关 */
	uiPluginsSetEnabled(enabled: boolean): Promise<void>;
	/** 列 UI 插件（含 enabled/trusted/buildError/invalidReason） */
	uiPluginsList(): Promise<UiPluginInfo[]>;
	/** 读插件构建产物（name 必须是扫描到的合法插件名，禁路径）；{ manifest, code } 或 { error } */
	uiPluginsReadCode(name: string): Promise<{ manifest: UiPluginManifest; code: string } | { error: string }>;
	/** 启用/停用单个插件（启用=信任，同步落盘） */
	uiPluginsSetPluginEnabled(name: string, enabled: boolean): Promise<void>;
	/** 槽位指派（pluginName=null 取消指派） */
	uiPluginsAssignSlot(slot: string, pluginName: string | null): Promise<void>;
	/** 重新构建插件（构建失败返回错误信息，旧产物保留） */
	uiPluginsRebuild(name: string): Promise<{ ok: true } | { ok: false; error: string }>;
	/** 打开插件目录（不传 name 开根目录；shell.openPath） */
	uiPluginsOpenDir(name?: string): Promise<void>;
	/** 订阅 UI 插件事件（changed/config）；返回取消函数 */
	onUiPluginsEvent(cb: (payload: UiPluginsEventPayload) => void): () => void;
	/** 订阅会话事件；返回取消函数 */
	onEvent(cb: (payload: SessionEventEnvelope) => void): () => void;
	onPermissionRequest(cb: (req: PermissionRequest) => void): () => void;
	onPermissionResolved(cb: (result: PermissionResolved) => void): () => void;
	/** 订阅项目信任请求；返回取消函数 */
	onTrustRequest(cb: (req: TrustRequest) => void): () => void;
}
