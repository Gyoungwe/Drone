import type { AskRequest, AskResolved, AskResponse } from "./ask";
import type { DecisionsApi } from "./decisions";
import type { DesktopCommand } from "./desktop-command";
import type { DiagnosticsSnapshot } from "./diagnostics";
import type { HostFileAction } from "./file-actions";
import type { PreviewKind } from "./file-types";
import type {
	ComputeApi,
	DiscoveryApi,
	EvidenceApi,
	InquiryApi,
	InstitutionalApi,
	KnowledgeHostApi,
	McpApi,
	MemoryApi,
	PackagesApi,
	PluginCredentialsApi,
	PluginRuntimeApi,
	SettingsApi,
	SubagentsApi,
	UiPluginsApi,
} from "./host-api";
import type { BackgroundJobsApi } from "./host-api/background-jobs";
import type { ResearchApi } from "./host-api/research";
import type { SessionsApi } from "./host-api/sessions";
import type { HostEnvironment } from "./host-env";
import type {
	PermissionAuditTailEntry,
	PermissionProbeInput,
	PermissionProbeResult,
	PermissionSettingsSaveInput,
	PermissionSettingsSaveResult,
	PermissionSettingsSnapshot,
} from "./permission-settings";
import type { ResearchSkillUpdateState } from "./research-skill-update";
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
	SkillRepositoryAddInput,
	SkillRepositoryCheckResult,
	SkillRepositoryRecord,
	SkillRepositoryUpdateResult,
} from "./skill-repository";
import type { UpdateState } from "./update";

