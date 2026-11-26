import { Type } from "typebox";
import { DESKTOP_COMMANDS, type DesktopCommand } from "../desktop-command";
import type { DiagnosticsSnapshot } from "../diagnostics";
import type { HostFileAction } from "../file-actions";
import type { PreviewKind } from "../file-types";
import type { HostEnvironment } from "../host-env";
import type { ResearchSkillUpdateState } from "../research-skill-update";
import type { AppInfo, GitBranches, SavedTabs, UiState } from "../session";
import type {
	SkillRepositoryAddInput,
	SkillRepositoryCheckResult,
	SkillRepositoryRecord,
	SkillRepositoryUpdateResult,
} from "../skill-repository";
import type { UpdateState } from "../update";
import { defineDomain } from "./define";

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

const AppInfoSchema = Type.Object(
	{
		name: Type.String(),
		version: Type.String(),
		electron: Type.String(),
		chrome: Type.String(),
		node: Type.String(),
		platform: Type.String(),
		arch: Type.String(),
		repoUrl: Type.String(),
	},
	{ additionalProperties: false },
);

// The diagnostics payload is already defined as a shared, redacted snapshot.
// Keep the contract schema intentionally shallow here so adding diagnostic
// metadata remains backward compatible with older renderers.
const DiagnosticsSnapshotSchema = Type.Unsafe<DiagnosticsSnapshot>({ type: "object" });
const SavedTabsSchema = Type.Unsafe<SavedTabs>({ type: "object" });
const UiStateSchema = Type.Unsafe<UiState>({ type: "object" });
const ResourcePreviewResultSchema = Type.Unsafe<ResourcePreviewResult>({ type: "object" });
const FigureAnnotationSchema = Type.Unsafe<FigureAnnotation>(
	Type.Object(
		{
			id: Type.String({ minLength: 1, maxLength: 64 }),
			x: Type.Number({ minimum: 0, maximum: 1 }),
			y: Type.Number({ minimum: 0, maximum: 1 }),
			text: Type.String({ maxLength: 2000 }),
			createdAt: Type.String({ maxLength: 64 }),
		},
		{ additionalProperties: false },
	),
);
const ImportedAttachmentSchema = Type.Object(
	{ path: Type.String(), name: Type.String(), bytes: Type.Integer({ minimum: 0 }) },
	{ additionalProperties: false },
);
const GitBranchesSchema = Type.Object(
	{ current: Type.Union([Type.String(), Type.Null()]), branches: Type.Array(Type.String()) },
	{ additionalProperties: false },
);
const NullableString = Type.Union([Type.String(), Type.Null()]);
const SkillRepositoryAddInputSchema = Type.Unsafe<SkillRepositoryAddInput>(
	Type.Object(
		{
			kind: Type.Union([Type.Literal("git"), Type.Literal("local")]),
			source: Type.String({ minLength: 1, maxLength: 4096 }),
			ref: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
			subpath: Type.Optional(Type.String({ maxLength: 1024 })),
			license: Type.String({ minLength: 1, maxLength: 256 }),
			licenseEvidence: Type.Optional(Type.String({ maxLength: 4096 })),
			name: Type.Optional(Type.String({ maxLength: 256 })),
		},
		{ additionalProperties: false },
	),
);
const SkillRepositoryRecordSchema = Type.Unsafe<SkillRepositoryRecord>(
	Type.Object(
		{
			id: Type.String({ minLength: 1, maxLength: 64 }),
			name: Type.String({ minLength: 1, maxLength: 256 }),
			kind: Type.Union([Type.Literal("git"), Type.Literal("local")]),
			source: Type.String({ minLength: 1, maxLength: 4096 }),
			ref: Type.Optional(Type.String({ maxLength: 256 })),
			subpath: Type.Optional(Type.String({ maxLength: 1024 })),
			license: Type.String({ minLength: 1, maxLength: 256 }),
			licenseEvidence: Type.Optional(Type.String({ maxLength: 4096 })),
			status: Type.Union([Type.Literal("ready"), Type.Literal("update-available"), Type.Literal("error")]),
			skillCount: Type.Integer({ minimum: 0, maximum: 1000 }),
			lastCheckedAt: Type.Optional(Type.String({ maxLength: 64 })),
			lastAppliedAt: Type.Optional(Type.String({ maxLength: 64 })),
			lastError: Type.Optional(Type.String({ maxLength: 2000 })),
			updateAvailable: Type.Optional(Type.Boolean()),
		},
		{ additionalProperties: false },
	),
);
const SkillRepositoryListSchema = Type.Array(SkillRepositoryRecordSchema, { maxItems: 100 });
const SkillRepositoryCheckResultSchema = Type.Unsafe<SkillRepositoryCheckResult>(
	Type.Object(
		{
			repository: SkillRepositoryRecordSchema,
			changedFiles: Type.Array(Type.String({ maxLength: 1024 }), { maxItems: 1000 }),
		},
		{ additionalProperties: false },
	),
);
const SkillRepositoryUpdateResultSchema = Type.Unsafe<SkillRepositoryUpdateResult>(
	Type.Object(
		{
			repository: SkillRepositoryRecordSchema,
			changedFiles: Type.Array(Type.String({ maxLength: 1024 }), { maxItems: 1000 }),
			restartedRequired: Type.Literal(true),
		},
		{ additionalProperties: false },
	),
);

