/**
 * 工具清单登记表（挂钩 1，运行时 .mjs 侧）。
 *
 * 扩展用 `defineTool({...definition, drone: {...}})` 一次声明工具元数据（只读 / 能力 / 只读恢复 /
 * 子代理排除 / 状态条文案 / 回执日志 / 回执卡构造器），再经 `registerTools(pi, [...])` 注册。
 * 宿主后端通过 `session.getToolDefinition(name).drone` 读同一份声明；本模块的进程级登记表
 * 供 .pi/lib 内部（任务工作台、回执日志、KnowledgeFlow）查询，并经 globalThis Symbol 桥
 * 把「工具家族」（MCP 服务器前缀等）暴露给后端，与 knowledge/publication 的桥接方式一致。
 */
const key = Symbol.for("drone.tool-manifest.v1");
globalThis[key] ??= { tools: new Map(), families: new Map() };
const registry = globalThis[key];

const SUBAGENT_MODES = new Set(["exclude", "inherit"]);

function assertMeta(name, meta) {
	if (!meta || typeof meta !== "object") throw new Error(`Tool ${name}: drone metadata must be an object`);
	if (meta.subagent !== undefined && !SUBAGENT_MODES.has(meta.subagent))
		throw new Error(`Tool ${name}: drone.subagent must be "exclude" or "inherit"`);
	if (meta.capabilities !== undefined && !Array.isArray(meta.capabilities))
		throw new Error(`Tool ${name}: drone.capabilities must be an array`);
	if (
		meta.activity !== undefined &&
		(typeof meta.activity?.text !== "string" || typeof meta.activity?.phase !== "string")
	)
		throw new Error(`Tool ${name}: drone.activity needs text and phase`);
	if (meta.flowCards !== undefined && typeof meta.flowCards !== "function")
		throw new Error(`Tool ${name}: drone.flowCards must be a function`);
	for (const family of meta.families || [])
		if (typeof family?.match !== "string" || !family.match)
			throw new Error(`Tool ${name}: family.match required`);
}

/** 声明一个带 drone 元数据的工具定义：校验并登记，原样返回给 pi.registerTool。 */
export function defineTool(definition) {
	const name = definition?.name;
	if (typeof name !== "string" || !name) throw new Error("defineTool: name required");
	const meta = definition.drone || {};
	assertMeta(name, meta);
	registry.tools.set(name, meta);
	for (const family of meta.families || [])
		registry.families.set(family.match.toLowerCase(), { ...family, owner: name });
	return definition;
}

/** 子代理子会话里不注册标记为 exclude 的工具；其余原样交给 pi.registerTool。 */
export function registerTools(pi, definitions) {
	const registered = [];
	for (const definition of definitions) {
		const defined = defineTool(definition);
		if (process.env.PI_SUBAGENT_CHILD && defined.drone?.subagent === "exclude") continue;
		pi.registerTool(defined);
		registered.push(defined.name);
	}
	return registered;
}

/** 单个工具的便捷注册：`registerTool(pi, definition)`。 */
export function registerTool(pi, definition) {
	return registerTools(pi, [definition])[0] ?? null;
}

export function toolMeta(name) {
	return registry.tools.get(name) || null;
}

export function toolFamilies() {
	return [...registry.families.values()];
}

/** 工具家族匹配：名称前缀（`research-zotero_*`）或参数中的 server 名。 */
export function matchToolFamily(toolName, args) {
	const name = String(toolName || "").toLowerCase();
	const server = typeof args?.server === "string" ? args.server.toLowerCase() : "";
	const tool = typeof args?.tool === "string" ? args.tool.toLowerCase() : "";
	for (const family of registry.families.values()) {
		const m = family.match.toLowerCase();
		if (
			name === m ||
			name.startsWith(`${m}_`) ||
			name.startsWith(`${m}-`) ||
			server === m ||
			tool.startsWith(`${m}_`)
		)
			return family;
	}
	return null;
}

/** 只读工具：声明 readOnly 的工具，或只读家族成员，或核心只读原语。 */
const CORE_READ_ONLY =
	/^(?:read|grep|find|ls|webfetch|websearch|set_status|todo|task_status|capability_load)$/;
export function isReadOnlyTool(name, args) {
	if (CORE_READ_ONLY.test(name)) return true;
	const meta = registry.tools.get(name);
	if (meta) return meta.readOnly === true;
	return matchToolFamily(name, args)?.readOnly === true;
}

/** 筛选工具名：`toolsWhere((meta, name) => meta.journal)`。 */
export function toolsWhere(predicate) {
	return [...registry.tools.entries()].filter(([name, meta]) => predicate(meta, name)).map(([name]) => name);
}

/** 工具执行中的宿主状态条文案：工具声明优先，再看家族。 */
export function toolActivity(name, args) {
	return registry.tools.get(name)?.activity || matchToolFamily(name, args)?.activity || null;
}

/** 回执卡构造器（挂钩 3）：工具声明的 drone.flowCards(event)。 */
export function flowCardBuilder(name) {
	const builder = registry.tools.get(name)?.flowCards;
	return typeof builder === "function" ? builder : null;
}