export interface ResourcePreviewResult {
	encoding?: string;
	compression?: "gzip";
	path: string;
	name: string;
	mimeType: string;
	size: number;
	kind: "text" | "image" | "pdf" | "binary";
	/** 注册表给出的细分预览类型（P1）；旧调用方可忽略 */
	previewKind?: PreviewKind;
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
	SessionCreate: "session:create",
	SessionList: "session:list",
	SessionListAll: "session:listAll",
	SessionOpen: "session:open",
	SessionClose: "session:close",
	SessionDelete: "session:delete",
	SessionPrompt: "session:prompt",
	SessionCommand: "session:command",
	SessionAbort: "session:abort",
	SessionRetry: "session:retry",
	SessionSetModel: "session:setModel",
	SessionSetThinkingLevel: "session:setThinkingLevel",
	SessionSetAgentMode: "session:setAgentMode",
	SessionSetSkillNamesEnabled: "session:setSkillNamesEnabled",
	SessionGetMessages: "session:getMessages",
	/** 只读预览子智能体会话文件，不注册/打开顶栏会话 */
	SessionPeekSubagentMessages: "session:peekSubagentMessages",
	SessionSteerSubagent: "session:steerSubagent",
	SessionReplySubagentSupervisor: "session:replySubagentSupervisor",
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
	FileSaveDialog: "file:saveDialog",
	FilePickPath: "file:pickPath",
	FilePreview: "file:preview",
	/** 文件右键菜单宿主动作（P7） */
	FileAction: "file:action",
	HostEnvironment: "host:environment",
	DownloadDirPick: "download-dir:pick",
	AttentionBadgeSet: "attention-badge:set",
	FileHtmlPreviewUrl: "file:htmlPreviewUrl",
	FigureAnnotationsGet: "figure:annotationsGet",
	FigureAnnotationsSave: "figure:annotationsSave",
	FileImportDropped: "file:importDropped",
	ResourceOpenExternal: "resource:openExternal",
	ModelsList: "models:list",
	AskRequest: "ask:request",
	AskResolved: "ask:resolved",
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
	/** 开发版隔离配置时只读取正式版知识库关联的 Vault 路径 */
	KnowledgeFormalVault: "knowledge:formalVault",
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
	/** 内置研究技能检查/下载状态 */
	ResearchSkillUpdateEvent: "researchSkills:updateEvent",
	/** 用户显式检查内置研究技能仓库更新（不会在启动/定时自动触发） */
	ResearchSkillCheck: "researchSkills:check",
	/** 一键检查并下载内置研究技能更新 */
	ResearchSkillUpdate: "researchSkills:update",
	/** 重启以启用已下载的内置研究技能 */
	ResearchSkillRestart: "researchSkills:restart",
	/** Skill 仓库管理：列出用户添加的来源 */
	SkillRepositoryList: "skillRepositories:list",
	/** Skill 仓库管理：添加 Git URL 或本地目录 */
	SkillRepositoryAdd: "skillRepositories:add",
	/** Skill 仓库管理：手动检查单个来源 */
	SkillRepositoryCheck: "skillRepositories:check",
	/** Skill 仓库管理：暂存并应用单个来源更新 */
	SkillRepositoryUpdate: "skillRepositories:update",
	/** Skill 仓库管理：移除来源配置与已安装技能快照 */
	SkillRepositoryRemove: "skillRepositories:remove",
	/** main 原生菜单 → renderer 桌面命令（P5） */
	DesktopCommand: "desktop:command",
	/** main → renderer 事件 */
	Event: "pi:event",
	PermissionRequest: "pi:permission-request",
	/** main → renderer 权限请求已裁决（桌面端据此撤卡） */
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
export type PromptReceipt = ({ kind: "agent" } | { kind: "queued" } | { kind: "command" }) & {
	/** P14 Optimistic：回执原样带回客户端生成的 id */
	clientMessageId?: string;
	assistantMessageId?: string;
};

/** 渲染进程经 preload 暴露的 window.pi 类型 */
export interface PiApi
	extends SessionsApi,
		ComputeApi,
		DiscoveryApi,
		DecisionsApi,
		InquiryApi,
		EvidenceApi,
		ResearchApi,
		PluginCredentialsApi,
		BackgroundJobsApi,
		KnowledgeHostApi,
		SubagentsApi,
		InstitutionalApi,
		MemoryApi,
		McpApi,
		UiPluginsApi,
		PluginRuntimeApi,
		PackagesApi,
		SettingsApi {
	/** 运行平台（preload 同步注入，供 renderer 按平台分流 UI：如顶栏红绿灯/窗口按钮留白） */
	readonly platform: "darwin" | "win32" | "linux" | (string & {});
	/** 弹保存对话框并写文件；用户取消返回 null，成功返回写入路径 */
	saveFileDialog(defaultName: string, content: string): Promise<string | null>;
	/** 弹打开对话框选文件或文件夹（示例任务表单的路径输入）；用户取消返回 null，不读文件内容 */
	pickPath(kind: "file" | "directory", defaultPath?: string): Promise<string | null>;
	/** 读取本地文件供右侧资源栏预览；路径可相对 cwd。大文本会截断，大二进制只返回元数据。 */
	previewFile(target: string, cwd?: string, confineToCwd?: boolean): Promise<ResourcePreviewResult>;
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
	openResourceExternal(target: string, cwd?: string, confineToCwd?: boolean): Promise<void>;
	/** 文件右键菜单宿主动作（P7）；返回新路径（download / rename）或 null */
	fileAction(
		action: HostFileAction,
		target: string,
		cwd: string | null,
		arg: string | null,
	): Promise<string | null>;
	/** 本机环境探测（P10） */
	hostEnvironment(): Promise<HostEnvironment>;
	/** 选择下载目录（P11）；取消返回 null */
	pickDownloadDir(): Promise<string | null>;
	/** 待答数角标（P14）：dock / 任务栏；Windows 用 overlay icon */
	setAttentionBadge(count: number, overlayDataUrl: string | null): Promise<void>;
	respondAsk(requestId: string, response: AskResponse): Promise<boolean>;
	onAskRequest(cb: (req: AskRequest) => void): () => void;
	onAskResolved(cb: (result: AskResolved) => void): () => void;
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
	pickDirectory(): Promise<string | null>;
	/** 开发版隔离配置时返回正式版知识库 Vault；正式版或无关联返回 null */
	formalKnowledgeVault(): Promise<string | null>;
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
	/** 用户显式检查内置 Nature/Scientific 技能包更新；状态经事件推送 */
	checkResearchSkills(): Promise<void>;
	/** 更新内置 Nature/Scientific 技能包；下载完成后重启才生效 */
	updateResearchSkills(): Promise<void>;
	/** 重启应用以载入已安装的研究技能包 */
	restartForResearchSkills(): Promise<void>;
	/** 订阅内置研究技能更新状态 */
	onResearchSkillUpdateEvent(cb: (state: ResearchSkillUpdateState) => void): () => void;
	/** 列出用户添加的 Skill 仓库（仅来源元数据，不含文件正文） */
	listSkillRepositories(): Promise<SkillRepositoryRecord[]>;
	/** 添加并校验 Git URL 或本地目录；返回已暂存来源，重启后载入 */
	addSkillRepository(input: SkillRepositoryAddInput): Promise<SkillRepositoryRecord>;
	/** 手动检查单个 Skill 仓库，返回变更文件列表 */
	checkSkillRepository(id: string): Promise<SkillRepositoryCheckResult>;
	/** 暂存并原子应用单个 Skill 仓库更新，下一会话/重启生效 */
	updateSkillRepository(id: string): Promise<SkillRepositoryUpdateResult>;
	/** 卸载 Skill 仓库来源；不触碰知识库或会话内容 */
	removeSkillRepository(id: string): Promise<void>;
	/** 原生菜单触发的桌面命令（P5） */
	onDesktopCommand(cb: (command: DesktopCommand) => void): () => void;
	/** 订阅会话事件；返回取消函数 */
	onEvent(cb: (payload: SessionEventEnvelope) => void): () => void;
	onPermissionRequest(cb: (req: PermissionRequest) => void): () => void;
	onPermissionResolved(cb: (result: PermissionResolved) => void): () => void;
	/** 订阅项目信任请求；返回取消函数 */
	onTrustRequest(cb: (req: TrustRequest) => void): () => void;
}
