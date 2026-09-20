import {
	PERMISSION_RULE_ACTIONS,
	PERMISSION_SELF_PROTECTION_PATTERNS,
	type PermissionOutsideSettings,
	type PermissionRuleAction,
	type PermissionRuleSetting,
	type PermissionRulesSettings,
	type PermissionSettings,
	type PermissionSettingsIssue,
} from "@drone/shared";

/**
 * 权限设置页的编辑模型（纯函数，无 React）：
 * permissions.json 的规则对象 ↔ 有序数组草稿。JSON 对象靠插入序表达评估序，
 * 页面用数组编辑（↑↓ / 增删），保存时按数组顺序写回对象。
 */

export interface PatternRow {
	/** 稳定 key（React 列表用；不写盘） */
	id: string;
	pattern: string;
	action: PermissionRuleAction;
	/** 自保护模式：动作不能放松为 allow、不能删除、固定在表尾 */
	locked: boolean;
}

export type ToolRuleDraft =
	| { tool: string; kind: "action"; action: PermissionRuleAction }
	| { tool: string; kind: "patterns"; rows: PatternRow[] };

export interface PermissionDraft {
	autoApproveProjectEdits: boolean;
	outside: PermissionOutsideSettings;
	/** rules["*"]：未列出工具的兜底动作 */
	fallback: PermissionRuleAction;
	/** 工具规则，顺序即写盘顺序；bash 永远存在且为模式表 */
	tools: ToolRuleDraft[];
}

let rowSeq = 0;
export function nextRowId(): string {
	rowSeq += 1;
	return `row-${rowSeq}`;
}

const SELF_PROTECTION = new Set<string>(PERMISSION_SELF_PROTECTION_PATTERNS);

export function isSelfProtectionPattern(pattern: string): boolean {
	return SELF_PROTECTION.has(pattern);
}

export function isPermissionAction(value: unknown): value is PermissionRuleAction {
	return typeof value === "string" && (PERMISSION_RULE_ACTIONS as readonly string[]).includes(value);
}

/** 模式表 → 行数组；bash 表把自保护行固定到表尾（缺失的补 ask，评估序上永远最后命中） */
function rowsFromRule(tool: string, rule: Record<string, PermissionRuleAction>): PatternRow[] {
	const rows: PatternRow[] = [];
	const locked: PatternRow[] = [];
	for (const [pattern, action] of Object.entries(rule)) {
		if (!isPermissionAction(action)) continue;
		const row: PatternRow = {
			id: nextRowId(),
			pattern,
			action,
			locked: tool === "bash" && isSelfProtectionPattern(pattern),
		};
		(row.locked ? locked : rows).push(row);
	}
	if (tool === "bash") {
		const present = new Set(locked.map((row) => row.pattern));
		for (const pattern of PERMISSION_SELF_PROTECTION_PATTERNS) {
			if (!present.has(pattern)) locked.push({ id: nextRowId(), pattern, action: "ask", locked: true });
		}
		// 自保护行按规范顺序排列（文件里的相对顺序不影响语义：四条互不重叠）
		locked.sort(
			(a, b) =>
				PERMISSION_SELF_PROTECTION_PATTERNS.indexOf(a.pattern) -
				PERMISSION_SELF_PROTECTION_PATTERNS.indexOf(b.pattern),
		);
	}
	return [...rows, ...locked];
}

function toolDraft(tool: string, rule: PermissionRuleSetting | undefined): ToolRuleDraft | null {
	if (tool === "bash") {
		// bash 必须是模式表：文件里写成单一动作时转成 { "*": 动作 } + 自保护行
		const table =
			typeof rule === "object" && rule !== null ? rule : { "*": isPermissionAction(rule) ? rule : "allow" };
		return { tool, kind: "patterns", rows: rowsFromRule(tool, table) };
	}
	if (isPermissionAction(rule)) return { tool, kind: "action", action: rule };
	if (typeof rule === "object" && rule !== null)
		return { tool, kind: "patterns", rows: rowsFromRule(tool, rule) };
	return null;
}

/** 默认合并后的完整视图 → 草稿（bash 规范化为模式表并补齐自保护行） */
export function draftFromSettings(settings: PermissionSettings): PermissionDraft {
	const tools: ToolRuleDraft[] = [];
	for (const [tool, rule] of Object.entries(settings.rules)) {
		if (tool === "*") continue;
		const draft = toolDraft(tool, rule);
		if (draft) tools.push(draft);
	}
	if (!tools.some((t) => t.tool === "bash")) {
		const bash = toolDraft("bash", undefined);
		if (bash) tools.push(bash);
	}
	return {
		autoApproveProjectEdits: settings.autoApproveProjectEdits,
		outside: { ...settings.outside },
		fallback: isPermissionAction(settings.rules["*"]) ? settings.rules["*"] : "allow",
		tools,
	};
}

/** 草稿 → 写盘形状（数组顺序 = 对象键序 = 评估序）；enabled 原样带回，后端保存时仍以文件为准 */
export function draftToSettings(draft: PermissionDraft, enabled: boolean): PermissionSettings {
	const rules: PermissionRulesSettings = { "*": draft.fallback };
	for (const tool of draft.tools) {
		if (tool.kind === "action") {
			rules[tool.tool] = tool.action;
			continue;
		}
		const table: Record<string, PermissionRuleAction> = {};
		for (const row of tool.rows) table[row.pattern] = row.action;
		rules[tool.tool] = table;
	}
	return {
		enabled,
		autoApproveProjectEdits: draft.autoApproveProjectEdits,
		outside: { ...draft.outside },
		rules,
	};
}

