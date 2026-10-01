import { emitProcessEvent } from "./process-events.mjs";
import { bindRuntime, hasRuntimeContext, runtimeSlot, withHostRuntime } from "./runtime-bridge.mjs";
const registry = runtimeSlot("tools", "manifest", () => ({ tools: /* @__PURE__ */ new Map(), families: /* @__PURE__ */ new Map() }));
const compatibilityTools = /* @__PURE__ */ new Map();
const compatibilityFamilies = /* @__PURE__ */ new Map();
const TOOL_MANIFEST_EVENT = "drone:tool-manifest/v1";
const TOOL_MANIFEST_REQUEST_EVENT = "drone:tool-manifest/request/v1";
const eventBridges = runtimeSlot("tools", "manifestEventBridges", () => /* @__PURE__ */ new WeakSet());
const SUBAGENT_MODES = /* @__PURE__ */ new Set(["exclude", "inherit"]);
function assertMeta(name, meta) {
  if (!meta || typeof meta !== "object") throw new Error(`Tool ${name}: drone metadata must be an object`);
  if (meta.subagent !== void 0 && !SUBAGENT_MODES.has(meta.subagent))
    throw new Error(`Tool ${name}: drone.subagent must be "exclude" or "inherit"`);
  if (meta.capabilities !== void 0 && !Array.isArray(meta.capabilities))
    throw new Error(`Tool ${name}: drone.capabilities must be an array`);
  if (meta.activity !== void 0 && (typeof meta.activity?.text !== "string" || typeof meta.activity?.phase !== "string"))
    throw new Error(`Tool ${name}: drone.activity needs text and phase`);
  if (meta.flowCards !== void 0 && typeof meta.flowCards !== "function")
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
function bindToolRuntime(pi, definition) {
  if (typeof definition?.execute !== "function") return definition;
  const execute = definition.execute;
  return {
    ...definition,
    execute(...args) {
      return withHostRuntime(pi, () => execute.apply(this, args));
    }
  };
}
function publishRegistration(pi, name, meta) {
  const payload = registration(name, meta);
  void pi?.events?.emit?.(TOOL_MANIFEST_EVENT, payload);
  emitProcessEvent(TOOL_MANIFEST_EVENT, payload);
}
function defineTool(definition) {
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
function registerTools(pi, definitions) {
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
function registerTool(pi, definition) {
  return registerTools(pi, [definition])[0] ?? null;
}
function toolMeta(name) {
  return registry.tools.get(name) || (hasRuntimeContext() ? null : compatibilityTools.get(name)) || null;
}
function toolFamilies() {
  return [...(hasRuntimeContext() ? registry.families : compatibilityFamilies).values()];
}
function matchToolFamily(toolName, args) {
  const name = String(toolName || "").toLowerCase();
  const server = typeof args?.server === "string" ? args.server.toLowerCase() : "";
  const tool = typeof args?.tool === "string" ? args.tool.toLowerCase() : "";
  for (const family of (hasRuntimeContext() ? registry.families : compatibilityFamilies).values()) {
    const m = family.match.toLowerCase();
    if (name === m || name.startsWith(`${m}_`) || name.startsWith(`${m}-`) || server === m || tool.startsWith(`${m}_`))
      return family;
  }
  return null;
}
const CORE_READ_ONLY = /^(?:read|grep|find|ls|webfetch|websearch|set_status|todo|task_status|capability_load)$/;
function isReadOnlyTool(name, args = void 0) {
  if (CORE_READ_ONLY.test(name)) return true;
  const meta = registry.tools.get(name);
  if (meta) return meta.readOnly === true;
  return matchToolFamily(name, args)?.readOnly === true;
}
function toolsWhere(predicate) {
  return [...registry.tools.entries()].filter(([name, meta]) => predicate(meta, name)).map(([name]) => name);
}
function toolActivity(name, args) {
  return toolMeta(name)?.activity || matchToolFamily(name, args)?.activity || null;
}
function flowCardBuilder(name) {
  const builder = toolMeta(name)?.flowCards;
  return typeof builder === "function" ? builder : null;
}
export {
  TOOL_MANIFEST_EVENT,
  TOOL_MANIFEST_REQUEST_EVENT,
  defineTool,
  flowCardBuilder,
  isReadOnlyTool,
  matchToolFamily,
  registerTool,
  registerTools,
  toolActivity,
  toolFamilies,
  toolMeta,
  toolsWhere
};
