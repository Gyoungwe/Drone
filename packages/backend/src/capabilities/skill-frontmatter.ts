import { readFileSync, statSync } from "node:fs";
import { CAPABILITY_IDS, type CapabilityId } from "@drone/shared";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";

/**
 * 技能常驻标记（挂钩 5）。
 *
 * SKILL.md frontmatter 里写 `alwaysWith: research`（或 `alwaysWith: [knowledge, research]`）的技能，
 * 在声明的任一能力激活时始终对模型可见：不经研究技能路由筛选，并且是只读文献复用模式下仍保留的技能。
 * 核心不再硬编码任何技能名——第一方 research-vault / research-workflow / zotero-literature
 * 与第三方技能走同一份声明；扩展只需在自己的 SKILL.md 里加一行。
 *
 * 读取顺序：进程内声明（`skill.alwaysWith`，测试夹具 / 程序化注册）→ SKILL.md frontmatter（按 mtime 缓存）。
 */
export interface SkillLike {
	name: string;
	filePath?: string;
	/** 进程内声明；存在时优先于 SKILL.md（包括空数组 = 明确不常驻）。 */
	alwaysWith?: unknown;
}

const EMPTY: ReadonlySet<CapabilityId> = new Set<CapabilityId>();
/** 同一路径 1 秒内不重复 stat；mtime/size 变化即重新解析。 */
const STAT_TTL_MS = 1000;
const cache = new Map<
	string,
	{ checkedAt: number; mtimeMs: number; size: number; value: ReadonlySet<CapabilityId> }
>();

/** 把 frontmatter 值（字符串 / 逗号或空白分隔 / 数组）规范成合法能力 id 集合；未知 id 忽略。 */
export function normalizeAlwaysWith(value: unknown): ReadonlySet<CapabilityId> {
	const tokens: unknown[] = Array.isArray(value)
		? value
		: typeof value === "string"
			? value.split(/[\s,]+/)
			: [];
	const ids = new Set<CapabilityId>();
	for (const token of tokens) {
		if (typeof token !== "string") continue;
		const id = token.trim().toLowerCase();
		if ((CAPABILITY_IDS as readonly string[]).includes(id)) ids.add(id as CapabilityId);
	}
	return ids;
}

/** 从 SKILL.md 文本解析 `alwaysWith`（兼容 `always-with`）；无 frontmatter 或 YAML 非法 → 空集。 */
export function parseAlwaysWith(markdown: string): ReadonlySet<CapabilityId> {
	try {
		const { frontmatter } = parseFrontmatter<{ alwaysWith?: unknown; "always-with"?: unknown }>(markdown);
		return normalizeAlwaysWith(frontmatter.alwaysWith ?? frontmatter["always-with"]);
	} catch {
		return EMPTY;
	}
}

export function skillAlwaysWith(skill: SkillLike, now = Date.now()): ReadonlySet<CapabilityId> {
	if (skill.alwaysWith !== undefined) return normalizeAlwaysWith(skill.alwaysWith);
	const path = typeof skill.filePath === "string" ? skill.filePath : "";
	if (!path) return EMPTY;
	const hit = cache.get(path);
	if (hit && now - hit.checkedAt < STAT_TTL_MS) return hit.value;
	let stat: ReturnType<typeof statSync> | undefined;
	try {
		stat = statSync(path, { throwIfNoEntry: false });
	} catch {
		stat = undefined;
	}
	if (!stat?.isFile()) {
		cache.delete(path);
		return EMPTY;
	}
	if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) {
		hit.checkedAt = now;
		return hit.value;
	}
	let value: ReadonlySet<CapabilityId> = EMPTY;
	try {
		value = parseAlwaysWith(readFileSync(path, "utf8"));
	} catch {
		value = EMPTY;
	}
	cache.set(path, { checkedAt: now, mtimeMs: stat.mtimeMs, size: stat.size, value });
	return value;
}

/** 测试 / 资源重载时清空 frontmatter 缓存。 */
export function resetSkillFrontmatterCache(): void {
	cache.clear();
}
