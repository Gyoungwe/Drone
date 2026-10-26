import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type {
	PluginNativeRuntimeFactory,
	PluginNativeRuntimeInstance,
	PluginNativeSession,
} from "@gyoungwe/plugin-api/native";
import type {
	PluginRuntimeChangedEvent,
	PluginRuntimeClient,
	PluginRuntimeOperation,
	PluginRuntimeScope,
} from "@gyoungwe/plugin-api/runtime";
import { Check } from "typebox/value";
import { NATIVE_EVENTS } from "./native-events";
import {
	PluginCapabilityBroker,
	type PluginRuntimeCapabilitiesOptions,
	type PluginRuntimeCapabilitiesProvider,
} from "./runtime-capabilities";

export type {
	PluginCapabilityContext,
	PluginCapabilityHandler,
	PluginRuntimeCapabilitiesOptions,
} from "./runtime-capabilities";

export interface PluginRuntimeActivation {
	readonly pluginId: string;
	readonly applicationId: string;
}

/** Host-only lease; identity is an object owned by the resolved caller generation, never JSON input. */
export interface PluginRuntimeCaller {
	readonly identity: object;
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
	readonly listeners: Set<(event: PluginRuntimeChangedEvent) => void>;
	revision: number;
	ready: Promise<PluginNativeRuntimeInstance>;
	stopping?: Promise<void>;
}

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
				const [closed] = await Promise.allSettled([this.stopPorts(activation)]);
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

	/** Native callbacks use the same owner and policy as UI operations, bound from real SDK context. */
	async attachNative(
		pluginId: string,
		resolveCaller: (context: ExtensionContext) => PluginRuntimeCaller | undefined,
	): Promise<PluginNativeSession> {
		const activation = this.activations.get(pluginId);
		if (activation?.state !== "active") throw new Error(`Plugin runtime is not active: ${pluginId}`);
		const instance = await activation.ready;
		const create = instance.createNativeSession?.bind(instance);
		if (!create) throw new Error(`Plugin has no native session adapter: ${pluginId}`);
		const creating = Promise.resolve().then(async () => {
			const native = await create();
			let closing: Promise<void> | undefined;
			const owned = {
				...native,
				dispose: () => {
					closing ??= native.dispose().then(() => {
						activation.natives.delete(owned);
					});
					return closing;
				},
			};
			activation.natives.add(owned);
			return owned;
		});
		activation.pending.add(creating);
		let native: PluginNativeSession;
		try {
			native = await creating;
		} finally {
			activation.pending.delete(creating);
		}
		activation.abort.signal.throwIfAborted();
		return {
			...native,
			extension: (pi) => {
				const adapted = {} as ExtensionAPI;
				adapted.registerTool = ((tool: ToolDefinition) =>
					pi.registerTool({
						...tool,
						// The official SDK exposes this per-session declaration to task planning.
						// Capability authorization still uses the operation/port effects below.
						annotations: { ...tool.annotations, readOnlyHint: native.toolEffects?.[tool.name] === "read" },
						execute: (id, input, signal, update, context) =>
							this.call(activation, () => resolveCaller(context), `native:tool:${tool.name}`, input, signal, {
								inputSchema: tool.parameters,
								resultSchema: {},
								effect: native.toolEffects?.[tool.name] ?? "write",
								execute: (_input, call) => tool.execute(id, input, call.signal, update, context),
							}) as ReturnType<ToolDefinition["execute"]>,
					})) as ExtensionAPI["registerTool"];
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
							undefined,
							{
								inputSchema: {},
								resultSchema: {},
								effect: native.eventEffects?.[name] ?? (name === "session_start" ? "read" : "write"),
								execute: async () => handler(event, context),
							},
						);
					});
				}) as ExtensionAPI["on"];
				return native.extension(
					new Proxy(adapted, {
						get: (target, name) => {
							if (name === "registerTool" || name === "on") return target[name];
							throw new Error(`Unsupported native Pi API: ${String(name)}`);
						},
					}),
				);
			},
		};
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
		if (failures.length === 1) throw failures[0];
		if (failures.length)
			throw new AggregateError(failures, "Plugin runtime and capabilities shutdown failed");
		this.activations.delete(activationKey);
	}

	private stopPorts(activation: Activation): Promise<void> {
		activation.portsStopping ??= activation.ports?.dispose?.() ?? Promise.resolve();
		return activation.portsStopping;
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
		operationOverride?: PluginRuntimeOperation,
	): Promise<unknown> {
		if (activation.state !== "active") {
			throw new Error(`Plugin runtime is not active: ${activation.pluginId}`);
		}
		const caller = resolveCaller();
		if (!caller) throw new Error("Plugin caller is no longer available");
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
				current.identity !== caller.identity ||
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
			caller.identity,
			scope,
			checkCaller,
			operationOverride,
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
		operationOverride?: PluginRuntimeOperation,
	): Promise<unknown> {
		signal.throwIfAborted();
		const runtime = await activation.ready;
		const operation =
			operationOverride ?? (Object.hasOwn(runtime.operations, name) ? runtime.operations[name] : undefined);
		if (!operation) throw new Error(`Plugin operation is not registered: ${name}`);
		if (!Check(operation.inputSchema, input)) throw new Error(`Invalid plugin operation input: ${name}`);
		const request: PluginRuntimeInvocation = {
			pluginId: activation.pluginId,
			applicationId: activation.applicationId,
			scope,
			callerIdentity,
			operation: name,
			effect: operation.effect,
			input,
		};
		if (!(await authorize(() => this.policy.authorizeInvocation(request, signal), signal))) {
			throw new Error(`Plugin operation denied: ${name}`);
		}
		checkCaller();
		const capabilities = activation.capabilities;
		if (!capabilities) throw new Error("Plugin capability owner is not initialized");
		const result = await capabilities.run(
			{
				pluginId: activation.pluginId,
				applicationId: activation.applicationId,
				scope,
				callerIdentity,
				signal,
				bootstrap: false,
			},
			operation.effect,
			checkCaller,
			(name, input, effect) =>
				authorize(
					() =>
						this.policy.authorizeInvocation(
							{ ...request, operation: `capability:${name}`, input, effect },
							signal,
						),
					signal,
				),
			() => operation.execute(input, { scope, signal, capabilities: capabilities.port }),
		);
		checkCaller();
		if (!Check(operation.resultSchema, result)) throw new Error(`Invalid plugin operation result: ${name}`);
		return result;
	}
}
