import { CAPABILITY_IDS, type CapabilityId } from "./capabilities";

/**
 * 工具清单元数据（挂钩 1）——扩展在 `pi.registerTool({ ..., drone: {...} })` 时一次声明，
 * 宿主各处（能力路由 / 只读文献模式 / 只读恢复 / 子代理排除 / 状态条文案 / 回执日志）都从这里读，
 * 不再在核心代码里维护按工具名硬编码的集合与正则。
 *
 * 后端通过 `session.getToolDefinition(name).drone` 读取（pi 原样保存注册对象）；
 * 运行时 .mjs 侧通过 `.pi/lib/tool-manifest.mjs` 的进程级登记表读取。
 */
export interface ToolActivity {
	/** 宿主状态条文案，例如「正在检索 Zotero 文献库…」 */
	text: string;
	/** 阶段标识（literature-search / knowledge-search / reading / deposit / verification / archive / …） */
	phase: string;
	/** 子代理可观察动作前缀，例如「正在检索 Zotero」→ `正在检索 Zotero：“query”` */
	verb?: string;
	/** 从参数里提取可展示对象的键名顺序（默认 query/q/search/text） */
	queryKeys?: string[];
}

/** 工具家族：同一份元数据适用于一组按前缀 / MCP server 名匹配的工具（例如 `research-zotero_*`）。 */
export interface ToolFamilyMeta {
	/** 匹配标识：工具名前缀（不含结尾下划线也可）或参数中的 `server` 名 */
	match: string;
	label?: string;
	readOnly?: boolean;
	capabilities?: CapabilityId[];
	activity?: ToolActivity;
}

export interface DroneToolMeta {
	/** 无副作用的只读工具（任务工作台不记为效果操作；只读文献复用模式默认放行） */
	readOnly?: boolean;
	/** 只读文献复用模式（read-only library）下可用；缺省等于 readOnly（有副作用但该模式必需的工具显式声明） */
	libraryMode?: boolean;
	/** 能力路由：任一能力激活时启用该工具；缺省时按核心启发式推断 */
	capabilities?: CapabilityId[];
	/** 只读恢复（恢复上一未完成回答）时允许重放 */
	recoverySafe?: boolean;
	/** 子代理会话中是否注册：exclude = 不注册 */
	subagent?: "exclude" | "inherit";
	/** 工具执行中的宿主状态条文案 */
	activity?: ToolActivity;
	/** 记入研究回执日志（research-receipt-journal） */
	journal?: boolean;
	/** 参与 KnowledgeFlow 回执卡：true = 失败时也出失败卡；字符串 = 卡片 kind 默认值 */
	flow?: boolean | string;
	/** 该扩展拥有的工具家族声明（MCP 服务器等） */
	families?: ToolFamilyMeta[];
}

const clip = (value: unknown, max: number): string | undefined =>
	typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;

export function normalizeToolActivity(value: unknown): ToolActivity | undefined {
	if (!value || typeof value !== "object") return undefined;
	const raw = value as Record<string, unknown>;
	const text = clip(raw.text, 80);
	const phase = clip(raw.phase, 40);
	if (!text || !phase) return undefined;
	const verb = clip(raw.verb, 40);
	const queryKeys = Array.isArray(raw.queryKeys)
		? raw.queryKeys.filter(
				(k): k is string => typeof k === "string" && /^[a-zA-Z_][a-zA-Z0-9_]{0,40}$/.test(k),
			)
		: undefined;
	return { text, phase, ...(verb ? { verb } : {}), ...(queryKeys?.length ? { queryKeys } : {}) };
}

function normalizeCapabilities(value: unknown): CapabilityId[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const ids = value.filter((id): id is CapabilityId => CAPABILITY_IDS.includes(id as CapabilityId));
	return CAPABILITY_IDS.filter((id) => ids.includes(id));
}

