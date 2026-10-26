import { randomUUID } from "node:crypto";
import { type PluginRuntimeCaller, PluginRuntimeRegistry } from "./runtime";
import type { PluginSessionCallerContext } from "./session-caller";
import type { PluginRuntimeClient, PluginRuntimeFactory } from "@gyoungwe/plugin-api/runtime";

export interface PluginRuntimeSource {
	readonly pluginId: string;
	readonly packageRoot: string;
	readonly entrypoint: string;
}
export interface PluginRuntimeOwner {
	readonly id: number;
	isDestroyed(): boolean;
}
export interface PluginRuntimeBridgeOptions {
	source(name: string): PluginRuntimeSource | undefined;
	enabled(name: string): boolean;
	factory(source: PluginRuntimeSource): PluginRuntimeFactory;
	approve(owner: PluginRuntimeOwner, source: PluginRuntimeSource, operation?: string): Promise<boolean>;
	getSessionContext(sessionId: string): PluginSessionCallerContext | undefined;
}
interface Selection {
	readonly token: string;
	readonly owner: PluginRuntimeOwner;
	readonly session: PluginSessionCallerContext | undefined;
	readonly abort: AbortController;
}
interface Runtime {
	readonly name: string;
	readonly source: PluginRuntimeSource;
	readonly registry: PluginRuntimeRegistry;
	readonly bindings: Set<Binding>;
	readonly activationOwner: PluginRuntimeOwner;
	active: boolean;
	stopping?: Promise<void>;
}
interface Binding {
	readonly token: string;
	readonly name: string;
	readonly owner: PluginRuntimeOwner;
	readonly runtime: Runtime;
	readonly abort: AbortController;
	readonly pending: Set<Promise<unknown>>;
	readonly ready: Promise<PluginRuntimeClient>;
}
function sameSource(a: PluginRuntimeSource, b: PluginRuntimeSource | undefined): boolean {
	return a.pluginId === b?.pluginId && a.packageRoot === b.packageRoot && a.entrypoint === b.entrypoint;
}

/** One domain owner per application/package. Window tokens only grant revocable caller access. */
export class PluginRuntimeBridge {
	private readonly applicationId = randomUUID();
	private transitioning = false;
	private closing = false;
	private transition: Promise<unknown> | undefined;
	private readonly bindings = new Map<string, Binding>();
	private readonly runtimes = new Map<string, Runtime>();
	private readonly selections = new Map<PluginRuntimeOwner, Selection>();
	private readonly requests = new Map<string, { name: string; ownerId: number; token: string }>();
	private readonly stopping = new Map<string, { name: string; ownerId: number; promise: Promise<void> }>();

	constructor(private readonly options: PluginRuntimeBridgeOptions) {}

	/** Renderer selects an existing session; the backend supplies identity, cwd, trust and lifetime. */
	selectSession(owner: PluginRuntimeOwner, sessionId: string | null): string {
		if (this.closing || owner.isDestroyed()) throw new Error("Plugin caller window is unavailable");
		const session = sessionId === null ? undefined : this.options.getSessionContext(sessionId);
		if (sessionId !== null && !session) throw new Error("Plugin caller session is not open");
		const previous = this.selections.get(owner);
		if (previous && previous.session?.identity === session?.identity && !previous.abort.signal.aborted)
			return previous.token;
		previous?.abort.abort(new Error("Plugin caller selection changed"));
		const token = randomUUID();
		this.selections.set(owner, { token, owner, session, abort: new AbortController() });
		return token;
	}

	private caller(binding: Binding): PluginRuntimeCaller | undefined {
		if (!this.allowed(binding)) return undefined;
		let selected = this.selections.get(binding.owner);
		if (!selected) {
			this.selectSession(binding.owner, null);
			selected = this.selections.get(binding.owner);
		}
		if (!selected) throw new Error("Plugin caller selection was not initialized");
		let session: PluginSessionCallerContext | undefined;
		if (selected.session) {
			session = this.options.getSessionContext(selected.session.scope.sessionId);
			if (!session || session.identity !== selected.session.identity) {
				selected.abort.abort(new Error("Plugin caller session closed or replaced"));
				return undefined;
			}
		}
		return {
			identity: selected,
			scope: session?.scope ?? { kind: "application" },
			signal: AbortSignal.any([
				binding.abort.signal,
				selected.abort.signal,
				...(session ? [session.signal] : []),
			]),
		};
	}

