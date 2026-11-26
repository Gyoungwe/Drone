import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { PluginRuntimeEvent } from "@drone/shared";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { PluginNativeSessionFacts, PluginProviderInvocationInput } from "@gyoungwe/plugin-api/runtime";
import { type Binding, beginNativeBootstrap, type Runtime } from "./coordinator-native";
import type { PluginRuntimeBridgeOptions } from "./coordinator-options";
import type { NativeSessionDelivery } from "./native-delivery";
import { type PluginRuntimeSource, sameSource } from "./plugin-source";
import { type PluginRuntimeCaller, PluginRuntimeRegistry } from "./runtime";
import type { PluginCapabilityContext, PluginNativeInvocation } from "./runtime-capabilities";
import {
	type PluginServiceTarget,
	resolveRoleMember,
	serviceCapabilityHandlers,
} from "./service-capabilities";
import type { PluginSessionCallerContext } from "./session-caller";

export type { PluginRuntimeBridgeOptions } from "./coordinator-options";
export type { PluginRuntimeSource } from "./plugin-source";
export interface PluginRuntimeOwner {
	readonly id: number;
	readonly approvalOwner?: PluginRuntimeOwner;
	isSessionBound?(): boolean;
	isDestroyed(): boolean;
}
export interface PluginNativeBootstrap {
	readonly delivery?: NativeSessionDelivery;
	factoryForPath(path: string): Promise<ExtensionFactory | undefined>;
	bindSession(sessionId: string, abort?: () => Promise<void>): void;
	dispose(): Promise<void>;
}
export interface PluginNativeIntegration {
	begin(facts?: PluginNativeSessionFacts): PluginNativeBootstrap;
	manages(path: string): boolean;
	/** Native entries of packages that declared read-only child session support. */
	childExtensionPaths(): readonly string[];
	extensionPaths?(): readonly string[]; // Host-shipped built-in package entries, read on each session load.
}
interface Selection {
	readonly token: string;
	readonly owner: PluginRuntimeOwner;
	readonly session: PluginSessionCallerContext | undefined;
	readonly abort: AbortController;
}
type SourceMatch = (source: PluginRuntimeSource) => boolean;
type RuntimeMatch = (name: string, owner: PluginRuntimeOwner, source: PluginRuntimeSource) => boolean;

/** One domain owner per application/package. Window tokens only grant revocable caller access. */
export class PluginRuntimeBridge {
	private readonly applicationId = randomUUID();
	private nativeSequence = 0;
	private readonly listeners = new Set<(owner: PluginRuntimeOwner, event: PluginRuntimeEvent) => void>();

