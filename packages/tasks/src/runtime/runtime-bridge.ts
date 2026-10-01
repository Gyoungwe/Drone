import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Runtime bridge for first-party .pi modules.
 *
 * The desktop host can install its DroneRuntime once (or scope an operation with
 * `withRuntime`). CLI consumers get a process-local standalone runtime. Every
 * slot is resolved from an injected or standalone runtime; there is no
 * process-global Symbol bridge that can accidentally share mutable state.
 */
const contexts = new AsyncLocalStorage();
let installedRuntime = null;
let standaloneRuntime = null;
const runtimeBindings = new WeakSet();
// A host may load several independent Pi extension graphs in one process. Keep
// the runtime binding keyed by that host object instead of putting mutable
// extension state in a process-global singleton.
const hostRuntimes = new WeakMap();

class KeyedScheduler {
	#tails = new Map();
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

/** Construct the CLI-compatible runtime used when no desktop host is present. */
export function createStandaloneRuntime(log = {}) {
	const disposables = new Set();
	let disposed = false;
	let disposal;
	const registerDisposable = (resource) => {
		if (!resource || (typeof resource.dispose !== "function" && typeof resource.close !== "function"))
			return () => {};
		if (disposed) {
			void (resource.dispose?.() ?? resource.close?.());
			return () => {};
		}
		disposables.add(resource);
		return () => disposables.delete(resource);
	};
	const runtime = {
		knowledge: {},
		tasks: {},
		tools: { tools: new Map(), families: new Map() },
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
					resources.map((resource: any) => {
						try {
							return resource.dispose?.() ?? resource.close?.();
						} catch (error) {
							return Promise.reject(error);
						}
					}),
				);
				await runtime.scheduler.dispose();
			})();
			return disposal;
		},
	};
	return runtime;
}

/** Install a host runtime for subsequently loaded/registered first-party modules. */
export function setRuntime(runtime) {
	if (!runtime || typeof runtime !== "object" || !runtime.scheduler)
		throw new TypeError("A DroneRuntime with a scheduler is required");
	const previous = installedRuntime;
	installedRuntime = runtime;
	return () => {
		if (installedRuntime === runtime) installedRuntime = previous;
	};
}

/** Scope a single operation to a runtime without changing process-global state. */
export function withRuntime(runtime, operation) {
	if (!runtime || typeof runtime !== "object" || !runtime.scheduler)
		throw new TypeError("A DroneRuntime with a scheduler is required");
	return contexts.run(runtime, operation);
}

/**
 * Bind a Pi host to the runtime announced by the desktop session engine.
 * Dynamic first-party extensions load before the inline host factory, so they
 * subscribe here and request the versioned announcement once. The returned
 * cleanup function is intentionally small and can be used by extension tests.
 */
export function bindRuntime(pi) {
	if (!pi || (typeof pi !== "object" && typeof pi !== "function")) return () => {};
	if (runtimeBindings.has(pi)) return () => {};
	runtimeBindings.add(pi);
	const inherited = currentRuntime();
	const fallback = createStandaloneRuntime();
	// Extensions register immutable tool/acceptance declarations before the
	// desktop host announces its runtime. Give this host a private copy so
	// callbacks that run in the fallback still see those declarations without
	// sharing mutable journals, queues, or UI state from another host.
	adoptRuntimeState(inherited, fallback);
	hostRuntimes.set(pi, fallback);
	// CLI/test Pi hosts may not expose the desktop event bus. Give each such
	// host an explicit standalone runtime instead of falling back to the
	// process-wide lazy runtime. This keeps extension state isolated even when
	// no SessionEngine is present to announce a desktop-owned runtime.
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
	// The host inline factory responds with the runtime it owns. This event is
	// safe to emit before the listener exists; request it again after binding.
	void pi.events.emit?.("drone:runtime/request/v1", { version: RUNTIME_BRIDGE_VERSION });
	return () => {
		runtimeBindings.delete(pi);
		if (hostRuntimes.get(pi) === fallback) {
			hostRuntimes.delete(pi);
			void fallback.dispose();
		} else hostRuntimes.delete(pi);
	};
}

/** Transfer extension-owned slots when a desktop host announces its runtime late. */
function adoptRuntimeState(previous, runtime) {
	const sourceTools = previous?.tools?.manifest;
	if (sourceTools) {
		if (!runtime.tools) runtime.tools = {};
		const targetTools = runtime.tools.manifest ?? { tools: new Map(), families: new Map() };
		runtime.tools.manifest = targetTools;
		if (!targetTools.tools) targetTools.tools = new Map();
		for (const [name, meta] of sourceTools.tools || []) {
			if (!targetTools.tools.has(name)) targetTools.tools.set(name, meta);
		}
		if (!targetTools.families) targetTools.families = new Map();
		for (const [name, meta] of sourceTools.families || []) {
			if (!targetTools.families.has(name)) targetTools.families.set(name, meta);
		}
	}
	const sourceAcceptance = previous?.tasks?.acceptance;
	if (sourceAcceptance) {
		if (!runtime.tasks) runtime.tasks = {};
		const targetAcceptance = runtime.tasks.acceptance ?? {
			verifiers: new Map(),
			kinds: [],
			properties: {},
		};
		runtime.tasks.acceptance = targetAcceptance;
		if (!targetAcceptance.verifiers) targetAcceptance.verifiers = new Map();
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

/** Return the host-bound runtime, with the standalone runtime as CLI fallback. */
export function runtimeForHost(pi) {
	return hostRuntimes.get(pi) || currentRuntime();
}

/** Run a dynamic extension callback in the runtime owned by its Pi host. */
export function withHostRuntime(pi, operation) {
	return withRuntime(runtimeForHost(pi), operation);
}

/** Return the runtime currently active for the calling async context. */
export function currentRuntime() {
	if (contexts.getStore()) return contexts.getStore();
	if (installedRuntime) return installedRuntime;
	if (!standaloneRuntime) standaloneRuntime = createStandaloneRuntime();
	return standaloneRuntime;
}

/** Whether the current call is explicitly scoped to a host-owned runtime. */
export function hasRuntimeContext() {
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

/**
 * A late-bound slot proxy. Modules can keep their existing `state.foo` shape,
 * while every operation resolves against the runtime in the current async
 * context. Methods are bound to the underlying Map/Set/AsyncLocalStorage.
 *
 * @template {object} T
 * @param {string} domain
 * @param {string} slot
 * @param {() => T} create
 * @returns {T}
 */
export function runtimeSlot(domain, slot, create) {
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
				return descriptor ? { ...descriptor, configurable: true } : undefined;
			},
		},
	);
	return /** @type {T} */ (proxy);
}

/** Serialize a keyed operation through the injected runtime scheduler. */
export function runRuntimeExclusive(namespace, key, operation) {
	return currentRuntime().scheduler.run(`${namespace}:${key}`, operation);
}

export const RUNTIME_BRIDGE_VERSION = 1;