	private allowed(binding: Binding): boolean {
		return (
			!this.closing &&
			!this.transitioning &&
			this.bindings.has(binding.token) &&
			!binding.owner.isDestroyed() &&
			!binding.abort.signal.aborted &&
			this.options.enabled(binding.name) &&
			sameSource(binding.runtime.source, this.options.source(binding.name))
		);
	}

	private createRuntime(name: string, source: PluginRuntimeSource, owner: PluginRuntimeOwner): Runtime {
		const registry = new PluginRuntimeRegistry(
			{
				authorizeActivation: async (_request, signal) => {
					if (this.closing || this.transitioning || owner.isDestroyed() || !this.options.enabled(name))
						return false;
					const approved = await this.options.approve(owner, source);
					return (
						approved &&
						!signal.aborted &&
						!owner.isDestroyed() &&
						this.options.enabled(name) &&
						sameSource(source, this.options.source(name))
					);
				},
				authorizeInvocation: async (request, signal) => {
					const selected = [...this.selections.values()].find((value) => value === request.callerIdentity);
					if (!selected || selected.owner.isDestroyed() || selected.abort.signal.aborted) return false;
					const binding = [...runtime.bindings].find(
						(value) => value.owner === selected.owner && this.allowed(value),
					);
					if (!binding) return false;
					const permitted = () => {
						if (!this.caller(binding) || signal.aborted) return false;
						if (!selected.session) return true;
						const session = this.options.getSessionContext(selected.session.scope.sessionId);
						return (
							session?.identity === selected.session.identity &&
							session.projectTrusted &&
							(request.effect === "read" || !session.readOnly)
						);
					};
					if (!permitted()) return false;
					if (request.effect === "read") return true;
					return (await this.options.approve(selected.owner, source, request.operation)) && permitted();
				},
			},
			this.applicationId,
		);
		registry.register(source.pluginId, this.options.factory(source));
		const runtime: Runtime = {
			name,
			source,
			registry,
			bindings: new Set(),
			activationOwner: owner,
			active: false,
		};
		this.runtimes.set(source.pluginId, runtime);
		return runtime;
	}

	async bind(name: string, owner: PluginRuntimeOwner): Promise<string | undefined> {
		if (this.closing || this.transitioning) throw new Error("Plugin runtime unavailable");
		const source = this.options.source(name);
		if (!source) return undefined;
		if (!this.options.enabled(name) || owner.isDestroyed()) throw new Error("Plugin runtime unavailable");
		const stopping = this.revoke(name, owner.id);
		const token = randomUUID();
		const key = JSON.stringify([name, owner.id]);
		this.requests.set(key, { name, ownerId: owner.id, token });
		await stopping;
		if (this.requests.get(key)?.token !== token) throw new Error("Plugin runtime load superseded");
		let runtime = this.runtimes.get(source.pluginId);
		if (runtime?.stopping) await runtime.stopping;
		if (this.requests.get(key)?.token !== token) throw new Error("Plugin runtime load superseded");
		if (
			this.closing ||
			this.transitioning ||
			owner.isDestroyed() ||
			!this.options.enabled(name) ||
			!sameSource(source, this.options.source(name))
		)
			throw new Error("Plugin runtime unavailable");
		runtime = this.runtimes.get(source.pluginId);
		if (runtime && !sameSource(runtime.source, source))
			throw new Error("Plugin runtime source replacement requires teardown");
		runtime ??= this.createRuntime(name, source, owner);
		let binding: Binding;
		const ready = runtime.registry.activate(source.pluginId, () => this.caller(binding));
		binding = { token, name, owner, runtime, abort: new AbortController(), pending: new Set(), ready };
		this.bindings.set(token, binding);
		runtime.bindings.add(binding);
		try {
			await binding.ready;
			runtime.active = true;
			if (!this.allowed(binding)) throw new Error("Plugin runtime binding revoked");
			return token;
		} catch (error) {
			await this.stopBinding(binding);
			throw error;
		}
	}