const NUMERIC_KEY = /^\d+$/;

/**
 * 保存前的本地校验（与后端 validateConfig 同口径，另加「重复模式」：对象键会静默合并，
 * 数组编辑时必须提前拦）。返回空数组 = 可保存。
 */
export function validateDraft(draft: PermissionDraft): PermissionSettingsIssue[] {
	const issues: PermissionSettingsIssue[] = [];
	const seenTools = new Set<string>();
	for (const tool of draft.tools) {
		const name = tool.tool.trim();
		const path = `rules.${tool.tool}`;
		if (name === "") {
			issues.push({ code: "empty-pattern", path, message: "tool name is empty" });
			continue;
		}
		if (name === "*") issues.push({ code: "shape", path, message: "* is the fallback row" });
		if (NUMERIC_KEY.test(name)) issues.push({ code: "numeric-key", path, message: "numeric tool name" });
		if (seenTools.has(name)) issues.push({ code: "shape", path, message: "duplicate tool" });
		seenTools.add(name);
		if (tool.kind === "action") continue;
		const seen = new Set<string>();
		for (const row of tool.rows) {
			const rowPath = `${path}.${row.pattern}`;
			if (row.pattern.trim() === "") {
				issues.push({ code: "empty-pattern", path: rowPath, message: "empty pattern" });
				continue;
			}
			if (NUMERIC_KEY.test(row.pattern))
				issues.push({ code: "numeric-key", path: rowPath, message: "numeric pattern" });
			if (seen.has(row.pattern)) issues.push({ code: "shape", path: rowPath, message: "duplicate pattern" });
			seen.add(row.pattern);
			if (row.locked && row.action === "allow") {
				issues.push({ code: "self-protection", path: rowPath, message: "self-protection cannot be allow" });
			}
		}
		if (name === "bash") {
			for (const pattern of PERMISSION_SELF_PROTECTION_PATTERNS) {
				if (!tool.rows.some((row) => row.pattern === pattern && row.action !== "allow")) {
					issues.push({
						code: "self-protection",
						path: `${path}.${pattern}`,
						message: "self-protection missing",
					});
				}
			}
		}
	}
	return issues;
}

/** 两份草稿写盘形状是否相同（脏检查；enabled 不参与） */
export function sameDraft(a: PermissionDraft, b: PermissionDraft): boolean {
	return JSON.stringify(draftToSettings(a, true)) === JSON.stringify(draftToSettings(b, true));
}

/** 上/下移一行；锁定行固定在表尾，普通行不能越过它们 */
export function moveRow(rows: PatternRow[], index: number, delta: -1 | 1): PatternRow[] {
	const target = index + delta;
	if (index < 0 || index >= rows.length || target < 0 || target >= rows.length) return rows;
	const current = rows[index];
	const other = rows[target];
	if (!current || !other || current.locked || other.locked) return rows;
	const next = rows.slice();
	next[index] = other;
	next[target] = current;
	return next;
}

/** 新增一行：插在最后一个普通行之后（锁定行之前） */
export function appendRow(
	rows: PatternRow[],
	pattern = "",
	action: PermissionRuleAction = "ask",
): PatternRow[] {
	const firstLocked = rows.findIndex((row) => row.locked);
	const row: PatternRow = { id: nextRowId(), pattern, action, locked: false };
	if (firstLocked < 0) return [...rows, row];
	return [...rows.slice(0, firstLocked), row, ...rows.slice(firstLocked)];
}

export function removeRow(rows: PatternRow[], id: string): PatternRow[] {
	return rows.filter((row) => row.id !== id || row.locked);
}

export function updateRow(
	rows: PatternRow[],
	id: string,
	patch: Partial<Pick<PatternRow, "pattern" | "action">>,
): PatternRow[] {
	return rows.map((row) => {
		if (row.id !== id) return row;
		if (row.locked) {
			// 锁定行只允许在 ask/deny 之间切换，模式不可改
			const action = patch.action && patch.action !== "allow" ? patch.action : row.action;
			return { ...row, action };
		}
		return { ...row, ...patch };
	});
}

/** 替换某个工具的草稿（不存在则追加到 bash 之前，保持 bash 表在工具列表末尾附近的阅读习惯） */
export function replaceTool(draft: PermissionDraft, next: ToolRuleDraft): PermissionDraft {
	const index = draft.tools.findIndex((t) => t.tool === next.tool);
	const tools = draft.tools.slice();
	if (index >= 0) tools[index] = next;
	else tools.push(next);
	return { ...draft, tools };
}

export function removeTool(draft: PermissionDraft, tool: string): PermissionDraft {
	if (tool === "bash") return draft;
	return { ...draft, tools: draft.tools.filter((t) => t.tool !== tool) };
}

/** 表中第 index 行的展示序号（1 起）；试算结果「命中 #n」用 */
export function rowNumber(rows: PatternRow[], pattern: string | null): number | null {
	if (pattern === null) return null;
	const index = rows.findIndex((row) => row.pattern === pattern);
	return index < 0 ? null : index + 1;
}