	onEvent(listener: (owner: PluginRuntimeOwner, event: PluginRuntimeEvent) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
	private closing = false;
	private transition: Promise<unknown> | undefined;
	private transitionScope: "all" | "ui" | SourceMatch | undefined;
	private readonly quarantined = new Map<string, SourceMatch>();
	private readonly refreshable = new WeakSet<Binding>();
	private readonly bindings = new Map<string, Binding>();
	private readonly runtimes = new Map<string, Runtime>();
	private readonly selections = new Map<PluginRuntimeOwner, Selection>();
	private readonly requests = new Map<
		string,
		{ name: string; owner: PluginRuntimeOwner; source: PluginRuntimeSource; token: string }
	>();
	private readonly stopping = new Map<
		string,
		{
			name: string;
			owner: PluginRuntimeOwner;
			source: PluginRuntimeSource;
			readonly failed: boolean;
			promise: Promise<void>;
		}
	>();

	constructor(private readonly options: PluginRuntimeBridgeOptions) {
		// A grant stays valid only while its exact source is an enabled installed source.
		options.taskGrants?.bindSourceValidator((source) => this.sourceCurrent(source));
		options.taskGrants?.bindProviderResolver((consumer, role, member) =>
			resolveRoleMember(consumer, options.sources?.() ?? [], role, member),
		);
	}

	private sourceCurrent(source: PluginRuntimeSource): boolean {
		const listed = this.options.sources?.();
		if (listed) return listed.some((item) => item.state === "enabled" && sameSource(source, item.source));
		return this.sourceAvailable(source.pluginId, source);
	}

	private sourceAvailable(name: string, source: PluginRuntimeSource): boolean {
		return this.options.enabled(name) && sameSource(source, this.options.source(name));
	}

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
			questions: this.options.questionTransport?.(binding.owner.approvalOwner ?? binding.owner),
			sessionIdentity: session?.identity,
			scope: session?.scope ?? { kind: "application" },
			signal: AbortSignal.any([
				binding.abort.signal,
				selected.abort.signal,
				...(session ? [session.signal] : []),
			]),
		};
	}

	private lifecycleBlocked(owner: PluginRuntimeOwner): boolean {
		return (
			this.transitionScope === "all" || (this.transitionScope === "ui" && owner.isSessionBound === undefined)
		);
	}

	private packageBlocked(source: PluginRuntimeSource): boolean {
		if (typeof this.transitionScope === "function" && this.transitionScope(source)) return true;
		return [...this.quarantined.values()].some((match) => match(source));
	}

	private allowed(binding: Binding): boolean {
		return (
			!this.closing &&
			!this.lifecycleBlocked(binding.owner) &&
			this.bindings.has(binding.token) &&
			!binding.owner.isDestroyed() &&
			!binding.abort.signal.aborted &&
			this.sourceAvailable(binding.name, binding.runtime.source)
		);
	}

	private serviceConsumer(
		source: PluginRuntimeSource,
		context: PluginCapabilityContext,
		effect: "read" | "write",
	): Selection | undefined {
		context.signal.throwIfAborted();
		if (
			context.pluginId !== source.pluginId ||
			context.applicationId !== this.applicationId ||
			!source.contentHash ||
			!this.options.sources?.().some((item) => item.state === "enabled" && sameSource(source, item.source))
		)
			throw new Error("Provider consumer source is unavailable");
		if (context.bootstrap) return undefined;
		const selected = [...this.selections.values()].find((value) => value === context.callerIdentity);
		const binding =
			selected &&
			[...this.bindings.values()].find(
				(value) =>
					value.owner === selected.owner && sameSource(source, value.runtime.source) && this.allowed(value),
			);
		if (!binding || !selected || !this.caller(binding))
			throw new Error("Provider consumer caller is unavailable");
		if (
			context.nativeInvocation &&
			!binding.runtime.registry.hasNativeInvocation(context.nativeInvocation, context.sessionIdentity)
		)
			throw new Error("Provider native caller attachment is no longer active");
		if (selected.session) {
			const session = this.options.getSessionContext(selected.session.scope.sessionId);
			if (
				!session ||
				session.identity !== context.sessionIdentity ||
				!session.projectTrusted ||
				(effect === "write" && session.readOnly)
			)
				throw new Error("Provider consumer session is no longer permitted");
		}
		return selected;
	}

	private async invokeProvider(
		consumer: PluginRuntimeSource,
		context: PluginCapabilityContext,
		target: PluginServiceTarget,
		input: PluginProviderInvocationInput,
		effect: "read" | "write",
		nativeInvocation?: PluginNativeInvocation,
	): Promise<unknown> {
		const selected = this.serviceConsumer(consumer, context, effect);
		if (!selected || !context.operation)
			throw new Error("Provider execution requires a live operation caller");
		const check = () => {
			if (this.serviceConsumer(consumer, context, effect) !== selected)
				throw new Error("Provider consumer generation changed");
			if (
				!this.options
					.sources?.()
					.some(
						(item) => item.name === target.name && item.state === "enabled" && item.source === target.source,
					) ||
				!this.sourceAvailable(target.name, target.source)
			)
				throw new Error("Provider source is unavailable or changed");
		};
		check();
		const chain = context.providerChain ?? [{ source: consumer, operation: context.operation }];
		if (
			chain.some(
				(item) =>
					sameSource(item.source as PluginRuntimeSource, target.source) && item.operation === input.operation,
			)
		)
			throw new Error("Recursive provider source/operation call rejected");
		const providerChain = [...chain, { source: target.source, operation: input.operation }];
		const owner: PluginRuntimeOwner = {
			id: --this.nativeSequence,
			approvalOwner: selected.owner.approvalOwner ?? selected.owner,
			isSessionBound: () => selected.owner.isSessionBound?.() === true,
			isDestroyed: () =>
				context.signal.aborted ||
				selected.owner.isDestroyed() ||
				this.selections.get(selected.owner) !== selected,
		};
		this.selectSession(owner, selected.session?.scope.sessionId ?? null);
		let cleanup: Promise<PromiseSettledResult<void>[]> | undefined;
		const stop = () => (cleanup ??= Promise.allSettled([this.revoke(undefined, owner.id)]));
		const abort = () => {
			void stop();
		};
		context.signal.addEventListener("abort", abort, { once: true });
		const execution = (async () => {
			const token = await this.bind(target.name, owner);
			if (!token) throw new Error("Provider source is no longer installed");
			check();
			const binding = this.bindings.get(token);
			if (!binding) throw new Error("Provider binding was revoked");
			const resolveCaller = () => {
				check();
				const caller = this.caller(binding);
				return caller
					? { ...caller, signal: AbortSignal.any([caller.signal, context.signal]), providerChain }
					: undefined;
			};
			const pending = nativeInvocation
				? binding.runtime.registry.invokeNativeExport(
						target.source.pluginId,
						resolveCaller,
						input.operation,
						input.input,
						nativeInvocation,
						effect,
						context.signal,
					)
				: binding.runtime.registry.invokeExport(
						target.source.pluginId,
						resolveCaller,
						input.operation,
						input.input,
						effect,
						context.signal,
					);
			binding.pending.add(pending);
			try {
				const result = await pending;
				check();
				return result;
			} finally {
				binding.pending.delete(pending);
			}
		})();
		const [result] = await Promise.allSettled([execution] as const);
		context.signal.removeEventListener("abort", abort);
		throwFailures([result, ...(await stop())], "Provider execution and lease cleanup failed", true);
		return (result as PromiseFulfilledResult<unknown>).value;
	}

	private createRuntime(
		name: string,
		source: PluginRuntimeSource,
		owner: PluginRuntimeOwner,
		candidate?: () => boolean,
	): Runtime {
		const bindings = new Set<Binding>();
		const approver = owner.approvalOwner ?? owner;
		const configuredCapabilities = this.options.capabilities?.(source, approver);
		const services = serviceCapabilityHandlers({
			consumer: source,
			sources: () => this.options.sources?.() ?? [],
			check: (context, effect) => {
				this.serviceConsumer(source, context, effect);
			},
			invoke: (context, target, input, effect) => this.invokeProvider(source, context, target, input, effect),
			invokeNative: (context, target, input, effect, origin) =>
				this.invokeProvider(source, context, target, input, effect, origin),
		});
		const registry = new PluginRuntimeRegistry(
			{
				authorizeActivation: async (_request, signal) => {
					const available = () =>
						!this.closing &&
						!owner.isDestroyed() &&
						(candidate
							? candidate()
							: !this.lifecycleBlocked(owner) &&
								!this.packageBlocked(source) &&
								this.sourceAvailable(name, source));
					if (!available()) return false;
					const approved = await this.options.approve(approver, source, undefined, undefined, signal);
					return approved && !signal.aborted && available();
				},
				authorizeInvocation: async (request, signal) => {
					const selected = [...this.selections.values()].find((value) => value === request.callerIdentity);
					if (!selected || selected.owner.isDestroyed() || selected.abort.signal.aborted) return false;
					const binding = [...bindings].find(
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
					// Own bookkeeping (session records, granted private state) never prompts.
					if (request.effect === "read" || request.approval === "own") return true;
					if (request.approval === "allowance" && selected.session) {
						const allowance = (request.input as { allowance?: unknown } | undefined)?.allowance;
						if (
							typeof allowance === "string" &&
							this.options.taskGrants?.consumeAllowance(selected.session.identity, source, allowance)
						)
							return permitted();
					}
					if (request.approval !== "always" && selected.session) {
						const grant = this.options.taskGrants?.current(selected.session.identity);
						if (grant && sameSource(grant.source, source) && sameSource(source, this.options.source(name)))
							return permitted();
					}
					const approved = await this.options.approve(
						selected.owner.approvalOwner ?? selected.owner,
						source,
						request.operation,
						request.approvalDetail,
						signal,
						request.approvalReview,
					);
					return approved && permitted();
				},
			},
			this.applicationId,
			async (activation) => {
				const ports =
					typeof configuredCapabilities === "function"
						? await configuredCapabilities(activation)
						: configuredCapabilities;
				return ports
					? { ...ports, handlers: { ...ports.handlers, ...services } }
					: { handlers: services, resources: [] };
			},
		);
		registry.register(source.pluginId, this.options.factory(source));
		return { name, source, registry, bindings, activationOwner: owner, active: false };
	}

	async bind(name: string, owner: PluginRuntimeOwner): Promise<string | undefined> {
		if (this.closing || this.lifecycleBlocked(owner)) throw new Error("Plugin runtime unavailable");
		const source = this.options.source(name);
		if (!source) return undefined;
		if (this.packageBlocked(source)) throw new Error("Plugin package is unavailable");
		const failedStop = [...this.stopping.values()].find(
			(stop) => stop.failed && stop.source.pluginId === source.pluginId,
		);
		if (failedStop) await this.revoke(failedStop.name, failedStop.owner.id, false);
		if (!this.options.enabled(name) || owner.isDestroyed()) throw new Error("Plugin runtime unavailable");
		const current = [...this.bindings.values()].find(
			(binding) => binding.owner === owner && binding.name === name,
		);
		if (current?.runtime.active && this.refreshable.delete(current) && this.allowed(current))
			return current.token;
		const stopping = this.revoke(name, owner.id, false);
		const token = randomUUID();
		const key = JSON.stringify([name, owner.id]);
		this.requests.set(key, { name, owner, source, token });
		await stopping;
		if (this.requests.get(key)?.token !== token) throw new Error("Plugin runtime load superseded");
		let runtime = this.runtimes.get(source.pluginId);
		if (runtime?.stopping) await runtime.stopping;
		if (this.requests.get(key)?.token !== token) throw new Error("Plugin runtime load superseded");
		if (
			this.closing ||
			this.lifecycleBlocked(owner) ||
			this.packageBlocked(source) ||
			owner.isDestroyed() ||
			!this.sourceAvailable(name, source)
		)
			throw new Error("Plugin runtime unavailable");
		runtime = this.runtimes.get(source.pluginId);
		if (runtime && !sameSource(runtime.source, source))
			throw new Error("Plugin runtime source replacement requires teardown");
		runtime ??= this.createRuntime(name, source, owner);
		this.runtimes.set(source.pluginId, runtime);
		let binding: Binding;
		binding = {
			token,
			name,
			owner,
			runtime,
			abort: new AbortController(),
			pending: new Set(),
			invocations: new Map(),
			ready: runtime.registry.activate(source.pluginId, () => this.caller(binding)),
		};
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
		facts?: PluginNativeSessionFacts,
	): PluginNativeBootstrap {
		return beginNativeBootstrap(
			{
				options: this.options,
				bind: (name, owner) => this.bind(name, owner),
				getBinding: (token) => this.bindings.get(token),
				caller: (binding) => this.caller(binding),
				selectSession: (owner, sessionId) => this.selectSession(owner, sessionId),
				allowed: (binding) => this.allowed(binding),
				stopBinding: (binding) => this.stopBinding(binding),
				removeSelection: (owner) => this.selections.delete(owner),
				revoke: (name, ownerId) => this.revoke(name, ownerId),
				nextNativeId: () => --this.nativeSequence,
			},
			owner,
			findName,
			facts,
		);
	}

	async invoke(
		owner: PluginRuntimeOwner,
		token: string,
		operation: string,
		input: unknown,
		selectionToken: string,
		requestId?: string,
	): Promise<unknown> {
		const binding = this.bindings.get(token);
		if (!binding || binding.owner !== owner || owner.isDestroyed())
			throw new Error("Plugin runtime binding is invalid for this window");
		if (!this.sourceAvailable(binding.name, binding.runtime.source)) {
			await this.revoke(binding.name);
			throw new Error("Plugin runtime source is no longer enabled");
		}
		const selected = this.selections.get(owner);
		if (!selected || selected.token !== selectionToken || selected.abort.signal.aborted)
			throw new Error("Plugin caller selection lease is invalid");
		if (requestId !== undefined && binding.invocations.has(requestId))
			throw new Error("Plugin invocation request ID is already active");
		const abort = new AbortController();
		const invocation = binding.ready.then(() =>
			binding.runtime.registry
				.bind(binding.runtime.source.pluginId, () =>
					this.selections.get(owner) === selected ? this.caller(binding) : undefined,
				)
				.invoke(operation, input, abort.signal),
		);
		if (requestId !== undefined)
			binding.invocations.set(requestId, { selectionToken, abort, pending: invocation });
		binding.pending.add(invocation);
		try {
			return await invocation;
		} finally {
			binding.pending.delete(invocation);
			if (requestId !== undefined) binding.invocations.delete(requestId);
		}
	}

	/** Request IDs grant no authority: only the same live window, binding and selection can cancel. */
	async cancel(
		owner: PluginRuntimeOwner,
		token: string,
		selectionToken: string,
		requestId: string,
	): Promise<boolean> {
		const binding = this.bindings.get(token);
		if (!binding || binding.owner !== owner || !this.allowed(binding))
			throw new Error("Plugin runtime binding is invalid for this window");
		const selected = this.selections.get(owner);
		if (!selected || selected.token !== selectionToken || selected.abort.signal.aborted)
			throw new Error("Plugin caller selection lease is invalid");
		const invocation = binding.invocations.get(requestId);
		if (!invocation || invocation.selectionToken !== selectionToken) return false;
		invocation.abort.abort(new Error("Plugin invocation canceled"));
		await Promise.allSettled([invocation.pending]);
		return true;
	}

	private async runTransition<T>(
		scope: NonNullable<PluginRuntimeBridge["transitionScope"]>,
		action: () => Promise<T>,
	): Promise<T> {
		if (this.closing) throw new Error("Plugin runtime host is closing");
		if (this.transition) throw new Error("A plugin lifecycle change is already in progress");
		this.transitionScope = scope;
		const transition = Promise.resolve().then(async () => {
			if (scope === "all") await this.revoke();
			if (scope === "ui") {
				const window = (owner: PluginRuntimeOwner) => owner.isSessionBound === undefined;
				await this.revokeMatching((_name, owner) => window(owner), window);
			}
			if (this.closing) throw new Error("Plugin runtime host is closing");
			return action();
		});
		this.transition = transition;
		try {
			return await transition;
		} finally {
			this.transitionScope = undefined;
			this.transition = undefined;
		}
	}

	withTransition<T>(action: () => Promise<T>): Promise<T> {
		return this.runTransition("all", action);
	}

	withUiTransition<T>(action: () => Promise<T>): Promise<T> {
		return this.runTransition("ui", action);
	}

	withPackageTransition<T>(
		key: string,
		match: SourceMatch,
		owner: PluginRuntimeOwner,
		action: (drained: boolean, quarantine: () => void) => Promise<T>,
	): Promise<T> {
		return this.runTransition(match, async () => {
			if (this.quarantined.has(key)) throw new Error("Plugin package is quarantined");
			const affected = [...this.bindings.values()].filter(({ runtime }) => match(runtime.source));
			if (affected.some(({ name, runtime }) => !this.sourceAvailable(name, runtime.source)))
				throw new Error("Installed runtime source changed");
			await Promise.all(
				affected.map(({ owner, abort: { signal } }) =>
					owner.isSessionBound?.() && !signal.aborted ? once(signal, "abort") : undefined,
				),
			);
			const drained = affected.length > 0 || [...this.stopping.values()].some(({ source }) => match(source));
			await this.revokeMatching((_name, _owner, source) => match(source));
			if (this.closing || owner.isDestroyed()) throw new Error("Plugin package caller is unavailable");
			const result = await action(drained, () => {
				this.quarantined.set(key, match);
			});
			for (const binding of this.bindings.values())
				if (binding.owner.isSessionBound === undefined) this.refreshable.add(binding);
			return result;
		});
	}

	packageProbeRegistry(
		source: PluginRuntimeSource,
		owner: PluginRuntimeOwner,
		current: () => boolean,
	): PluginRuntimeRegistry {
		if (typeof this.transitionScope !== "function")
			throw new Error("Package probe requires a scoped transition");
		return this.createRuntime(source.pluginId, source, owner, current).registry;
	}

	async close(): Promise<void> {
		this.closing = true;
		const results = await Promise.allSettled([this.revoke(), this.transition]);
		throwFailures(results, "Plugin runtime shutdown failed");
	}

	/** Revoke callers immediately. The final caller also drains and disposes the shared owner. */
	revoke(name?: string, ownerId?: number, includeUnadopted = true): Promise<void> {
		const matches = (owner: PluginRuntimeOwner) =>
			ownerId === undefined ||
			owner.id === ownerId ||
			(includeUnadopted && owner.approvalOwner?.id === ownerId && !owner.isSessionBound?.());
		return this.revokeMatching(
			(runtimeName, owner) => (name === undefined || runtimeName === name) && matches(owner),
			name === undefined ? (owner) => ownerId === undefined || owner.id === ownerId : undefined,
		);
	}

	private async revokeMatching(
		matches: RuntimeMatch,
		selection?: (owner: PluginRuntimeOwner) => boolean,
	): Promise<void> {
		for (const [key, { name, owner, source }] of this.requests)
			if (matches(name, owner, source)) this.requests.delete(key);
		for (const binding of this.bindings.values())
			if (matches(binding.name, binding.owner, binding.runtime.source)) this.stopBinding(binding);
		if (selection)
			for (const [owner, selected] of this.selections) {
				if (!selection(owner)) continue;
				selected.abort.abort(new Error("Plugin caller window revoked"));
				this.selections.delete(owner);
			}
		const stops = [...this.stopping.values()]
			.filter(({ name, owner, source }) => matches(name, owner, source))
			.map((stop) => stop.promise);
		throwFailures(await Promise.allSettled(stops), "Plugin runtime disposal failed");
	}

	private stopBinding(binding: Binding): Promise<void> {
		const key = JSON.stringify([binding.name, binding.owner.id]);
		const existing = this.stopping.get(key);
		if (existing) return existing.promise;
		this.bindings.delete(binding.token);
		binding.unsubscribe?.();
		binding.abort.abort(new Error("Plugin caller binding revoked"));
		const nativeAborted = binding.nativeAbort?.();
		const runtime = binding.runtime;
		runtime.bindings.delete(binding);
		if (!runtime.bindings.size || (!runtime.active && runtime.activationOwner === binding.owner)) {
			runtime.stopping ??= runtime.registry.deactivate(runtime.source.pluginId).then(() => {
				this.runtimes.delete(runtime.source.pluginId);
			});
		}
		let failed = false;
		const promise = (async () => {
			await Promise.allSettled([...binding.pending]);
			const results = await Promise.allSettled([nativeAborted, runtime.stopping]);
			failed = results.some((result) => result.status === "rejected");
			throwFailures(results, "Plugin native run and runtime shutdown failed");
			this.stopping.delete(key);
		})();
		this.stopping.set(key, {
			name: binding.name,
			owner: binding.owner,
			source: runtime.source,
			get failed() {
				return failed;
			},
			promise,
		});
		return promise;
	}
}

function throwFailures(results: PromiseSettledResult<unknown>[], message: string, unwrap = false): void {
	const reasons = results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
	if (unwrap && reasons.length === 1) throw reasons[0];
	if (reasons.length) throw new AggregateError(reasons, message);
}