	async invoke(
		owner: PluginRuntimeOwner,
		token: string,
		operation: string,
		input: unknown,
		selectionToken: string,
	): Promise<unknown> {
		const binding = this.bindings.get(token);
		if (!binding || binding.owner !== owner || owner.isDestroyed())
			throw new Error("Plugin runtime binding is invalid for this window");
		if (
			!this.options.enabled(binding.name) ||
			!sameSource(binding.runtime.source, this.options.source(binding.name))
		) {
			await this.revoke(binding.name);
			throw new Error("Plugin runtime source is no longer enabled");
		}
		const selected = this.selections.get(owner);
		if (!selected || selected.token !== selectionToken || selected.abort.signal.aborted)
			throw new Error("Plugin caller selection lease is invalid");
		const invocation = binding.ready.then(() =>
			binding.runtime.registry
				.bind(binding.runtime.source.pluginId, () =>
					this.selections.get(owner) === selected ? this.caller(binding) : undefined,
				)
				.invoke(operation, input),
		);
		binding.pending.add(invocation);
		try {
			return await invocation;
		} finally {
			binding.pending.delete(invocation);
		}
	}

	async withTransition<T>(action: () => Promise<T>): Promise<T> {
		if (this.closing) throw new Error("Plugin runtime host is closing");
		if (this.transitioning) throw new Error("A plugin lifecycle change is already in progress");
		this.transitioning = true;
		const transition = (async () => {
			await this.revoke();
			if (this.closing) throw new Error("Plugin runtime host is closing");
			return action();
		})();
		this.transition = transition;
		try {
			return await transition;
		} finally {
			this.transitioning = false;
			this.transition = undefined;
		}
	}

	async close(): Promise<void> {
		this.closing = true;
		const results = await Promise.allSettled([this.revoke(), this.transition]);
		const failures = results.filter((result) => result.status === "rejected");
		if (failures.length)
			throw new AggregateError(
				failures.map((failure) => failure.reason),
				"Plugin runtime shutdown failed",
			);
	}

	/** Revoke callers immediately. The final caller also drains and disposes the shared owner. */
	async revoke(name?: string, ownerId?: number): Promise<void> {
		for (const [key, request] of this.requests) {
			if (name !== undefined && request.name !== name) continue;
			if (ownerId !== undefined && request.ownerId !== ownerId) continue;
			this.requests.delete(key);
		}
		for (const binding of this.bindings.values()) {
			if (name !== undefined && binding.name !== name) continue;
			if (ownerId !== undefined && binding.owner.id !== ownerId) continue;
			this.stopBinding(binding);
		}
		if (name === undefined)
			for (const [owner, selected] of this.selections) {
				if (ownerId !== undefined && owner.id !== ownerId) continue;
				selected.abort.abort(new Error("Plugin caller window revoked"));
				this.selections.delete(owner);
			}
		const stops = [...this.stopping.values()]
			.filter(
				(stop) =>
					(name === undefined || stop.name === name) && (ownerId === undefined || stop.ownerId === ownerId),
			)
			.map((stop) => stop.promise);
		const results = await Promise.allSettled(stops);
		const failures = results.filter((result) => result.status === "rejected");
		if (failures.length)
			throw new AggregateError(
				failures.map((failure) => failure.reason),
				"Plugin runtime disposal failed",
			);
	}

	private stopBinding(binding: Binding): Promise<void> {
		const key = JSON.stringify([binding.name, binding.owner.id]);
		const existing = this.stopping.get(key);
		if (existing) return existing.promise;
		this.bindings.delete(binding.token);
		binding.abort.abort(new Error("Plugin caller binding revoked"));
		binding.runtime.bindings.delete(binding);
		const runtime = binding.runtime;
		if (
			(!runtime.bindings.size || (!runtime.active && runtime.activationOwner === binding.owner)) &&
			!runtime.stopping
		) {
			runtime.stopping = runtime.registry.deactivate(runtime.source.pluginId).then(() => {
				this.runtimes.delete(runtime.source.pluginId);
			});
		}
		const promise = (async () => {
			await Promise.allSettled([...binding.pending]);
			if (runtime.stopping) await runtime.stopping;
			this.stopping.delete(key);
		})();
		this.stopping.set(key, { name: binding.name, ownerId: binding.owner.id, promise });
		return promise;
	}
}
