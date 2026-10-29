import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type {
	PluginNativeRuntimeFactory,
	PluginNativeRuntimeInstance,
	PluginNativeSession,
} from "@gyoungwe/plugin-api/native";
import type {
	PluginNativeSessionFacts,
	PluginRuntimeChangedEvent,
	PluginRuntimeClient,
	PluginRuntimeOperation,
	PluginRuntimeScope,
} from "@gyoungwe/plugin-api/runtime";
import { Check } from "typebox/value";
import { hostText } from "../reply-language";
import type { AskQuestionRoute } from "../session/ask-gate";
import { NATIVE_EVENTS } from "./native-events";
import {
	PluginCapabilityBroker,
	type PluginNativeInvocation,
	type PluginRuntimeCapabilitiesOptions,
	type PluginRuntimeCapabilitiesProvider,
} from "./runtime-capabilities";

export type {
	PluginCapabilityContext,
	PluginCapabilityHandler,
	PluginRuntimeCapabilitiesOptions,
} from "./runtime-capabilities";

/** Host-only facade; only the registry can borrow a real caller for the source projector. */
export interface ManagedNativeSession extends PluginNativeSession {
	readonly hostProjection?: {
		finalize?(event: unknown, signal: AbortSignal): Promise<unknown>;
		event(event: unknown, signal?: AbortSignal): Promise<unknown>;
		snapshot(messages: unknown[], persisted: unknown[], signal?: AbortSignal): Promise<unknown[]>;
	};
}

export interface PluginRuntimeActivation {
	readonly pluginId: string;
	readonly applicationId: string;
}

/** Host-only lease; identity is an object owned by the resolved caller generation, never JSON input. */

export interface PluginRuntimeCaller {
	readonly providerChain?: readonly { readonly source: object; readonly operation: string }[];
	readonly questions?: AskQuestionRoute;
	readonly identity: object;
	/** Distinct from a window selection lease; used only by host capability handlers. */
	readonly sessionIdentity?: object;
	readonly scope: PluginRuntimeScope;
	readonly signal: AbortSignal;
}

export type PluginRuntimeCallerResolver = () => PluginRuntimeCaller | undefined;

export interface PluginRuntimeInvocation extends PluginRuntimeActivation {
	readonly scope: PluginRuntimeScope;
	readonly callerIdentity: object;
	readonly operation: string;
	readonly effect: PluginRuntimeOperation["effect"];
	readonly input: unknown;
	/** Produced by a host capability handler, never taken from plugin operation input. */
	readonly approvalDetail?: string;
}

export interface PluginRuntimePolicy {
	/** Recheck enablement/trust before the factory imports or executes any plugin code. */
	authorizeActivation(request: PluginRuntimeActivation, signal: AbortSignal): Promise<boolean>;
	/** Enforce caller access and declared permissions; write approval may interact with the user. */
	authorizeInvocation(request: PluginRuntimeInvocation, signal: AbortSignal): Promise<boolean>;
}

class ActivationDeniedError extends Error {}

interface Activation extends PluginRuntimeActivation {
	state: "activating" | "active" | "stopping";
	readonly abort: AbortController;
	readonly pending: Set<Promise<unknown>>;
	readonly natives: Set<PluginNativeSession>;
	capabilities?: PluginCapabilityBroker;
	ports?: PluginRuntimeCapabilitiesOptions;
	portsStopping?: Promise<void>;
	portsReleased?: Promise<void>;
	readonly listeners: Set<(event: PluginRuntimeChangedEvent) => void>;
	revision: number;
	ready: Promise<PluginNativeRuntimeInstance>;
	stopping?: Promise<void>;
}

type RegistryOperation = PluginRuntimeOperation & { readonly approvalDetail?: string };

/** UI approval can outlive its caller; cancellation revokes authority without waiting for the dialog. */
async function authorize(approval: () => Promise<boolean>, signal: AbortSignal): Promise<boolean> {
	signal.throwIfAborted();
	let abort!: () => void;
	const canceled = new Promise<never>((_resolve, reject) => {
		abort = () => reject(signal.reason);
		signal.addEventListener("abort", abort, { once: true });
	});
	try {
		return await Promise.race([approval(), canceled]);
	} finally {
		signal.removeEventListener("abort", abort);
	}
}

