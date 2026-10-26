import type {
	PluginRuntimeClient,
	PluginRuntimeFactory,
	PluginRuntimeInstance,
	PluginRuntimeOperation,
	PluginRuntimeScope,
} from "@gyoungwe/plugin-api/runtime";
import { Check } from "typebox/value";

export interface PluginRuntimeActivation {
	readonly pluginId: string;
	readonly scope: PluginRuntimeScope;
}

export interface PluginRuntimeInvocation extends PluginRuntimeActivation {
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
	ready: Promise<PluginRuntimeInstance>;
	stopping?: Promise<void>;
}

function key(pluginId: string, scope: PluginRuntimeScope): string {
	return JSON.stringify([pluginId, scope.workspaceId, scope.sessionId]);
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
	private readonly factories = new Map<string, PluginRuntimeFactory>();
	private readonly activations = new Map<string, Activation>();

	constructor(private readonly policy: PluginRuntimePolicy) {}

	/** The factory must defer its dynamic import until called after activation authorization. */
	register(pluginId: string, factory: PluginRuntimeFactory): void {
		if (this.factories.has(pluginId)) throw new Error(`Plugin runtime already registered: ${pluginId}`);
		this.factories.set(pluginId, factory);
	}

	async activate(pluginId: string, scope: PluginRuntimeScope): Promise<PluginRuntimeClient> {
		const activationKey = key(pluginId, scope);
		const existing = this.activations.get(activationKey);
		if (existing) {
			if (existing.state === "stopping") throw new Error(`Plugin runtime is stopping: ${pluginId}`);
			await existing.ready;
			existing.abort.signal.throwIfAborted();
			return this.client(existing);
		}
		const factory = this.factories.get(pluginId);
		if (!factory) throw new Error(`Plugin runtime is not registered: ${pluginId}`);
		const context = Object.freeze({ ...scope });
		const abort = new AbortController();
		// Start in a microtask so the activation is indexed before factory callbacks can re-enter.
		const ready = Promise.resolve().then(async () => {
			abort.signal.throwIfAborted();
			if (
				!(await authorize(
					() => this.policy.authorizeActivation({ pluginId, scope: context }, abort.signal),
					abort.signal,
				))
			) {
				throw new ActivationDeniedError(`Plugin runtime activation denied: ${pluginId}`);
			}
			abort.signal.throwIfAborted();
			return factory({ scope: context, signal: abort.signal });
		});
		const activation: Activation = {
			pluginId,
			scope: context,
			state: "activating",
			abort,
			pending: new Set(),
			ready,
		};
		this.activations.set(activationKey, activation);
		try {
			await ready;
			abort.signal.throwIfAborted();
			activation.state = "active";
			return this.client(activation);
		} catch (error) {
			// Failed activation is retryable. A concurrent deactivate still owns disposal.
			if (activation.state !== "stopping") this.activations.delete(activationKey);
			throw error;
		}
	}

	bind(pluginId: string, scope: PluginRuntimeScope): PluginRuntimeClient {
		const activation = this.activations.get(key(pluginId, scope));
		if (activation?.state !== "active") {
			throw new Error(`Plugin runtime is not active: ${pluginId}`);
		}
		return this.client(activation);
	}

	deactivate(pluginId: string, scope: PluginRuntimeScope): Promise<void> {
		const activationKey = key(pluginId, scope);
		const activation = this.activations.get(activationKey);
		if (!activation) return Promise.resolve();
		if (activation.stopping) return activation.stopping;
		activation.state = "stopping";
		activation.abort.abort(new Error(`Plugin runtime deactivated: ${pluginId}`));
		activation.stopping = this.stop(activationKey, activation);
		return activation.stopping;
	}

	private async stop(activationKey: string, activation: Activation): Promise<void> {
		const [created] = await Promise.allSettled([activation.ready]);
		// Callers retain their individual result/error. Teardown waits for cleanup even on rejection.
		await Promise.allSettled([...activation.pending]);
		if (created.status === "fulfilled") {
			await created.value.dispose();
		} else if (
			created.reason !== activation.abort.signal.reason &&
			!(created.reason instanceof ActivationDeniedError)
		) {
			throw created.reason;
		}
		this.activations.delete(activationKey);
	}

	private client(activation: Activation): PluginRuntimeClient {
		return {
			invoke: async (name, input, callerSignal) => {
				if (activation.state !== "active") {
					throw new Error(`Plugin runtime is not active: ${activation.pluginId}`);
				}
				const signal = callerSignal
					? AbortSignal.any([activation.abort.signal, callerSignal])
					: activation.abort.signal;
				const pending = this.invoke(activation, name, input, signal);
				activation.pending.add(pending);
				try {
					return await pending;
				} finally {
					activation.pending.delete(pending);
				}
			},
		};
	}

	private async invoke(
		activation: Activation,
		name: string,
		input: unknown,
		signal: AbortSignal,
	): Promise<unknown> {
		signal.throwIfAborted();
		const runtime = await activation.ready;
		const operation = Object.hasOwn(runtime.operations, name) ? runtime.operations[name] : undefined;
		if (!operation) throw new Error(`Plugin operation is not registered: ${name}`);
		if (!Check(operation.inputSchema, input)) throw new Error(`Invalid plugin operation input: ${name}`);
		const request: PluginRuntimeInvocation = {
			pluginId: activation.pluginId,
			scope: activation.scope,
			operation: name,
			effect: operation.effect,
			input,
		};
		if (!(await authorize(() => this.policy.authorizeInvocation(request, signal), signal))) {
			throw new Error(`Plugin operation denied: ${name}`);
		}
		signal.throwIfAborted();
		const result = await operation.execute(input, { scope: activation.scope, signal });
		signal.throwIfAborted();
		if (!Check(operation.resultSchema, result)) throw new Error(`Invalid plugin operation result: ${name}`);
		return result;
	}
}
