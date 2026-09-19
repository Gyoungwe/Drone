import {
	type CapabilityId,
	type DroneToolMeta,
	describeToolActivity,
	matchToolFamily,
	readDroneToolMeta,
	type ToolActivity,
	type ToolFamilyMeta,
} from "@drone/shared";

/**
 * 工具清单（挂钩 1，后端侧）。
 *
 * 数据来源只有一个：扩展在 `pi.registerTool({ ..., drone })` 时的声明。后端经
 * `session.getToolDefinition(name)` 读到原样保存的注册对象；工具家族（MCP 服务器前缀等）
 * 由 `.pi/lib/tool-manifest.mjs` 经 globalThis Symbol 桥暴露（与 knowledge/publication 桥同款），
 * 供没有会话句柄的地方（子代理 runner）使用。核心工具（read/bash/…）的默认值在 CORE_TOOL_META。
 */
export interface ToolDefinitionSource {
	getAllTools?(): { name: string }[];
	getToolDefinition?(name: string): unknown;
}

/** 核心工具的默认元数据：这些不是扩展，由宿主自己声明。 */
export const CORE_TOOL_META: Readonly<Record<string, DroneToolMeta>> = Object.freeze({
	read: {
		readOnly: true,
		recoverySafe: false,
		capabilities: ["files", "coding", "knowledge", "research", "visualization"],
	},
	bash: { capabilities: ["coding"] },
	edit: { capabilities: ["coding"] },
	write: { capabilities: ["coding"] },
	webfetch: { readOnly: true, capabilities: ["web", "research"] },
	show_image: { readOnly: true, capabilities: ["visualization"] },
	subagent: { capabilities: ["coding", "research"] },
	set_status: { readOnly: true, recoverySafe: true, capabilities: [] },
});

/** 核心通用活动文案：与领域无关的联网 / 抓取动作，不属于任何扩展。 */
const CORE_ACTIVITIES: { test: (name: string) => boolean; activity: ToolActivity }[] = [
	{
		test: (name) => name === "web_search" || name.includes("web_search") || name.includes("web-search"),
		activity: {
			text: "正在联网检索相关研究…",
			phase: "web-search",
			verb: "正在联网搜索",
			queryKeys: ["query", "q", "search", "text"],
		},
	},
	{
		test: (name) => name === "fetch_content" || name.includes("fetch"),
		activity: {
			text: "正在读取并核对原始来源…",
			phase: "reading",
			verb: "正在读取来源",
			queryKeys: ["url", "target", "path"],
		},
	},
];

const bridgeKey = Symbol.for("drone.tool-manifest.v1");
interface ManifestBridge {
	tools?: Map<string, unknown>;
	families?: Map<string, unknown>;
}
function bridge(): ManifestBridge | undefined {
	return (globalThis as unknown as Record<symbol, ManifestBridge | undefined>)[bridgeKey];
}

/** 运行时 .mjs 侧登记的工具家族（MCP 服务器前缀等），已规范化。 */
export function bridgedToolFamilies(): ToolFamilyMeta[] {
	const families = bridge()?.families;
	if (!families) return [];
	const result: ToolFamilyMeta[] = [];
	for (const raw of families.values()) {
		const meta = readDroneToolMeta({ drone: { families: [raw] } });
		if (meta?.families?.[0]) result.push(meta.families[0]);
	}
	return result;
}

/** 运行时 .mjs 侧登记的单个工具元数据（会话句柄不可用时的后备）。 */
export function bridgedToolMeta(name: string): DroneToolMeta | undefined {
	const raw = bridge()?.tools?.get(name);
	return raw ? readDroneToolMeta({ drone: raw }) : undefined;
}

export class ToolManifest {
	private readonly cache = new Map<string, DroneToolMeta | undefined>();
	private familyCache?: ToolFamilyMeta[];

	constructor(private readonly source?: ToolDefinitionSource) {}

	/** 工具元数据：注册声明 → 运行时桥 → 核心默认；均无则 undefined。 */
	meta(name: string): DroneToolMeta | undefined {
		if (this.source && this.cache.has(name)) return this.cache.get(name);
		let meta: DroneToolMeta | undefined;
		try {
			meta = readDroneToolMeta(this.source?.getToolDefinition?.(name));
		} catch {
			meta = undefined;
		}
		meta ??= bridgedToolMeta(name) ?? CORE_TOOL_META[name];
		if (this.source) this.cache.set(name, meta);
		return meta;
	}

	families(): ToolFamilyMeta[] {
		if (this.familyCache) return this.familyCache;
		const declared: ToolFamilyMeta[] = [];
		for (const tool of this.source?.getAllTools?.() ?? [])
			for (const family of this.meta(tool.name)?.families ?? []) declared.push(family);
		const seen = new Set(declared.map((f) => f.match));
		const families = [...declared, ...bridgedToolFamilies().filter((f) => !seen.has(f.match))];
		// 无会话来源时（全局清单）不缓存：扩展可能在之后才登记家族
		if (this.source) this.familyCache = families;
		return families;
	}

	family(name: string, args?: unknown): ToolFamilyMeta | undefined {
		return matchToolFamily(this.families(), name, args);
	}

	/** 只读文献复用模式可用：libraryMode 显式声明优先，否则等于 readOnly；家族成员看家族 readOnly。 */
	allowedInLibraryMode(name: string): boolean {
		const meta = this.meta(name);
		if (meta) return meta.libraryMode ?? meta.readOnly ?? false;
		return this.family(name)?.readOnly === true;
	}

	recoverySafe(name: string): boolean {
		return this.meta(name)?.recoverySafe === true;
	}

	/** 能力路由：声明优先；未声明的按核心启发式（research_ 前缀 → research；其余 → external）。 */
	capabilities(name: string): CapabilityId[] {
		const meta = this.meta(name);
		if (meta?.capabilities) return [...meta.capabilities];
		const family = this.family(name);
		if (family?.capabilities) return [...family.capabilities];
		return heuristicCapabilities(name);
	}

	/** 宿主状态条文案：声明 → 家族 → 核心通用活动；均无则 null。 */
	activity(name: string, args?: unknown): ToolActivity | null {
		if (typeof name !== "string" || !name) return null;
		const declared = this.meta(name)?.activity;
		if (declared) return declared;
		const family = this.family(name, args)?.activity;
		if (family) return family;
		return coreActivity(name);
	}

	/** 子代理可观察动作文案（含参数里的检索对象）。 */
	describe(name: string, args: Record<string, unknown>): string | null {
		const activity = this.activity(name, args);
		return activity ? describeToolActivity(activity, args) : null;
	}
}

const VISUAL_TOOL = /(?:show_image|explainer|show_me|figure|plot|chart|image)/i;

/** 未声明能力的工具：保留原有的核心启发式，不再包含任何领域工具名。 */
export function heuristicCapabilities(name: string): CapabilityId[] {
	if (/^(?:ask_user|set_status|todo|capability_load|task_[a-z_]+)$/.test(name)) return [];
	if (name.startsWith("research_"))
		return VISUAL_TOOL.test(name) ? ["research", "visualization"] : ["research"];
	if (/^(?:channel_|contact_supervisor$|scout$)/.test(name)) return ["external"];
	return VISUAL_TOOL.test(name) ? ["visualization", "external"] : ["external"];
}

export function coreActivity(name: string): ToolActivity | null {
	const lower = name.toLowerCase();
	return CORE_ACTIVITIES.find((entry) => entry.test(lower))?.activity ?? null;
}

/** 无会话句柄时的全局清单（只看运行时桥 + 核心默认）。 */
export const globalToolManifest = new ToolManifest();