/**
 * Per-host lifecycle for optional desktop adapters. It owns no domain state.
 * Only the host composition root registers factories and binds caller scopes;
 * renderer IPC must receive a client already bound to its authenticated owner.
 */
export class PluginRuntimeRegistry {
	private readonly factories = new Map<string, PluginNativeRuntimeFactory>();
	private readonly activations = new Map<string, Activation>();
	private readonly nativeCallers = new WeakMap<
		PluginNativeSession,
		{ readonly resolve: PluginRuntimeCallerResolver | undefined; readonly lifetime: AbortController }
	>();

	constructor(
		private readonly policy: PluginRuntimePolicy,
		readonly applicationId: string = randomUUID(),
		private readonly capabilitiesOptions:
			| PluginRuntimeCapabilitiesOptions
			| PluginRuntimeCapabilitiesProvider = { handlers: {}, resources: [] },
	) {}

	/** The factory must defer its dynamic import until called after activation authorization. */
	register(pluginId: string, factory: PluginNativeRuntimeFactory): void {
		if (this.factories.has(pluginId)) throw new Error(`Plugin runtime already registered: ${pluginId}`);
		this.factories.set(pluginId, factory);
	}

	async activate(pluginId: string, resolveCaller: PluginRuntimeCallerResolver): Promise<PluginRuntimeClient> {
		const activationKey = pluginId;
		const existing = this.activations.get(activationKey);
		if (existing) {
			if (existing.state === "stopping") throw new Error(`Plugin runtime is stopping: ${pluginId}`);
			await existing.ready;
			existing.abort.signal.throwIfAborted();
			return this.client(existing, resolveCaller);
		}
		const factory = this.factories.get(pluginId);
		if (!factory) throw new Error(`Plugin runtime is not registered: ${pluginId}`);
		const applicationId = this.applicationId;
		const abort = new AbortController();
		const events = {
			changed: () => {
				abort.signal.throwIfAborted();
				const event: PluginRuntimeChangedEvent = { type: "changed", revision: ++activation.revision };
				for (const listener of activation.listeners) listener(event);
			},
		};
		// Start in a microtask so the activation is indexed before factory callbacks can re-enter.
		const ready = Promise.resolve().then(async () => {
			abort.signal.throwIfAborted();
			if (
				!(await authorize(
					() => this.policy.authorizeActivation({ pluginId, applicationId }, abort.signal),
					abort.signal,
				))
			) {
				throw new ActivationDeniedError(`Plugin runtime activation denied: ${pluginId}`);
			}
			abort.signal.throwIfAborted();
			const ports =
				typeof this.capabilitiesOptions === "function"
					? await this.capabilitiesOptions({ pluginId, applicationId, signal: abort.signal, events })
					: this.capabilitiesOptions;
			activation.ports = ports;
			const capabilities = new PluginCapabilityBroker(ports);
			activation.capabilities = capabilities;
			abort.signal.throwIfAborted();
			return capabilities.run(
				{
					pluginId,
					applicationId,
					scope: { kind: "application" },
					callerIdentity: undefined,
					signal: abort.signal,
					bootstrap: true,
				},
				"read",
				() => abort.signal.throwIfAborted(),
				async () => false,
				() =>
					factory({
						applicationId,
						signal: abort.signal,
						resources: ports.resources,
						...(ports.resourcesLifecycle ? { resourcesLifecycle: ports.resourcesLifecycle } : {}),
						capabilities: capabilities.port,
						events,
					}),
			);
		});
		const activation: Activation = {
			pluginId,
			applicationId,
			state: "activating",
			abort,
			pending: new Set(),
			natives: new Set(),
			listeners: new Set(),
			revision: 0,
			ready,
		};
		this.activations.set(activationKey, activation);
		try {
			await ready;
			abort.signal.throwIfAborted();
			activation.state = "active";
			return this.client(activation, resolveCaller);
		} catch (error) {
			// Failed activation is retryable. A concurrent deactivate still owns disposal.
			if (activation.state !== "stopping") {
				const [closed] = await Promise.allSettled([
					this.stopPorts(activation).then(() => this.releasePorts(activation)),
				]);
				this.activations.delete(activationKey);
				if (closed.status === "rejected")
					throw new AggregateError([error, closed.reason], "Plugin activation and capability cleanup failed");
			}
			throw error;
		}
	}

