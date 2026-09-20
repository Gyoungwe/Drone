/**
 * 设置 → 权限 面板的 IPC 形状：可视化编辑全局规则文件 ~/.pi/agent/permissions.json。
 *
 * 结构与 backend `permissions/config.ts` 的 PermissionConfig 一致（结构类型；backend 只从这里
 * 取常量与 IPC 载荷类型，求值/读写仍在 backend）。会话权限模式（default/fullAccess，D1 内存态）
 * 与 `enabled` 开关（D7 隐藏逃生舱）都不在这页编辑。
 */

export type PermissionRuleAction = "allow" | "ask" | "deny";

export const PERMISSION_RULE_ACTIONS: readonly PermissionRuleAction[] = ["allow", "ask", "deny"];

export interface PermissionOutsideSettings {
	/** read/ls/show_image 落在全部工作区根之外时的动作 */
	read: PermissionRuleAction;
	/** edit/write 落在全部工作区根之外时的动作 */
	write: PermissionRuleAction;
	/** 路径/删除目标落在系统临时区（os.tmpdir() ∪ /tmp）时的动作：可覆盖 ask，永不覆盖 deny */
	temporary: PermissionRuleAction;
}

/** 单工具规则：直接动作，或「模式 → 动作」表（键序即评估序，后命中生效） */
export type PermissionRuleSetting = PermissionRuleAction | Record<string, PermissionRuleAction>;

export interface PermissionRulesSettings {
	/** 全局兜底动作（未列出的工具） */
	"*"?: PermissionRuleAction;
	[toolName: string]: PermissionRuleSetting | undefined;
}

export interface PermissionSettings {
	/** 门控总开关：只读展示（false 时页面出横幅），保存永远保留文件原值 */
	enabled: boolean;
	/** 项目内 edit/write 自动放行（规则为 ask 且目标在项目根内时跳过审批坞） */
	autoApproveProjectEdits: boolean;
	outside: PermissionOutsideSettings;
	rules: PermissionRulesSettings;
}

/**
 * 自保护模式：bash 里任何触及权限/信任/凭证配置的命令必确认。
 * UI 锁定为 ask（不可改为 allow、不可删除），`permissions.save` 二次校验拒绝放松。
 */
export const PERMISSION_SELF_PROTECTION_PATTERNS: readonly string[] = [
	"*permissions.json*",
	"*workspaces.json*",
	"*auth.json*",
	"*trust.json*",
];

/** 面板需要动作选择器的常见工具（其余工具通过「添加工具规则」自定义名加入） */
export const PERMISSION_KNOWN_TOOLS: readonly string[] = [
	"read",
	"edit",
	"write",
	"ls",
	"grep",
	"find",
	"bash",
	"webfetch",
	"show_image",
];

export interface PermissionSettingsSnapshot {
	/** 规则文件绝对路径 */
	path: string;
	/** 审计日志绝对路径（permission-audit.jsonl） */
	auditPath: string;
	exists: boolean;
	/** 文件原文（不存在为 null） */
	raw: string | null;
	/** 文件存在但 JSON 无法解析时的错误（此时 effective = 默认配置，保存会覆盖损坏文件） */
	parseError: string | null;
	/** 默认合并后的完整视图（页面编辑对象） */
	effective: PermissionSettings;
	defaults: PermissionSettings;
	/** 加载时文件 mtime（不存在为 null）；保存时回传做冲突检查 */
	mtimeMs: number | null;
}

export type PermissionSettingsIssueCode =
	| "shape"
	| "action"
	| "numeric-key"
	| "empty-pattern"
	| "self-protection";

export interface PermissionSettingsIssue {
	code: PermissionSettingsIssueCode;
	/** 出错位置，如 `rules.bash.sudo *` / `outside.read` */
	path: string;
	message: string;
}

export interface PermissionSettingsSaveInput {
	settings: PermissionSettings;
	/** 加载时的 mtime；与磁盘不一致且未 force → conflict */
	expectedMtimeMs: number | null;
	force?: boolean;
}

export type PermissionSettingsSaveResult =
	| { ok: true; snapshot: PermissionSettingsSnapshot }
	| { ok: false; reason: "conflict"; snapshot: PermissionSettingsSnapshot }
	| { ok: false; reason: "invalid"; issues: PermissionSettingsIssue[] };

export interface PermissionProbeInput {
	tool: string;
	/** 工具输入（bash: { command }，路径工具: { path }，其余任意） */
	input: Record<string, unknown>;
	/** 未保存的草稿；缺省用磁盘上的文件 */
	settings?: PermissionSettings;
}

export interface PermissionProbeStep {
	/** bash 命令链候选段（非 bash 工具只有一条 = 匹配文本） */
	candidate: string;
	action: PermissionRuleAction;
	/** 决定该段动作的模式；null = 工具级动作或全局兜底 */
	pattern: string | null;
}

export interface PermissionProbeResult {
	tool: string;
	matchText: string | null;
	action: PermissionRuleAction;
	/** 决定最终动作的模式（bash 为最严段的命中模式） */
	pattern: string | null;
	/** bash 最严段；其余工具为 null */
	segment: string | null;
	steps: PermissionProbeStep[];
	/** 试算只跑规则链：工作区边界、临时区、项目内自动放行依赖会话 cwd，不在此模拟 */
	boundaryApplied: false;
}

export interface PermissionAuditTailEntry {
	t: string;
	sessionId?: string;
	tool: string;
	action: "ask" | "deny";
	text: string;
	cwd?: string;
	boundary?: "outside-write" | "outside-read" | "temporary";
}
