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
	return {
		knowledge: {},
		tasks: {},
		tools: { tools: new Map(), families: new Map() },
		scheduler: new KeyedScheduler(),
		log,
		dispose() {
			return this.scheduler.dispose();
		},
	};
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
	if (!pi?.events?.on) return () => {};
	const receive = (payload) => {
		if (payload?.version !== RUNTIME_BRIDGE_VERSION) return;
		const runtime = payload?.runtime;
		if (!runtime || typeof runtime !== "object" || !runtime.scheduler) return;
		hostRuntimes.set(pi, runtime);
	};
	pi.events.on("drone:runtime/v1", receive);
	// The host inline factory responds with the runtime it owns. This event is
	// safe to emit before the listener exists; request it again after binding.
	void pi.events.emit?.("drone:runtime/request/v1", { version: RUNTIME_BRIDGE_VERSION });
	return () => {
		if (hostRuntimes.get(pi)) hostRuntimes.delete(pi);
	};
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
	standaloneRuntime ||= createStandaloneRuntime();
	return standaloneRuntime;
}

function resolveSlot(domain, slot, create) {
	const runtime = currentRuntime();
	let group = runtime[domain];
	if (!group) {
		group = {};
		runtime[domain] = group;
	}
	if (!group[slot]) group[slot] = create();
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
 * @param {string} _legacyKey Retained for source compatibility; ignored.
 * @returns {T}
 */
export function runtimeSlot(domain, slot, create, _legacyKey = "") {
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
export function runRuntimeExclusive(namespace, key, operation, _legacyKey = "") {
	return currentRuntime().scheduler.run(`${namespace}:${key}`, operation);
}

export const RUNTIME_BRIDGE_VERSION = 1;