	bind(pluginId: string, resolveCaller: PluginRuntimeCallerResolver): PluginRuntimeClient {
		const activation = this.activations.get(pluginId);
		if (activation?.state !== "active") {
			throw new Error(`Plugin runtime is not active: ${pluginId}`);
		}
		return this.client(activation, resolveCaller);
	}

	/** Host service routing borrows the actual caller but cannot escalate a read to a write export. */
	invokeExport(
		pluginId: string,
		resolveCaller: PluginRuntimeCallerResolver,
		name: string,
		input: unknown,
		effectCeiling: "read" | "write",
		signal: AbortSignal,
	): Promise<unknown> {
		const activation = this.activations.get(pluginId);
		if (!activation) throw new Error(`Plugin runtime is not active: ${pluginId}`);
		return this.call(activation, resolveCaller, name, input, signal, undefined, false, effectCeiling);
	}

	/** Native callbacks use the same owner and policy as UI operations, bound from real SDK context. */
	async attachNative(
		pluginId: string,
		resolveCaller: (context: ExtensionContext) => PluginRuntimeCaller | undefined,
		resolveProjectionCaller?: PluginRuntimeCallerResolver,
		facts?: PluginNativeSessionFacts,
	): Promise<ManagedNativeSession> {
		const activation = this.activations.get(pluginId);
		if (activation?.state !== "active") throw new Error(`Plugin runtime is not active: ${pluginId}`);
		const instance = await activation.ready;
		const create = instance.createNativeSession?.bind(instance);
		if (!create) throw new Error(`Plugin has no native session adapter: ${pluginId}`);
		const creating = Promise.resolve().then(async () => {
			const native = await create(facts);
			const lifetime = new AbortController();
			let closing: Promise<void> | undefined;
			const owned = {
				...native,
				dispose: () => {
					lifetime.abort(new Error("Native provider attachment closed"));
					closing ??= native.dispose().then(() => {
						activation.natives.delete(owned);
					});
					return closing;
				},
			};
			this.nativeCallers.set(owned, { resolve: resolveProjectionCaller, lifetime });
			activation.natives.add(owned);
			return { native: owned, lifetime };
		});
		activation.pending.add(creating);
		let attached: { native: PluginNativeSession; lifetime: AbortController };
		try {
			attached = await creating;
		} finally {
			activation.pending.delete(creating);
		}
		activation.abort.signal.throwIfAborted();
		const { native, lifetime } = attached;
		const nativeSignal = (signal?: AbortSignal) =>
			AbortSignal.any([lifetime.signal, ...(signal ? [signal] : [])]);
		const projection = native.projection;
		const finalizer = projection?.finalize?.bind(projection);
		const projectionCaller = () => resolveProjectionCaller?.();
		const finalize = finalizer
			? (event: unknown, signal: AbortSignal) =>
					this.call(activation, projectionCaller, "native:projection:finalize", event, signal, {
						inputSchema: {},
						resultSchema: {},
						effect: projection?.finalizeEffect ?? "write",
						execute: async (_input, call) => finalizer(event, call),
					})
			: undefined;
		const projected = projection
			? {
					...projection,
					...(finalize
						? {
								finalize: (
									event: unknown,
									context: import("@gyoungwe/plugin-api/runtime").PluginRuntimeContext,
								) => finalize(event, context.signal),
							}
						: {}),
					event: (event: unknown, signal?: AbortSignal) =>
						this.call(
							activation,
							projectionCaller,
							"native:projection:event",
							event,
							signal,
							{
								inputSchema: {},
								resultSchema: {},
								effect: "read",
								execute: async (_input, call) => projection.event(event, call.signal),
							},
							true,
						),
					snapshot: (messages: unknown[], persisted: unknown[], signal?: AbortSignal) =>
						this.call(
							activation,
							projectionCaller,
							"native:projection:snapshot",
							{ messages, persisted },
							signal,
							{
								inputSchema: {},
								resultSchema: { type: "array" },
								effect: "read",
								execute: async (_input, call) => projection.snapshot(messages, persisted, call.signal),
							},
							true,
						) as Promise<unknown[]>,
				}
			: undefined;
		return {
			...native,
			nativeOperations: undefined,
			projection: projected,
			// Do not pass through a similarly named property from untyped source exports.
			hostProjection: projected
				? { ...(finalize ? { finalize } : {}), event: projected.event, snapshot: projected.snapshot }
				: undefined,
			extension: (pi) => {
				const adapted = {} as ExtensionAPI;
				adapted.registerTool = ((tool: ToolDefinition) =>
					pi.registerTool({
						...tool,
						// The official SDK exposes this per-session declaration to task planning.
						// Capability authorization still uses the operation/port effects below.
						annotations: { ...tool.annotations, readOnlyHint: native.toolEffects?.[tool.name] === "read" },
						execute: (id, input, signal, update, context) =>
							this.call(
								activation,
								() => resolveCaller(context),
								`native:tool:${tool.name}`,
								input,
								nativeSignal(signal),
								{
									inputSchema: tool.parameters,
									resultSchema: {},
									effect: native.toolEffects?.[tool.name] ?? "write",
									execute: (_input, call) => tool.execute(id, input, call.signal, update, context),
								},
							) as ReturnType<ToolDefinition["execute"]>,
					})) as ExtensionAPI["registerTool"];
				adapted.registerCommand = (name, command) =>
					pi.registerCommand(name, {
						...command,
						handler: async (args, context) => {
							await this.call(
								activation,
								() => resolveCaller(context),
								`native:command:${name}`,
								args,
								nativeSignal(context.signal),
								{
									inputSchema: { type: "string" },
									resultSchema: { type: "null" },
									effect: native.commandEffects?.[name] ?? "write",
									execute: async (_input, call) => {
										const scopedContext = new Proxy(context, {
											get(target, property, receiver) {
												call.signal.throwIfAborted();
												return property === "signal" ? call.signal : Reflect.get(target, property, receiver);
											},
										});
										await command.handler(args, scopedContext);
										return null;
									},
								},
							);
						},
					});
				const on = pi.on.bind(pi) as (
					name: string,
					handler: (event: unknown, context: ExtensionContext) => Promise<unknown>,
				) => () => void;
				adapted.on = ((name: string, handler: (event: unknown, context: ExtensionContext) => unknown) => {
					if (!(NATIVE_EVENTS as readonly string[]).includes(name))
						throw new Error(`Unsupported native Pi event: ${name}`);
					return on(name, async (event, context) => {
						// Shutdown releases the attachment with no new caller authority or capability grant.
						if (name === "session_shutdown") return handler(event, context);
						return this.call(
							activation,
							() => resolveCaller(context),
							`native:event:${name}`,
							event,
							nativeSignal(context.signal),
							{
								inputSchema: {},
								resultSchema: {},
								effect: native.eventEffects?.[name] ?? (name === "session_start" ? "read" : "write"),
								execute: async (_input, call) =>
									handler(
										event,
										new Proxy(context, {
											get(target, property, receiver) {
												call.signal.throwIfAborted();
												return property === "signal" ? call.signal : Reflect.get(target, property, receiver);
											},
										}),
									),
							},
							false,
							undefined,
							name === "message_start" || name === "tool_execution_end"
								? { kind: name, event, attachment: native }
								: undefined,
						);
					});
				}) as ExtensionAPI["on"];
				return native.extension(
					new Proxy(adapted, {
						get: (target, name) => {
							if (name === "registerTool" || name === "registerCommand" || name === "on") return target[name];
							throw new Error(`Unsupported native Pi API: ${String(name)}`);
						},
					}),
				);
			},
		};
	}

