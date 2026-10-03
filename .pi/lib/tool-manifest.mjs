/**
 * 工具清单登记表（挂钩 1，运行时 .mjs 侧）。
 *
 * 扩展用 `defineTool({...definition, drone: {...}})` 一次声明工具元数据（只读 / 能力 / 只读恢复 /
 * 子代理排除 / 状态条文案 / 回执日志 / 回执卡构造器），再经 `registerTools(pi, [...])` 注册。
 * 宿主后端通过 `session.getToolDefinition(name).drone` 读同一份声明；本模块的进程级登记表
 * 供 .pi/lib 内部（任务工作台、回执日志、KnowledgeFlow）查询。清单保存在
 * DroneRuntime 的 tools 槽位中，避免跨 host 的 process-global bridge。
 */

import { emitProcessEvent } from "./process-events.mjs";
import { bindRuntime, hasRuntimeContext, runtimeSlot, withHostRuntime } from "./runtime-bridge.mjs";

const registry = runtimeSlot("tools", "manifest", () => ({ tools: new Map(), families: new Map() }));
// Compatibility read model for code that consumes declarations outside a host
// callback (research journals and KnowledgeFlow). Mutable execution state stays
// runtime-owned; only immutable tool metadata is mirrored here.
const compatibilityTools = new Map();
const compatibilityFamilies = new Map();

/** Versioned host event used to project first-party registrations into the backend. */
export const TOOL_MANIFEST_EVENT = "drone:tool-manifest/v1";
/** Request/replay event used when the host listener is installed after extensions. */
export const TOOL_MANIFEST_REQUEST_EVENT = "drone:tool-manifest/request/v1";

// A dynamic extension is initialized before the host's inline factories. Keep a
// per-Pi replay listener so the host can request registrations after it has
// installed its collector. The registry itself remains runtime-owned; this
// bridge only transports immutable declaration records.
const eventBridges = runtimeSlot("tools", "manifestEventBridges", () => new WeakSet());

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

function registration(name, meta) {
	return { version: 1, name, meta };
}

function replayRegistrations(pi) {
	if (!pi?.events?.emit) return;
	withHostRuntime(pi, () => {
		for (const [name, meta] of registry.tools) {
			void pi.events.emit(TOOL_MANIFEST_EVENT, registration(name, meta));
		}
	});
}

function installEventBridge(pi) {
	if (!pi?.events?.on || eventBridges.has(pi)) return;
	eventBridges.add(pi);
	pi.events.on(TOOL_MANIFEST_REQUEST_EVENT, (payload) => {
		if (payload?.version === 1) replayRegistrations(pi);
	});
}

/** Keep each tool callback inside the runtime owned by its Pi host. */
function bindToolRuntime(pi, definition) {
	if (typeof definition?.execute !== "function") return definition;
	const execute = definition.execute;
	return {
		...definition,
		execute(...args) {
			return withHostRuntime(pi, () => execute.apply(this, args));
		},
	};
}

function publishRegistration(pi, name, meta) {
	const payload = registration(name, meta);
	// The versioned pi.events bridge is the host-facing path. Keep emitting the
	// old process event during migration so CLI/test callers with a minimal Pi
	// object keep the no-session manifest fallback until they bind an event bus.
	void pi?.events?.emit?.(TOOL_MANIFEST_EVENT, payload);
	emitProcessEvent(TOOL_MANIFEST_EVENT, payload);
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
	if (!compatibilityTools.has(name)) compatibilityTools.set(name, meta);
	for (const family of meta.families || []) {
		const key = family.match.toLowerCase();
		if (!compatibilityFamilies.has(key)) compatibilityFamilies.set(key, { ...family, owner: name });
	}
	return definition;
}

/** 子代理子会话里不注册标记为 exclude 的工具；其余原样交给 pi.registerTool。 */
/** @param {any} pi @param {any[]} definitions */
export function registerTools(pi, definitions) {
	bindRuntime(pi);
	return withHostRuntime(pi, () => {
		installEventBridge(pi);
		const registered = [];
		for (const definition of definitions) {
			const defined = defineTool(definition);
			publishRegistration(pi, defined.name, defined.drone || {});
			if (process.env.PI_SUBAGENT_CHILD && defined.drone?.subagent === "exclude") continue;
			pi.registerTool(bindToolRuntime(pi, defined));
			registered.push(defined.name);
		}
		return registered;
	});
}

/** 单个工具的便捷注册：`registerTool(pi, definition)`。 */
/** @param {any} pi @param {any} definition */
export function registerTool(pi, definition) {
	return registerTools(pi, [definition])[0] ?? null;
}

export function toolMeta(name) {
	return registry.tools.get(name) || (hasRuntimeContext() ? null : compatibilityTools.get(name)) || null;
}

export function toolFamilies() {
	return [...(hasRuntimeContext() ? registry.families : compatibilityFamilies).values()];
}

/** 工具家族匹配：名称前缀（`research-zotero_*`）或参数中的 server 名。 */
export function matchToolFamily(toolName, args) {
	const name = String(toolName || "").toLowerCase();
	const server = typeof args?.server === "string" ? args.server.toLowerCase() : "";
	const tool = typeof args?.tool === "string" ? args.tool.toLowerCase() : "";
	for (const family of (hasRuntimeContext() ? registry.families : compatibilityFamilies).values()) {
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
	return toolMeta(name)?.activity || matchToolFamily(name, args)?.activity || null;
}

/** 回执卡构造器（挂钩 3）：工具声明的 drone.flowCards(event)。 */
export function flowCardBuilder(name) {
	const builder = toolMeta(name)?.flowCards;
	return typeof builder === "function" ? builder : null;
}
