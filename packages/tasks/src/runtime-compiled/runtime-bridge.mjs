import { AsyncLocalStorage } from "node:async_hooks";
const contexts = new AsyncLocalStorage();
let installedRuntime = null;
let standaloneRuntime = null;
const runtimeBindings = /* @__PURE__ */ new WeakSet();
const hostRuntimes = /* @__PURE__ */ new WeakMap();
class KeyedScheduler {
  #tails = /* @__PURE__ */ new Map();
  #disposed = false;
  async acquire(key) {
    if (this.#disposed) throw new Error("Runtime scheduler has been disposed");
    const previous = this.#tails.get(key) || Promise.resolve();
    let unlock;
    const gate = new Promise((resolve) => {
      unlock = resolve;
    });
    const tail = previous.then(() => gate);
    this.#tails.set(key, tail);
    await previous;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      unlock();
      if (this.#tails.get(key) === tail) this.#tails.delete(key);
    };
  }
  async run(key, task) {
    const release = await this.acquire(key);
    try {
      return await task();
    } finally {
      release();
    }
  }
  async dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#tails.clear();
  }
}
function createStandaloneRuntime(log = {}) {
  const disposables = /* @__PURE__ */ new Set();
  let disposed = false;
  let disposal;
  const registerDisposable = (resource) => {
    if (!resource || typeof resource.dispose !== "function" && typeof resource.close !== "function")
      return () => {
      };
    if (disposed) {
      void (resource.dispose?.() ?? resource.close?.());
      return () => {
      };
    }
    disposables.add(resource);
    return () => disposables.delete(resource);
  };
  const runtime = {
    knowledge: {},
    tasks: {},
    tools: { tools: /* @__PURE__ */ new Map(), families: /* @__PURE__ */ new Map() },
    scheduler: new KeyedScheduler(),
    log,
    registerDisposable,
    dispose() {
      if (disposal) return disposal;
      disposed = true;
      disposal = (async () => {
        const resources = [...disposables];
        disposables.clear();
        await Promise.allSettled(
          resources.map((resource) => {
            try {
              return resource.dispose?.() ?? resource.close?.();
            } catch (error) {
              return Promise.reject(error);
            }
          })
        );
        await runtime.scheduler.dispose();
      })();
      return disposal;
    }
  };
  return runtime;
}
function setRuntime(runtime) {
  if (!runtime || typeof runtime !== "object" || !runtime.scheduler)
    throw new TypeError("A DroneRuntime with a scheduler is required");
  const previous = installedRuntime;
  installedRuntime = runtime;
  return () => {
    if (installedRuntime === runtime) installedRuntime = previous;
  };
}
function withRuntime(runtime, operation) {
  if (!runtime || typeof runtime !== "object" || !runtime.scheduler)
    throw new TypeError("A DroneRuntime with a scheduler is required");
  return contexts.run(runtime, operation);
}
function bindRuntime(pi) {
  if (!pi || typeof pi !== "object" && typeof pi !== "function") return () => {
  };
  if (runtimeBindings.has(pi)) return () => {
  };
  runtimeBindings.add(pi);
  const inherited = currentRuntime();
  const fallback = createStandaloneRuntime();
  adoptRuntimeState(inherited, fallback);
  hostRuntimes.set(pi, fallback);
  if (!pi.events?.on || !pi.events?.emit) {
    return () => {
      if (hostRuntimes.get(pi) !== fallback) return;
      runtimeBindings.delete(pi);
      hostRuntimes.delete(pi);
      void fallback.dispose();
    };
  }
  const receive = (payload) => {
    if (payload?.version !== RUNTIME_BRIDGE_VERSION) return;
    const runtime = payload?.runtime;
    if (!runtime || typeof runtime !== "object" || !runtime.scheduler) return;
    const previous = hostRuntimes.get(pi);
    if (previous && previous !== runtime) adoptRuntimeState(previous, runtime);
    hostRuntimes.set(pi, runtime);
    if (previous && previous !== runtime) void previous.dispose();
  };
  pi.events.on("drone:runtime/v1", receive);
  void pi.events.emit?.("drone:runtime/request/v1", { version: RUNTIME_BRIDGE_VERSION });
  return () => {
    runtimeBindings.delete(pi);
    if (hostRuntimes.get(pi) === fallback) {
      hostRuntimes.delete(pi);
      void fallback.dispose();
    } else hostRuntimes.delete(pi);
  };
}
function adoptRuntimeState(previous, runtime) {
  const sourceTools = previous?.tools?.manifest;
  if (sourceTools) {
    if (!runtime.tools) runtime.tools = {};
    const targetTools = runtime.tools.manifest ?? { tools: /* @__PURE__ */ new Map(), families: /* @__PURE__ */ new Map() };
    runtime.tools.manifest = targetTools;
    if (!targetTools.tools) targetTools.tools = /* @__PURE__ */ new Map();
    for (const [name, meta] of sourceTools.tools || []) {
      if (!targetTools.tools.has(name)) targetTools.tools.set(name, meta);
    }
    if (!targetTools.families) targetTools.families = /* @__PURE__ */ new Map();
    for (const [name, meta] of sourceTools.families || []) {
      if (!targetTools.families.has(name)) targetTools.families.set(name, meta);
    }
  }
  const sourceAcceptance = previous?.tasks?.acceptance;
  if (sourceAcceptance) {
    if (!runtime.tasks) runtime.tasks = {};
    const targetAcceptance = runtime.tasks.acceptance ?? {
      verifiers: /* @__PURE__ */ new Map(),
      kinds: [],
      properties: {}
    };
    runtime.tasks.acceptance = targetAcceptance;
    if (!targetAcceptance.verifiers) targetAcceptance.verifiers = /* @__PURE__ */ new Map();
    for (const [kind, verifier] of sourceAcceptance.verifiers || []) {
      if (!targetAcceptance.verifiers.has(kind)) targetAcceptance.verifiers.set(kind, verifier);
    }
    if (Array.isArray(sourceAcceptance.kinds)) {
      targetAcceptance.kinds ??= [];
      for (const kind of sourceAcceptance.kinds)
        if (!targetAcceptance.kinds.includes(kind)) targetAcceptance.kinds.push(kind);
    }
    targetAcceptance.properties ??= {};
    for (const [key, value] of Object.entries(sourceAcceptance.properties || {}))
      if (!(key in targetAcceptance.properties)) targetAcceptance.properties[key] = value;
  }
  for (const domain of ["knowledge", "tasks", "tools"]) {
    const source = previous?.[domain];
    if (!source || typeof source !== "object") continue;
    let target = runtime[domain];
    if (!target) {
      target = {};
      runtime[domain] = target;
    }
    for (const key of Reflect.ownKeys(source)) if (!(key in target)) target[key] = source[key];
  }
}
function runtimeForHost(pi) {
  return hostRuntimes.get(pi) || currentRuntime();
}
function withHostRuntime(pi, operation) {
  return withRuntime(runtimeForHost(pi), operation);
}
function currentRuntime() {
  if (contexts.getStore()) return contexts.getStore();
  if (installedRuntime) return installedRuntime;
  if (!standaloneRuntime) standaloneRuntime = createStandaloneRuntime();
  return standaloneRuntime;
}
function hasRuntimeContext() {
  return Boolean(contexts.getStore() || installedRuntime);
}
function resolveSlot(domain, slot, create) {
  const runtime = currentRuntime();
  let group = runtime[domain];
  if (!group) {
    group = {};
    runtime[domain] = group;
  }
  if (!group[slot]) {
    group[slot] = create();
    runtime.registerDisposable?.(group[slot]);
  }
  return group[slot];
}
function runtimeSlot(domain, slot, create) {
  if (typeof create !== "function") throw new TypeError("runtimeSlot requires a factory");
  const proxy = new Proxy(
    {},
    {
      get(_target, property) {
        const value = resolveSlot(domain, slot, create)[property];
        return typeof value === "function" ? value.bind(resolveSlot(domain, slot, create)) : value;
      },
      set(_target, property, value) {
        resolveSlot(domain, slot, create)[property] = value;
        return true;
      },
      ownKeys() {
        return Reflect.ownKeys(resolveSlot(domain, slot, create));
      },
      getOwnPropertyDescriptor(_target, property) {
        const descriptor = Object.getOwnPropertyDescriptor(resolveSlot(domain, slot, create), property);
        return descriptor ? { ...descriptor, configurable: true } : void 0;
      }
    }
  );
  return (
    /** @type {T} */
    proxy
  );
}
function runRuntimeExclusive(namespace, key, operation) {
  return currentRuntime().scheduler.run(`${namespace}:${key}`, operation);
}
const RUNTIME_BRIDGE_VERSION = 1;
export {
  RUNTIME_BRIDGE_VERSION,
  bindRuntime,
  createStandaloneRuntime,
  currentRuntime,
  hasRuntimeContext,
  runRuntimeExclusive,
  runtimeForHost,
  runtimeSlot,
  setRuntime,
  withHostRuntime,
  withRuntime
};