	/** Source capability routing rechecks the exact still-live attachment, not a serialized event claim. */
	hasNativeInvocation(origin: PluginNativeInvocation, sessionIdentity: object | undefined): boolean {
		const binding = this.nativeCallers.get(origin.attachment);
		return (
			!!sessionIdentity &&
			!!binding &&
			!binding.lifetime.signal.aborted &&
			binding.resolve?.()?.sessionIdentity === sessionIdentity
		);
	}

	/** Invoke a declared receiver callback only on its already-bound actual native session. */
	async invokeNativeExport(
		pluginId: string,
		resolveCaller: PluginRuntimeCallerResolver,
		name: string,
		input: unknown,
		origin: PluginNativeInvocation,
		effectCeiling: "read" | "write",
		signal: AbortSignal,
	): Promise<unknown> {
		const activation = this.activations.get(pluginId);
		if (activation?.state !== "active") throw new Error("Provider native attachment is unavailable");
		const caller = resolveCaller();
		if (!caller?.sessionIdentity) throw new Error("Provider native call requires an actual live session");
		const candidates = [...activation.natives].flatMap((native) => {
			const binding = this.nativeCallers.get(native);
			return binding &&
				!binding.lifetime.signal.aborted &&
				binding.resolve?.()?.sessionIdentity === caller.sessionIdentity
				? [{ native, binding }]
				: [];
		});
		const receiver = candidates[0];
		if (!receiver || candidates.length !== 1)
			throw new Error(
				candidates.length
					? "Provider native attachment is ambiguous"
					: "Provider native attachment is unavailable",
			);
		const { native, binding } = receiver;
		const operation =
			native.nativeOperations && Object.hasOwn(native.nativeOperations, name)
				? native.nativeOperations[name]
				: undefined;
		if (!operation) throw new Error(`Provider native operation is unavailable: ${name}`);
		if (operation.event !== origin.kind)
			throw new Error("Provider native operation does not accept this SDK event");
		const currentCaller = () => {
			binding.lifetime.signal.throwIfAborted();
			if (!activation.natives.has(native) || binding.resolve?.()?.sessionIdentity !== caller.sessionIdentity)
				throw new Error("Provider native attachment changed during invocation");
			return resolveCaller();
		};
		return this.call(
			activation,
			currentCaller,
			`native:provider:${name}`,
			input,
			AbortSignal.any([signal, binding.lifetime.signal]),
			{
				inputSchema: operation.inputSchema,
				resultSchema: operation.resultSchema,
				effect: operation.effect,
				approvalDetail: `${hostText("原生事件服务", "Native event service")}: ${name}; effect=${operation.effect}`,
				execute: (value, context) => operation.execute(value, origin.event, context),
			},
			false,
			effectCeiling,
			{ ...origin, attachment: native },
		);
	}

