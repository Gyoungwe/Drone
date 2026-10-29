import type { DroneRuntime, KeyedLocks, RuntimeDisposable, RuntimeEventBus } from "@drone/shared";
import { createLogger, type Logger } from "./log";

/** Per-backend keyed scheduler used by knowledge/task migrations. */
export class KeyedScheduler implements KeyedLocks {
	private readonly tails = new Map<string, Promise<void>>();
	private readonly releases = new Set<() => void>();
	private disposed = false;

	async acquire(key: string): Promise<() => void> {
		if (this.disposed) throw new Error("Runtime scheduler has been disposed");
		const previous = this.tails.get(key) ?? Promise.resolve();
		let unlock!: () => void;
		const gate = new Promise<void>((resolve) => {
			unlock = resolve;
		});
		const tail = previous.then(() => gate);
		this.tails.set(key, tail);
		await previous;
		let released = false;
		const release = () => {
			if (released) return;
			released = true;
			this.releases.delete(release);
			unlock();
			if (this.tails.get(key) === tail) this.tails.delete(key);
		};
		this.releases.add(release);
		return release;
	}

	async run<T>(key: string, task: () => T | Promise<T>): Promise<T> {
		const release = await this.acquire(key);
		try {
			return await task();
		} finally {
			release();
		}
	}

	async dispose(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;
		for (const release of [...this.releases]) release();
		this.releases.clear();
		this.tails.clear();
	}
}

class BackendRuntimeEventBus implements RuntimeEventBus {
	private readonly handlers = new Map<string, Set<(payload: unknown) => void>>();
	private disposed = false;

	on<T>(event: string, handler: (payload: T) => void): () => void {
		if (this.disposed) return () => {};
		const listeners = this.handlers.get(event) ?? new Set<(payload: unknown) => void>();
		const callback = handler as (payload: unknown) => void;
		listeners.add(callback);
		this.handlers.set(event, listeners);
		return () => {
			listeners.delete(callback);
			if (listeners.size === 0) this.handlers.delete(event);
		};
	}

	emit<T>(event: string, payload: T): void {
		if (this.disposed) return;
		for (const handler of this.handlers.get(event) ?? []) handler(payload);
	}

	clear(): void {
		this.disposed = true;
		this.handlers.clear();
	}
}

export function createDroneRuntime(logger: Logger = createLogger("runtime")): DroneRuntime {
	const scheduler = new KeyedScheduler();
	const events = new BackendRuntimeEventBus();
	const disposables = new Set<RuntimeDisposable>();
	let disposed = false;
	let disposal: Promise<void> | undefined;
	const registerDisposable = (resource: RuntimeDisposable): (() => void) => {
		if (!resource || (typeof resource.dispose !== "function" && typeof resource.close !== "function"))
			return () => {};
		if (disposed) {
			void (resource.dispose?.() ?? resource.close?.());
			return () => {};
		}
		disposables.add(resource);
		return () => disposables.delete(resource);
	};
	const dispose = async (): Promise<void> => {
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
				}),
			);
			await scheduler.dispose();
			events.clear();
		})();
		return disposal;
	};
	return {
		knowledge: {},
		tasks: {},
		events,
		tools: { tools: new Map(), families: new Map() },
		scheduler,
		log: logger,
		registerDisposable,
		dispose: dispose,
	};
}
