import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { PERMISSION_SELF_PROTECTION_PATTERNS, type PermissionSettingsIssue } from "@drone/shared";
import { createLogger } from "../log";
import {
	matchPattern,
	type PermissionAction,
	type PermissionOutside,
	type PermissionRule,
	type PermissionRules,
} from "./pattern";

const log = createLogger("permission-rules");

/**
 * 权限配置读取：~/.pi/agent/permissions.json（enabled + outside + rules），
 * 文件规则按工具粒度替换默认；非法内容回退默认配置。
 * enabled 仅手改文件可关（UI 已无入口，spec permission-mode D7 隐藏逃生舱）；本模块不感知会话权限模式（D1：内存态）。
 */

export interface PermissionConfig {
	enabled: boolean;
	autoApproveProjectEdits: boolean;
	/** 路径工具落在全部工作区根之外时的动作（读写分离：观察默认放行，变更默认确认）；
	 * temporary 为路径/删除目标落在系统临时区时的动作（默认 allow，agent 临时工作流免打断） */
	outside: PermissionOutside;
	rules: PermissionRules;
}

const ACTIONS: ReadonlySet<string> = new Set(["allow", "ask", "deny"]);

/**
 * 默认配置：宽松读 + 写敏感工具走审批坞（Default 档）。
 * 只读/自定义工具默认 allow；edit/write 默认 ask（含改权限/信任/凭证文件）；
 * bash 默认 allow，枚举的高危命令 ask；
 * 读写分离：路径工具越界时读放行、写确认；系统临时区（tmpdir ∪ /tmp）对 allow 放行
 * （temporary 动作，rm 兜底同理豁免；永不放松显式 ask）。
 */
export const DEFAULT_PERMISSION_CONFIG: PermissionConfig = {
	enabled: true,
	autoApproveProjectEdits: true,
	outside: { read: "allow", write: "ask", temporary: "allow" },
	rules: {
		"*": "allow",
		bash: {
			"*": "allow",
			"sudo *": "ask",
			"*review-policy.json*": "ask",
			"git push*": "ask",
			"npm publish*": "ask",
			"pnpm publish*": "ask",
			"Remove-Item *": "ask",
			"remove-item *": "ask",
			"del *": "ask",
			"rmdir *": "ask",
			"rm -rf *": "ask",
			"rm -fr *": "ask",
			"rm -r *": "ask",
			"rm -r -f *": "ask",
			"rm -f -r *": "ask",
			"rm --recursive *": "ask",
			"mkfs*": "ask",
			"dd *": "ask",
			"shred *": "ask",
			"git push --force*": "ask",
			"git push -f*": "ask",
			"git reset --hard*": "ask",
			"git clean -f*": "ask",
			"git clean --force*": "ask",
			"curl * | sh*": "ask",
			"curl * | bash*": "ask",
			"wget * | sh*": "ask",
			"wget * | bash*": "ask",
			// 自保护：任何触及权限/信任/凭证配置的命令（含重定向写入）必确认
			"*permissions.json*": "ask",
			"*workspaces.json*": "ask",
			"*auth.json*": "ask",
			"*trust.json*": "ask",
		},
		// 写敏感工具默认走审批坞（含改权限/信任/凭证文件）；* 兜底仍 allow 以便 read/ls/todo 等放行
		edit: "ask",
		write: "ask",
	},
};

/** 配置规则与默认值按工具粒度合并：文件里的单工具规则整体替换默认的同名规则；outside 字段级合并 */
export function mergeWithDefaults(config: Partial<PermissionConfig>): PermissionConfig {
	return {
		enabled: config.enabled ?? true,
		autoApproveProjectEdits:
			config.autoApproveProjectEdits ??
			!(config.rules && ("edit" in config.rules || "write" in config.rules)),
		outside: {
			read: config.outside?.read ?? DEFAULT_PERMISSION_CONFIG.outside.read,
			write: config.outside?.write ?? DEFAULT_PERMISSION_CONFIG.outside.write,
			temporary: config.outside?.temporary ?? DEFAULT_PERMISSION_CONFIG.outside.temporary,
		},
		rules: { ...DEFAULT_PERMISSION_CONFIG.rules, ...(config.rules ?? {}) },
	};
}

function isValidRule(rule: unknown): rule is PermissionRule {
	if (typeof rule === "string") return ACTIONS.has(rule);
	if (typeof rule !== "object" || rule === null || Array.isArray(rule)) return false;
	return Object.values(rule).every((v) => typeof v === "string" && ACTIONS.has(v));
}