	deactivate(pluginId: string): Promise<void> {
		const activationKey = pluginId;
		const activation = this.activations.get(activationKey);
		if (!activation) return Promise.resolve();
		if (activation.stopping) return activation.stopping;
		activation.state = "stopping";
		activation.listeners.clear();
		activation.abort.abort(new Error(`Plugin runtime deactivated: ${pluginId}`));
		activation.stopping = this.stop(activationKey, activation);
		return activation.stopping;
	}

	private async stop(activationKey: string, activation: Activation): Promise<void> {
		const [created] = await Promise.allSettled([activation.ready]);
		// Callers retain their individual result/error. Teardown waits for cleanup even on rejection.
		await Promise.allSettled([...activation.pending]);
		const nativeStops = await Promise.allSettled([...activation.natives].map((native) => native.dispose()));
		const failures: unknown[] = nativeStops
			.filter((result) => result.status === "rejected")
			.map((result) => result.reason);
		if (created.status === "fulfilled") {
			const [disposed] = await Promise.allSettled([created.value.dispose()]);
			if (disposed.status === "rejected") failures.push(disposed.reason);
		} else if (
			created.reason !== activation.abort.signal.reason &&
			!(created.reason instanceof ActivationDeniedError)
		)
			failures.push(created.reason);
		const [ports] = await Promise.allSettled([this.stopPorts(activation)]);
		if (ports.status === "rejected") failures.push(ports.reason);
		if (failures.length === 0) {
			const [released] = await Promise.allSettled([this.releasePorts(activation)]);
			if (released.status === "rejected") failures.push(released.reason);
		}
		if (failures.length === 1) throw failures[0];
		if (failures.length)
			throw new AggregateError(failures, "Plugin runtime and capabilities shutdown failed");
		this.activations.delete(activationKey);
	}

	private stopPorts(activation: Activation): Promise<void> {
		activation.portsStopping ??= activation.ports?.dispose?.() ?? Promise.resolve();
		return activation.portsStopping;
	}

	private releasePorts(activation: Activation): Promise<void> {
		activation.portsReleased ??= activation.ports?.finalRelease?.() ?? Promise.resolve();
		return activation.portsReleased;
	}

	private client(activation: Activation, resolveCaller: PluginRuntimeCallerResolver): PluginRuntimeClient {
		return {
			subscribe: (listener) => {
				if (activation.state !== "active") throw new Error("Plugin runtime is not active");
				const forward = (event: PluginRuntimeChangedEvent) => {
					const caller = resolveCaller();
					if (caller && !caller.signal.aborted) listener(event);
				};
				activation.listeners.add(forward);
				return () => activation.listeners.delete(forward);
			},
			invoke: (name, input, callerSignal) => this.call(activation, resolveCaller, name, input, callerSignal),
		};
	}