/** Host API contract for application metadata and diagnostics. */
export const AppContract = defineDomain("app", {
	methods: {
		getInfo: {
			args: Type.Tuple([]),
			result: Type.Unsafe<AppInfo>(AppInfoSchema),
		},
		getDiagnostics: {
			args: Type.Tuple([]),
			result: DiagnosticsSnapshotSchema,
		},
		getDailyDir: {
			args: Type.Tuple([]),
			result: Type.String({ minLength: 1 }),
		},
		openExternal: { args: Type.Tuple([Type.String()]), result: Type.Void() },
		filePreview: {
			args: Type.Union([
				Type.Tuple([Type.String()]),
				Type.Tuple([Type.String(), Type.Union([Type.String(), Type.Undefined()])]),
				Type.Tuple([
					Type.String(),
					Type.Union([Type.String(), Type.Undefined()]),
					Type.Union([Type.Boolean(), Type.Undefined()]),
				]),
			]),
			result: ResourcePreviewResultSchema,
		},
		htmlPreviewUrl: {
			args: Type.Union([Type.Tuple([Type.String()]), Type.Tuple([Type.String(), Type.String()])]),
			result: Type.String({ minLength: 1 }),
		},
		getFigureAnnotations: {
			args: Type.Union([Type.Tuple([Type.String()]), Type.Tuple([Type.String(), Type.String()])]),
			result: Type.Array(FigureAnnotationSchema),
		},
		saveFigureAnnotations: {
			args: Type.Tuple([
				Type.String({ minLength: 1 }),
				Type.Union([Type.String(), Type.Null()]),
				Type.Array(FigureAnnotationSchema, { maxItems: 200 }),
			]),
			result: Type.Array(FigureAnnotationSchema),
		},
		importDroppedFile: {
			args: Type.Tuple([Type.String({ minLength: 1 }), Type.String({ minLength: 1 })]),
			result: Type.Unsafe<ImportedAttachment>(ImportedAttachmentSchema),
		},
		resourceOpenExternal: {
			args: Type.Union([
				Type.Tuple([Type.String()]),
				Type.Tuple([Type.String(), Type.Union([Type.String(), Type.Undefined()])]),
				Type.Tuple([
					Type.String(),
					Type.Union([Type.String(), Type.Undefined()]),
					Type.Union([Type.Boolean(), Type.Undefined()]),
				]),
			]),
			result: Type.Void(),
		},
		/** 文件右键菜单的宿主动作（P7）：action, target, cwd, arg（rename 的新文件名） */
		fileAction: {
			args: Type.Tuple([
				Type.Union(
					["download", "openDefault", "reveal", "openInEditor", "cut", "copy", "rename", "trash"].map((a) =>
						Type.Literal(a),
					),
				),
				Type.String({ minLength: 1 }),
				NullableString,
				NullableString,
			]),
			result: NullableString,
		},
		/** 本机环境探测（P10）：固定只读命令 */
		pickDownloadDir: { args: Type.Tuple([]), result: NullableString },
		/** 待答数角标（P14）：count, Windows overlay 图（data URL）或 null */
		setAttentionBadge: {
			args: Type.Tuple([Type.Integer({ minimum: 0, maximum: 999 }), NullableString]),
			result: Type.Void(),
		},
		hostEnvironment: {
			args: Type.Tuple([]),
			result: Type.Unsafe<HostEnvironment>(Type.Object({}, { additionalProperties: true })),
		},
		loadTabs: { args: Type.Tuple([]), result: Type.Union([SavedTabsSchema, Type.Null()]) },
		saveTabs: { args: Type.Tuple([SavedTabsSchema]), result: Type.Void() },
		loadUiState: { args: Type.Tuple([]), result: Type.Union([UiStateSchema, Type.Null()]) },
		saveUiState: {
			args: Type.Tuple([Type.Unsafe<Partial<UiState>>({ type: "object" })]),
			result: Type.Void(),
		},
		pickBackgroundImage: { args: Type.Tuple([]), result: NullableString },
		checkForUpdates: { args: Type.Tuple([]), result: Type.Void() },
		downloadUpdate: { args: Type.Tuple([]), result: Type.Void() },
		installUpdate: { args: Type.Tuple([]), result: Type.Void() },
		checkResearchSkills: { args: Type.Tuple([]), result: Type.Void() },
		updateResearchSkills: { args: Type.Tuple([]), result: Type.Void() },
		restartForResearchSkills: { args: Type.Tuple([]), result: Type.Void() },
		listSkillRepositories: { args: Type.Tuple([]), result: SkillRepositoryListSchema },
		addSkillRepository: {
			args: Type.Tuple([SkillRepositoryAddInputSchema]),
			result: SkillRepositoryRecordSchema,
		},
		checkSkillRepository: {
			args: Type.Tuple([Type.String({ minLength: 1, maxLength: 64 })]),
			result: SkillRepositoryCheckResultSchema,
		},
		updateSkillRepository: {
			args: Type.Tuple([Type.String({ minLength: 1, maxLength: 64 })]),
			result: SkillRepositoryUpdateResultSchema,
		},
		removeSkillRepository: {
			args: Type.Tuple([Type.String({ minLength: 1, maxLength: 64 })]),
			result: Type.Void(),
		},
		saveFileDialog: {
			args: Type.Tuple([Type.String(), Type.String()]),
			result: NullableString,
		},
		pickPath: {
			args: Type.Union([
				Type.Tuple([Type.Union([Type.Literal("file"), Type.Literal("directory")])]),
				Type.Tuple([Type.Union([Type.Literal("file"), Type.Literal("directory")]), Type.String()]),
			]),
			result: NullableString,
		},
		pickDirectory: { args: Type.Tuple([]), result: NullableString },
		formalKnowledgeVault: { args: Type.Tuple([]), result: NullableString },
		getGitBranch: { args: Type.Tuple([Type.String()]), result: NullableString },
		listGitBranches: { args: Type.Tuple([Type.String()]), result: GitBranchesSchema },
		checkoutBranch: { args: Type.Tuple([Type.String(), Type.String()]), result: Type.String() },
	},
	events: {
		updateEvent: Type.Unsafe<UpdateState>({ type: "object" }),
		researchSkillUpdateEvent: Type.Unsafe<ResearchSkillUpdateState>({ type: "object" }),
		desktopCommand: Type.Union(DESKTOP_COMMANDS.map(({ command }) => Type.Literal(command))),
	},
	channels: {
		formalKnowledgeVault: "knowledge:formalVault",
		checkResearchSkills: "researchSkills:check",
		updateResearchSkills: "researchSkills:update",
		restartForResearchSkills: "researchSkills:restart",
		researchSkillUpdateEvent: "researchSkills:updateEvent",
	},
});

export interface AppApi {
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
	/** 暂存并原子应用单个来源更新，下一会话/重启生效 */
	updateSkillRepository(id: string): Promise<SkillRepositoryUpdateResult>;
	/** 卸载 Skill 仓库来源；不触碰知识库或会话内容 */
	removeSkillRepository(id: string): Promise<void>;
	/** 原生菜单触发的桌面命令（P5） */
	onDesktopCommand(cb: (command: DesktopCommand) => void): () => void;
}