function parseOutside(raw: unknown): PermissionOutside | undefined {
	if (typeof raw !== "object" || raw === null) return undefined;
	const input = raw as { read?: unknown; write?: unknown; temporary?: unknown };
	const result: Partial<PermissionOutside> = {};
	if (typeof input.read === "string" && ACTIONS.has(input.read)) {
		result.read = input.read as PermissionAction;
	}
	if (typeof input.write === "string" && ACTIONS.has(input.write)) {
		result.write = input.write as PermissionAction;
	}
	if (typeof input.temporary === "string" && ACTIONS.has(input.temporary)) {
		result.temporary = input.temporary as PermissionAction;
	}
	return result.read || result.write || result.temporary ? (result as PermissionOutside) : undefined;
}

/**
 * 文件 JSON → 部分配置（非法条目丢弃，交给 mergeWithDefaults 补默认）。
 * autoApproveProjectEdits：文件里的显式布尔优先；缺省时由 mergeWithDefaults 按
 * 「是否存在 edit/write 规则」推导（设置页保存整表规则后仍能保住开关值）。
 */
export function parseConfig(raw: unknown): Partial<PermissionConfig> {
	if (typeof raw !== "object" || raw === null) return {};
	const input = raw as {
		enabled?: unknown;
		autoApproveProjectEdits?: unknown;
		outside?: unknown;
		rules?: unknown;
	};
	const result: Partial<PermissionConfig> = {};
	if (typeof input.enabled === "boolean") result.enabled = input.enabled;
	if (typeof input.autoApproveProjectEdits === "boolean") {
		result.autoApproveProjectEdits = input.autoApproveProjectEdits;
	}
	result.outside = parseOutside(input.outside);
	if (typeof input.rules === "object" && input.rules !== null && !Array.isArray(input.rules)) {
		const rules: PermissionRules = {};
		for (const [tool, rule] of Object.entries(input.rules)) {
			if (tool === "*") {
				if (typeof rule === "string" && ACTIONS.has(rule)) rules["*"] = rule as PermissionAction;
				continue;
			}
			if (isValidRule(rule)) rules[tool] = rule;
		}
		result.rules = rules;
	}
	return result;
}

export function permissionConfigPath(agentDir: string): string {
	return join(agentDir, "permissions.json");
}

/** 设置页写盘的 JSON 对象：用户可见字段 + 调用方给定的 enabled（保留文件原值，页面不编辑它） */
export interface SerializedPermissionConfig {
	enabled?: boolean;
	autoApproveProjectEdits: boolean;
	outside: PermissionOutside;
	rules: PermissionRules;
}

/**
 * 配置 → 写盘对象。只输出用户可见字段：autoApproveProjectEdits / outside / rules；
 * `enabled` 仅在调用方显式给出时写入（设置页保存时传文件原值，从不改动逃生舱）。
 * 规则对象按传入顺序逐键复制（JS 保持字符串键插入序 = 评估序）。
 */
export function serializeConfig(
	config: PermissionConfig,
	options?: { enabled?: boolean },
): SerializedPermissionConfig {
	const rules: PermissionRules = {};
	for (const [tool, rule] of Object.entries(config.rules)) {
		if (rule === undefined) continue;
		rules[tool] = typeof rule === "string" ? rule : { ...rule };
	}
	const out: SerializedPermissionConfig = {
		autoApproveProjectEdits: config.autoApproveProjectEdits,
		outside: { read: config.outside.read, write: config.outside.write, temporary: config.outside.temporary },
		rules,
	};
	return options?.enabled === undefined ? out : { enabled: options.enabled, ...out };
}

const NUMERIC_KEY = /^\d+$/;

function actionIssue(path: string, value: unknown): PermissionSettingsIssue {
	return {
		code: "action",
		path,
		message: `${path}: 动作必须是 allow / ask / deny（收到 ${JSON.stringify(value)}）`,
	};
}

/**
 * 设置页保存前的整表校验（UI 与 permissions.save 各跑一次，后者兜底）：
 * - 动作枚举：outside.* / rules.* / 模式表值只能是 allow / ask / deny；
 * - 纯数字键：JS 会把纯数字属性名重排到最前，破坏「键序即评估序」，工具名与模式都禁止；
 * - 空模式 / 空工具名；
 * - 自保护：bash 必须是模式表，四条自保护模式齐全、不为 allow（ask 或收紧为 deny），
 *   且实际生效——后命中生效意味着排在其后的 `*: allow` 会把它们盖掉，同样拒绝。
 * 返回空数组 = 合法。
 */
