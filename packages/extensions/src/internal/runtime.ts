import { AsyncLocalStorage } from "node:async_hooks";

/** The small structural part of DroneRuntime needed by a packaged extension. */
export type ExtensionRuntime = {
	knowledge?: Record<string, unknown>;
	tasks?: Record<string, unknown>;
	tools?: Record<string, unknown>;
	scheduler: {
		run<T>(key: string, task: () => T | Promise<T>): Promise<T>;
	};
	log?: Record<string, unknown>;
	registerDisposable?: (resource: { dispose?: () => unknown; close?: () => unknown }) => () => void;
	dispose?: () => unknown;
	[key: string]: unknown;
};

type ExtensionEvents = {
	on?: (event: string, listener: (payload: unknown) => void) => unknown;
	emit?: (event: string, payload?: unknown) => unknown;
};

type ExtensionHost = { events?: ExtensionEvents };

const VERSION = 1;
const RUNTIME_EVENT = "drone:runtime/v1";
const RUNTIME_REQUEST_EVENT = "drone:runtime/request/v1";
const contexts = new AsyncLocalStorage<ExtensionRuntime>();
const hostRuntimes = new WeakMap<object, ExtensionRuntime>();
const hostCleanups = new WeakMap<object, () => void>();
let processRuntime: ExtensionRuntime | undefined;

class KeyedScheduler {
	private readonly tails = new Map<string, Promise<void>>();
	private disposed = false;

	async run<T>(key: string, task: () => T | Promise<T>): Promise<T> {
		if (this.disposed) throw new Error("Extension runtime scheduler has been disposed");
		const previous = this.tails.get(key) ?? Promise.resolve();
		let unlock!: () => void;
		const gate = new Promise<void>((resolve) => {
			unlock = resolve;
		});
		const tail = previous.then(() => gate);
		this.tails.set(key, tail);
		await previous;
		try {
			return await task();
		} finally {
			unlock();
			if (this.tails.get(key) === tail) this.tails.delete(key);
		}
	}

	dispose(): void {
		this.disposed = true;
		this.tails.clear();
	}
}

/** Build the private runtime used by CLI and test Pi hosts. */
export function createStandaloneRuntime(): ExtensionRuntime {
	const scheduler = new KeyedScheduler();
	let disposed = false;
	return {
		knowledge: {},
		tasks: {},
		tools: {},
		scheduler,
		registerDisposable(resource) {
			if (disposed) void (resource.dispose?.() ?? resource.close?.());
			return () => {};
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			scheduler.dispose();
		},
	};
}

function validRuntime(value: unknown): value is ExtensionRuntime {
	return Boolean(
		value && typeof value === "object" && typeof (value as ExtensionRuntime).scheduler?.run === "function",
	);
}

/**
 * Attach an extension entry to a host-owned runtime. Desktop Pi hosts announce
 * their DroneRuntime over a versioned event; bare CLI hosts keep an isolated
 * standalone runtime for this host object.
 */
export function bindExtensionRuntime(pi: ExtensionHost): ExtensionRuntime {
	if (!pi || (typeof pi !== "object" && typeof pi !== "function")) return standaloneRuntime();
	const existing = hostRuntimes.get(pi);
	if (existing) return existing;
	let runtime = createStandaloneRuntime();
	hostRuntimes.set(pi, runtime);
	const events = pi.events;
	if (!events?.on || !events.emit) return runtime;
	const receive = (payload: unknown) => {
		if (!payload || typeof payload !== "object") return;
		const value = (payload as { version?: unknown; runtime?: unknown }).runtime;
		if ((payload as { version?: unknown }).version !== VERSION || !validRuntime(value)) return;
		const previous = runtime;
		runtime = value;
		hostRuntimes.set(pi, runtime);
		if (previous !== runtime && typeof previous.dispose === "function") void previous.dispose();
	};
	const maybeCleanup = events.on(RUNTIME_EVENT, receive);
	hostCleanups.set(pi, () => {
		if (typeof maybeCleanup === "function") maybeCleanup();
		if (hostRuntimes.get(pi) === runtime) hostRuntimes.delete(pi);
		if (typeof runtime.dispose === "function") void runtime.dispose();
		hostCleanups.delete(pi);
	});
	void events.emit(RUNTIME_REQUEST_EVENT, { version: VERSION });
	return runtime;
}

/** Run an extension callback against the runtime currently assigned to `pi`. */
export function withExtensionRuntime<T>(pi: ExtensionHost, operation: () => T | Promise<T>): T | Promise<T> {
	const runtime = hostRuntimes.get(pi) ?? bindExtensionRuntime(pi);
	return contexts.run(runtime, operation);
}

/** Serialize extension-owned work through the host runtime scheduler. */
export function runExtensionExclusive<T>(
	pi: ExtensionHost,
	key: string,
	task: () => T | Promise<T>,
): Promise<T> {
	return Promise.resolve(
		withExtensionRuntime(pi, () => {
			const runtime = contexts.getStore() ?? standaloneRuntime();
			return runtime.scheduler.run(key, task);
		}),
	);
}

function standaloneRuntime(): ExtensionRuntime {
	if (!processRuntime) processRuntime = createStandaloneRuntime();
	return processRuntime;
}

export function disposeExtensionRuntime(pi: ExtensionHost): void {
	hostCleanups.get(pi)?.();
}