	private async call(
		activation: Activation,
		resolveCaller: PluginRuntimeCallerResolver,
		name: string,
		input: unknown,
		callerSignal?: AbortSignal,
		operationOverride?: RegistryOperation,
		withoutCapabilities = false,
		effectCeiling?: "read" | "write",
		nativeInvocation?: PluginNativeInvocation,
	): Promise<unknown> {
		if (activation.state !== "active") {
			throw new Error(`Plugin runtime is not active: ${activation.pluginId}`);
		}
		const caller = resolveCaller();
		if (!caller) throw new Error("Plugin caller is no longer available");
		const callerIdentity = caller.identity;
		const sessionIdentity = caller.sessionIdentity;
		const scope = Object.freeze({ ...caller.scope });
		const signal = AbortSignal.any([
			activation.abort.signal,
			caller.signal,
			...(callerSignal ? [callerSignal] : []),
		]);
		const checkCaller = () => {
			signal.throwIfAborted();
			const current = resolveCaller();
			if (
				!current ||
				current.identity !== callerIdentity ||
				current.sessionIdentity !== sessionIdentity ||
				JSON.stringify(current.scope) !== JSON.stringify(scope)
			) {
				throw new Error("Plugin caller scope changed during invocation");
			}
		};
		const pending = this.invoke(
			activation,
			name,
			input,
			signal,
			callerIdentity,
			scope,
			checkCaller,
			operationOverride,
			sessionIdentity,
			caller.questions,
			withoutCapabilities,
			effectCeiling,
			caller.providerChain,
			nativeInvocation,
		);
		activation.pending.add(pending);
		try {
			return await pending;
		} finally {
			activation.pending.delete(pending);
		}
	}

	private async invoke(
		activation: Activation,
		name: string,
		input: unknown,
		signal: AbortSignal,
		callerIdentity: object,
		scope: PluginRuntimeScope,
		checkCaller: () => void,
		operationOverride?: RegistryOperation,
		sessionIdentity?: object,
		questions?: AskQuestionRoute,
		withoutCapabilities = false,
		effectCeiling?: "read" | "write",
		providerChain?: PluginRuntimeCaller["providerChain"],
		nativeInvocation?: PluginNativeInvocation,
	): Promise<unknown> {
		signal.throwIfAborted();
		const runtime = await activation.ready;
		const operation =
			operationOverride ?? (Object.hasOwn(runtime.operations, name) ? runtime.operations[name] : undefined);
		if (!operation) throw new Error(`Plugin operation is not registered: ${name}`);
		if (effectCeiling === "read" && operation.effect !== "read")
			throw new Error(`Read-only provider call cannot invoke write export: ${name}`);
		if (!Check(operation.inputSchema, input)) throw new Error(`Invalid plugin operation input: ${name}`);
		const request: PluginRuntimeInvocation = {
			pluginId: activation.pluginId,
			applicationId: activation.applicationId,
			scope,
			callerIdentity,
			operation: name,
			effect: operation.effect,
			input,
			...(operationOverride?.approvalDetail ? { approvalDetail: operationOverride.approvalDetail } : {}),
		};
		if (!(await authorize(() => this.policy.authorizeInvocation(request, signal), signal))) {
			throw new Error(`Plugin operation denied: ${name}`);
		}
		checkCaller();
		const capabilities = activation.capabilities;
		if (!capabilities) throw new Error("Plugin capability owner is not initialized");
		const execute = () => operation.execute(input, { scope, signal, capabilities: capabilities.port });
		const result = withoutCapabilities
			? await capabilities.withoutCaller(execute)
			: await capabilities.run(
					{
						pluginId: activation.pluginId,
						operation: name,
						providerChain,
						nativeInvocation,
						applicationId: activation.applicationId,
						scope,
						callerIdentity,
						sessionIdentity,
						questions,
						signal,
						bootstrap: false,
					},
					operation.effect,
					checkCaller,
					(name, input, effect, approvalDetail, capabilitySignal = signal) =>
						authorize(
							() =>
								this.policy.authorizeInvocation(
									{ ...request, operation: `capability:${name}`, input, effect, approvalDetail },
									capabilitySignal,
								),
							capabilitySignal,
						),
					execute,
				);
		checkCaller();
		if (!Check(operation.resultSchema, result)) throw new Error(`Invalid plugin operation result: ${name}`);
		return result;
	}
}