export function validateConfig(config: PermissionConfig): PermissionSettingsIssue[] {
	const issues: PermissionSettingsIssue[] = [];
	if (typeof config !== "object" || config === null) {
		return [{ code: "shape", path: "", message: "配置必须是对象" }];
	}
	if (typeof config.autoApproveProjectEdits !== "boolean") {
		issues.push({
			code: "shape",
			path: "autoApproveProjectEdits",
			message: "autoApproveProjectEdits 必须是布尔值",
		});
	}
	const outside = config.outside as Partial<PermissionOutside> | undefined;
	for (const key of ["read", "write", "temporary"] as const) {
		const value = outside?.[key];
		if (typeof value !== "string" || !ACTIONS.has(value)) issues.push(actionIssue(`outside.${key}`, value));
	}
	const rules = config.rules as PermissionRules | undefined;
	if (typeof rules !== "object" || rules === null || Array.isArray(rules)) {
		issues.push({ code: "shape", path: "rules", message: "rules 必须是对象" });
		return issues;
	}
	for (const [tool, rule] of Object.entries(rules)) {
		if (rule === undefined) continue;
		const path = `rules.${tool}`;
		if (tool.trim() === "") {
			issues.push({ code: "empty-pattern", path, message: "工具名不能为空" });
			continue;
		}
		if (NUMERIC_KEY.test(tool)) {
			issues.push({ code: "numeric-key", path, message: `${path}: 纯数字键会被引擎重排，不能作为工具名` });
		}
		if (typeof rule === "string") {
			if (!ACTIONS.has(rule)) issues.push(actionIssue(path, rule));
			continue;
		}
		if (typeof rule !== "object" || rule === null || Array.isArray(rule)) {
			issues.push({ code: "shape", path, message: `${path}: 规则必须是动作或「模式 → 动作」表` });
			continue;
		}
		for (const [pattern, action] of Object.entries(rule)) {
			const patternPath = `${path}.${pattern}`;
			if (pattern.trim() === "")
				issues.push({ code: "empty-pattern", path: patternPath, message: `${path}: 模式不能为空` });
			if (NUMERIC_KEY.test(pattern)) {
				issues.push({
					code: "numeric-key",
					path: patternPath,
					message: `${patternPath}: 纯数字模式会被引擎重排`,
				});
			}
			if (typeof action !== "string" || !ACTIONS.has(action)) issues.push(actionIssue(patternPath, action));
		}
	}
	const bash = rules.bash;
	if (typeof bash !== "object" || bash === null) {
		issues.push({
			code: "self-protection",
			path: "rules.bash",
			message: "bash 必须是模式表并包含自保护模式（*permissions.json* 等 = ask）",
		});
	} else {
		for (const pattern of PERMISSION_SELF_PROTECTION_PATTERNS) {
			const action = bash[pattern];
			if (action === undefined || action === "allow") {
				issues.push({
					code: "self-protection",
					path: `rules.bash.${pattern}`,
					message: `自保护模式 ${pattern} 必须存在且不能为 allow`,
				});
				continue;
			}
			// 有效性：用「模式自身」当样本按键序求值，后面的 allow 通配盖掉它就等于没有
			const sample = pattern.replace(/\*/g, "x");
			let effective: string | undefined;
			for (const [candidate, candidateAction] of Object.entries(bash)) {
				if (matchPattern(candidate, sample)) effective = candidateAction;
			}
			if (effective === "allow") {
				issues.push({
					code: "self-protection",
					path: `rules.bash.${pattern}`,
					message: `自保护模式 ${pattern} 被其后的 allow 模式覆盖（后命中生效），请把它移到表尾`,
				});
			}
		}
	}
	return issues;
}

/** 读取权限配置；文件不存在或非法时回退默认配置 */
export function loadPermissionConfig(agentDir: string): PermissionConfig {
	const path = permissionConfigPath(agentDir);
	if (!existsSync(path)) return mergeWithDefaults({});
	try {
		const raw = JSON.parse(readFileSync(path, "utf-8"));
		return mergeWithDefaults(parseConfig(raw));
	} catch (err) {
		log.warn("permissions.json 解析失败，使用默认配置", path, err);
		return mergeWithDefaults({});
	}
}

/** mtime+size 缓存的配置读取：扩展在每次 tool_call 前调用，开关/规则修改即时生效。
 * 只看 mtime 会在同一毫秒内连续写 permissions.json 时吃到旧规则（测试和热改都踩过）。 */
export function createPermissionConfigLoader(agentDir: string): () => PermissionConfig {
	let cached: { mtimeMs: number | null; size: number | null; config: PermissionConfig } | undefined;
	return () => {
		const path = permissionConfigPath(agentDir);
		let mtimeMs: number | null = null;
		let size: number | null = null;
		try {
			const st = statSync(path);
			mtimeMs = st.mtimeMs;
			size = st.size;
		} catch {
			mtimeMs = null;
			size = null;
		}
		if (cached && cached.mtimeMs === mtimeMs && cached.size === size) return cached.config;
		const config = loadPermissionConfig(agentDir);
		cached = { mtimeMs, size, config };
		return config;
	};
}
