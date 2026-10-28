import { randomUUID } from "node:crypto";
import type { PluginRuntimeEvent } from "@drone/shared";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { PluginNativeRuntimeFactory, PluginNativeSession } from "@gyoungwe/plugin-api/native";
import type { PluginRuntimeClient } from "@gyoungwe/plugin-api/runtime";
import { type PluginRuntimeCaller, PluginRuntimeRegistry } from "./runtime";
import type {
	PluginRuntimeCapabilitiesOptions,
	PluginRuntimeCapabilitiesProvider,
} from "./runtime-capabilities";
import type { PluginSessionCallerContext } from "./session-caller";

export interface PluginRuntimeSource {
	readonly pluginId: string;
	readonly packageRoot: string;
	readonly entrypoint: string;
	readonly nativeEntrypoint?: string;
	readonly requestsStateRead?: boolean;
	readonly requestsStateWrite?: boolean;
	readonly requestsFileRead?: boolean;
	readonly requestsFileWrite?: boolean;
	readonly requestsModel?: boolean;
	readonly resources?: Readonly<Record<string, string>>;
}
export interface PluginRuntimeOwner {
	readonly id: number;
	readonly approvalOwner?: PluginRuntimeOwner;
	isSessionBound?(): boolean;
	isDestroyed(): boolean;
}
export interface PluginNativeBootstrap {
	factoryForPath(path: string): Promise<ExtensionFactory | undefined>;
	bindSession(sessionId: string): void;
	dispose(): Promise<void>;
}
export interface PluginNativeIntegration {
	begin(): PluginNativeBootstrap;
	manages(path: string): boolean;
}

export interface PluginRuntimeBridgeOptions {
	source(name: string): PluginRuntimeSource | undefined;
	enabled(name: string): boolean;
	factory(source: PluginRuntimeSource): PluginNativeRuntimeFactory;
	capabilities?(
		source: PluginRuntimeSource,
		owner: PluginRuntimeOwner,
	): PluginRuntimeCapabilitiesOptions | PluginRuntimeCapabilitiesProvider;
	approve(
		owner: PluginRuntimeOwner,
		source: PluginRuntimeSource,
		operation?: string,
		detail?: string,
	): Promise<boolean>;
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
	unsubscribe?: () => void;
}
function sameSource(a: PluginRuntimeSource, b: PluginRuntimeSource | undefined): boolean {
	return (
		a.pluginId === b?.pluginId &&
		a.packageRoot === b.packageRoot &&
		a.entrypoint === b.entrypoint &&
		a.nativeEntrypoint === b.nativeEntrypoint &&
		a.requestsStateRead === b.requestsStateRead &&
		a.requestsStateWrite === b.requestsStateWrite &&
		a.requestsFileRead === b.requestsFileRead &&
		a.requestsFileWrite === b.requestsFileWrite &&
		a.requestsModel === b.requestsModel &&
		JSON.stringify(a.resources) === JSON.stringify(b.resources)
	);
}

/** One domain owner per application/package. Window tokens only grant revocable caller access. */
export class PluginRuntimeBridge {
	private readonly applicationId = randomUUID();
	private nativeSequence = 0;
	private readonly listeners = new Set<(owner: PluginRuntimeOwner, event: PluginRuntimeEvent) => void>();