export function normalizeToolFamily(value: unknown): ToolFamilyMeta | undefined {
	if (!value || typeof value !== "object") return undefined;
	const raw = value as Record<string, unknown>;
	const match = clip(raw.match, 80)?.toLowerCase();
	if (!match) return undefined;
	const label = clip(raw.label, 60);
	const capabilities = normalizeCapabilities(raw.capabilities);
	const activity = normalizeToolActivity(raw.activity);
	return {
		match,
		...(label ? { label } : {}),
		...(typeof raw.readOnly === "boolean" ? { readOnly: raw.readOnly } : {}),
		...(capabilities ? { capabilities } : {}),
		...(activity ? { activity } : {}),
	};
}

/** 从任意注册对象读取并规范化 `drone` 元数据；无声明返回 undefined。函数字段（如 flowCards）在此被忽略。 */
export function readDroneToolMeta(definition: unknown): DroneToolMeta | undefined {
	const raw =
		definition && typeof definition === "object" ? (definition as { drone?: unknown }).drone : undefined;
	if (!raw || typeof raw !== "object") return undefined;
	const d = raw as Record<string, unknown>;
	const capabilities = normalizeCapabilities(d.capabilities);
	const activity = normalizeToolActivity(d.activity);
	const families = Array.isArray(d.families)
		? d.families.map(normalizeToolFamily).filter((f): f is ToolFamilyMeta => !!f)
		: undefined;
	const flow = typeof d.flow === "boolean" ? d.flow : clip(d.flow, 40);
	return {
		...(typeof d.readOnly === "boolean" ? { readOnly: d.readOnly } : {}),
		...(typeof d.libraryMode === "boolean" ? { libraryMode: d.libraryMode } : {}),
		...(capabilities ? { capabilities } : {}),
		...(typeof d.recoverySafe === "boolean" ? { recoverySafe: d.recoverySafe } : {}),
		...(d.subagent === "exclude" || d.subagent === "inherit" ? { subagent: d.subagent } : {}),
		...(activity ? { activity } : {}),
		...(typeof d.journal === "boolean" ? { journal: d.journal } : {}),
		...(flow !== undefined ? { flow } : {}),
		...(families?.length ? { families } : {}),
	};
}

const QUERY_KEYS = ["query", "q", "search", "search_text", "text", "pattern", "path", "url"];

function firstString(args: Record<string, unknown>, keys: string[]): string | undefined {
	for (const key of keys) {
		const value = args[key];
		if (typeof value === "string" && value.trim()) return value.trim().slice(0, 120);
	}
	return undefined;
}

/** 工具家族匹配：工具名前缀（`research-zotero_…`）或参数 server 字段（MCP 代理调用）。 */
export function matchToolFamily(
	families: readonly ToolFamilyMeta[],
	toolName: string,
	args?: unknown,
): ToolFamilyMeta | undefined {
	const name = toolName.toLowerCase();
	const payload = args && typeof args === "object" ? (args as { server?: unknown; tool?: unknown }) : {};
	const server = typeof payload.server === "string" ? payload.server.toLowerCase() : "";
	const tool = typeof payload.tool === "string" ? payload.tool.toLowerCase() : "";
	return families.find(
		(f) =>
			name === f.match ||
			name.startsWith(`${f.match}_`) ||
			name.startsWith(`${f.match}-`) ||
			server === f.match ||
			tool.startsWith(`${f.match}_`),
	);
}

/** 子代理可观察动作文案：`verb：“对象”`，无对象时退回状态条文案。 */
export function describeToolActivity(activity: ToolActivity, args: Record<string, unknown>): string {
	const nested = args.args && typeof args.args === "object" ? (args.args as Record<string, unknown>) : {};
	const visible = { ...nested, ...args };
	const target = firstString(visible, activity.queryKeys ?? QUERY_KEYS);
	const base = activity.text.replace(/…$/, "");
	if (!target) return base;
	return `${activity.verb ?? base}：“${target}”`;
}
