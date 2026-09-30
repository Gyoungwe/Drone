import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Runtime bridge for first-party .pi modules.
 *
 * The desktop host can install its DroneRuntime once (or scope an operation with
 * `withRuntime`). CLI consumers get a process-local standalone runtime. During
 * the migration, an existing legacy global bridge is read only when no runtime
 * has been injected; this keeps old extensions and tests working while all new
 * state is owned by an explicit runtime slot.
 */
const contexts = new AsyncLocalStorage();
let installedRuntime = null;
let standaloneRuntime = null;

const legacySymbol = (key) => Symbol.for(key);

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

/** Return the runtime currently active for the calling async context. */
export function currentRuntime() {
	if (contexts.getStore()) return contexts.getStore();
	if (installedRuntime) return installedRuntime;
	standaloneRuntime ||= createStandaloneRuntime();
	return standaloneRuntime;
}

function injectedRuntime() {
	return contexts.getStore() || installedRuntime;
}

function legacyState(key, create) {
	const symbol = legacySymbol(key);
	const globalState = globalThis[symbol];
	if (globalState !== undefined) return globalState;
	const created = create();
	// The host and dynamically loaded .pi extensions may evaluate this module
	// in separate ESM realms. Keep the legacy/no-injection compatibility slot
	// shared across those realms; explicitly injected runtimes never use it.
	globalThis[symbol] = created;
	return created;
}

function resolveSlot(domain, slot, create, key) {
	const runtime = injectedRuntime();
	if (!runtime) {
		return legacyState(key, create);
	}
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
 * @param {string} key
 * @returns {T}
 */
export function runtimeSlot(domain, slot, create, key) {
	if (typeof create !== "function" || typeof key !== "string")
		throw new TypeError("runtimeSlot requires a factory and legacy key");
	const proxy = new Proxy(
		{},
		{
			get(_target, property) {
				const value = resolveSlot(domain, slot, create, key)[property];
				return typeof value === "function" ? value.bind(resolveSlot(domain, slot, create, key)) : value;
			},
			set(_target, property, value) {
				resolveSlot(domain, slot, create, key)[property] = value;
				return true;
			},
			ownKeys() {
				return Reflect.ownKeys(resolveSlot(domain, slot, create, key));
			},
			getOwnPropertyDescriptor(_target, property) {
				const descriptor = Object.getOwnPropertyDescriptor(resolveSlot(domain, slot, create, key), property);
				return descriptor ? { ...descriptor, configurable: true } : undefined;
			},
		},
	);
	return /** @type {T} */ (proxy);
}

function legacyQueue(key) {
	return legacyState(key, () => new Map());
}

/** Serialize a keyed operation through the injected runtime scheduler. */
export function runRuntimeExclusive(namespace, key, operation, legacyKey) {
	const injected = injectedRuntime();
	if (injected?.scheduler?.run) return injected.scheduler.run(`${namespace}:${key}`, operation);
	if (!injected) {
		const queues = legacyQueue(legacyKey);
		const previous = queues.get(key) || Promise.resolve();
		const next = previous.catch(() => {}).then(operation);
		queues.set(key, next);
		return next.finally(() => {
			if (queues.get(key) === next) queues.delete(key);
		});
	}
	const runtime = injected || standaloneRuntime;
	if (!runtime) {
		standaloneRuntime ||= createStandaloneRuntime();
		return standaloneRuntime.scheduler.run(`${namespace}:${key}`, operation);
	}
	return runtime.scheduler.run(`${namespace}:${key}`, operation);
}

export const RUNTIME_BRIDGE_VERSION = 1;