	onEvent(listener: (owner: PluginRuntimeOwner, event: PluginRuntimeEvent) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
	private transitioning = false;
	private closing = false;
	private transition: Promise<unknown> | undefined;
	private readonly bindings = new Map<string, Binding>();
	private readonly runtimes = new Map<string, Runtime>();
	private readonly selections = new Map<PluginRuntimeOwner, Selection>();
	private readonly requests = new Map<string, { name: string; owner: PluginRuntimeOwner; token: string }>();
	private readonly stopping = new Map<
		string,
		{ name: string; owner: PluginRuntimeOwner; promise: Promise<void> }
	>();

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
					const approved = await this.options.approve(owner.approvalOwner ?? owner, source);
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
					return (
						(await this.options.approve(
							selected.owner.approvalOwner ?? selected.owner,
							source,
							request.operation,
							request.approvalDetail,
						)) && permitted()
					);
				},
			},
			this.applicationId,
			this.options.capabilities?.(source, owner.approvalOwner ?? owner),
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
		const stopping = this.revoke(name, owner.id, false);
		const token = randomUUID();
		const key = JSON.stringify([name, owner.id]);
		this.requests.set(key, { name, owner, token });
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
			const client = await binding.ready;
			runtime.active = true;
			if (!this.allowed(binding)) throw new Error("Plugin runtime binding revoked");
			binding.unsubscribe = client.subscribe((event) => {
				const selected = this.selections.get(owner);
				if (!selected || !this.caller(binding)) return;
				for (const listener of this.listeners)
					listener(owner, { ...event, binding: token, selectionToken: selected.token });
			});
			return token;
		} catch (error) {
			await this.stopBinding(binding);
			throw error;
		}
	}

	/** Resource discovery owns these leases until the real SDK session adopts their shutdown handlers. */
	beginNative(
		owner: PluginRuntimeOwner,
		findName: (path: string) => string | undefined,
	): PluginNativeBootstrap {
		const attachments = new Set<PluginNativeSession>();
		const owners = new Set<PluginRuntimeOwner>();
		const pending = new Set<Promise<ExtensionFactory | undefined>>();
		const binders = new Set<(session: PluginSessionCallerContext) => void>();
		let bound: PluginSessionCallerContext | undefined;
		let closed = false;
		return {
			bindSession: (sessionId) => {
				const session = this.options.getSessionContext(sessionId);
				if (!session || closed || (bound && bound.identity !== session.identity))
					throw new Error("Native bootstrap requires its actual live session entry");
				bound = session;
				for (const bind of binders) bind(session);
			},
			factoryForPath: (path) => {
				const creating = (async () => {
					if (closed) throw new Error("Native plugin bootstrap is closed");
					const name = findName(path);
					if (!name) return undefined;
					const nativeOwner: PluginRuntimeOwner = {
						id: --this.nativeSequence,
						approvalOwner: owner,
						isDestroyed: () => closed || (bound ? bound.signal.aborted : owner.isDestroyed()),
						isSessionBound: () => bound !== undefined,
					};
					owners.add(nativeOwner);
					const token = await this.bind(name, nativeOwner);
					if (!token) throw new Error("Managed native plugin source is unavailable");
					const binding = this.bindings.get(token);
					if (!binding) throw new Error("Native plugin binding was revoked");
					let boundSession: PluginSessionCallerContext | undefined;
					const bind = (session: PluginSessionCallerContext) => {
						boundSession = session;
						this.selectSession(nativeOwner, session.scope.sessionId);
					};
					binders.add(bind);
					if (bound) bind(bound);
					let native: PluginNativeSession;
					try {
						native = await binding.runtime.registry.attachNative(binding.runtime.source.pluginId, (ctx) => {
							const session = this.options.getSessionContext(ctx.sessionManager.getSessionId());
							if (!boundSession || !session || boundSession.identity !== session.identity) return undefined;
							return this.caller(binding);
						});
					} catch (error) {
						await this.stopBinding(binding);
						throw error;
					}
					let stopping: Promise<void> | undefined;
					const dispose = () => {
						stopping ??= (async () => {
							binding.abort.abort(new Error("Native plugin session closed"));
							const [released] = await Promise.allSettled([native.dispose()]);
							const [stopped] = await Promise.allSettled([this.stopBinding(binding)]);
							this.selections.delete(nativeOwner);
							attachments.delete(adopted);
							binders.delete(bind);
							const failures = [released, stopped].filter((result) => result.status === "rejected");
							if (failures.length)
								throw new AggregateError(
									failures.map((result) => result.reason),
									"Native plugin session disposal failed",
								);
						})();
						return stopping;
					};
					const adopted: PluginNativeSession = {
						...native,
						dispose,
						extension: async (pi) => {
							await native.extension(pi);
							pi.on("session_shutdown", dispose);
						},
					};
					attachments.add(adopted);
					if (closed) {
						await dispose();
						throw new Error("Native plugin bootstrap was revoked");
					}
					return adopted.extension;
				})();
				pending.add(creating);
				void creating.then(
					() => pending.delete(creating),
					() => pending.delete(creating),
				);
				return creating;
			},
			dispose: async () => {
				closed = true;
				const revoked = await Promise.allSettled(
					[...owners].map((owner) => this.revoke(undefined, owner.id)),
				);
				// Each loader retains its error; disposal waits for all pending registration cleanup.
				await Promise.allSettled([...pending]);
				const results = [
					...revoked,
					...(await Promise.allSettled([...attachments].map((native) => native.dispose()))),
				];
				const failures = results.filter((result) => result.status === "rejected");
				if (failures.length)
					throw new AggregateError(
						failures.map((result) => result.reason),
						"Native plugin bootstrap disposal failed",
					);
			},
		};
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
	async revoke(name?: string, ownerId?: number, includeUnadopted = true): Promise<void> {
		const matches = (owner: PluginRuntimeOwner) =>
			ownerId === undefined ||
			owner.id === ownerId ||
			(includeUnadopted && owner.approvalOwner?.id === ownerId && !owner.isSessionBound?.());
		for (const [key, request] of this.requests) {
			if (name !== undefined && request.name !== name) continue;
			if (!matches(request.owner)) continue;
			this.requests.delete(key);
		}
		for (const binding of this.bindings.values()) {
			if (name !== undefined && binding.name !== name) continue;
			if (!matches(binding.owner)) continue;
			this.stopBinding(binding);
		}
		if (name === undefined)
			for (const [owner, selected] of this.selections) {
				if (ownerId !== undefined && owner.id !== ownerId) continue;
				selected.abort.abort(new Error("Plugin caller window revoked"));
				this.selections.delete(owner);
			}
		const stops = [...this.stopping.values()]
			.filter((stop) => (name === undefined || stop.name === name) && matches(stop.owner))
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
		binding.unsubscribe?.();
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
		this.stopping.set(key, { name: binding.name, owner: binding.owner, promise });
		return promise;
	}
}
