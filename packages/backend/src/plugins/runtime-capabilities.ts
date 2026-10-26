import { AsyncLocalStorage } from "node:async_hooks";
import type {
	PluginResourcesLifecycle,
	PluginRuntimeCapabilities,
	PluginRuntimeResource,
	PluginRuntimeSchema,
	PluginRuntimeScope,
} from "@gyoungwe/plugin-api/runtime";
import { Check } from "typebox/value";

export interface PluginCapabilityContext {
	readonly pluginId: string;
	readonly applicationId: string;
	readonly scope: PluginRuntimeScope;
	readonly callerIdentity: object | undefined;
	readonly signal: AbortSignal;
	readonly bootstrap: boolean;
	/** This call only; resource children must receive a fresh port for every subsequent invocation. */
	readonly capabilities: PluginRuntimeCapabilities;
}
export interface PluginCapabilityHandler {
	readonly inputSchema: PluginRuntimeSchema;
	readonly resultSchema: PluginRuntimeSchema;
	readonly effect: "read" | "write";
	/** Only pre-approved application state reads may run while constructing an owner. */
	readonly bootstrap?: true;
	/** Host-owned formatter, called only after capability input schema validation. */
	approvalDetail?(input: unknown): string;
	execute(input: unknown, context: PluginCapabilityContext): Promise<unknown>;
}
export interface PluginRuntimeCapabilitiesOptions {
	readonly handlers: Readonly<Record<string, PluginCapabilityHandler>>;
	readonly resources: readonly PluginRuntimeResource[];
	readonly resourcesLifecycle?: PluginResourcesLifecycle;
	dispose?(): Promise<void>;
}
interface Authority {
	readonly context: PluginCapabilityContext;
	readonly effect: "read" | "write";
	readonly authorize: (
		name: string,
		input: unknown,
		effect: "read" | "write",
		detail?: string,
	) => Promise<boolean>;
	readonly check: () => void;
	readonly pending: Set<Promise<unknown>>;
	closed: boolean;
}

/** Factory-held ports borrow the current call's authority; retaining a port never retains a caller. */
export class PluginCapabilityBroker {
	private readonly calls = new AsyncLocalStorage<Authority>();
	readonly port: PluginRuntimeCapabilities = {
		call: (name, input) => {
			const authority = this.calls.getStore();
			if (!authority || authority.closed)
				return Promise.reject(new Error("Plugin capability has no live caller"));
			return this.trackedCall(authority, name, input);
		},
	};

	constructor(private readonly options: PluginRuntimeCapabilitiesOptions) {}

	async run<T>(
		context: Omit<PluginCapabilityContext, "capabilities">,
		effect: "read" | "write",
		check: () => void,
		authorize: Authority["authorize"],
		execute: () => Promise<T>,
	): Promise<T> {
		const authority: Authority = {
			context: {
				...context,
				capabilities: { call: (name, input) => this.trackedCall(authority, name, input) },
			},
			effect,
			check,
			authorize,
			pending: new Set(),
			closed: false,
		};
		const [execution] = await Promise.allSettled([this.calls.run(authority, execute)]);
		authority.closed = true;
		// Calls still pending at outer completion are drained and their failures join this receipt.
		// Settled errors remain on their own promises: plugins must await calls and may recover explicitly.
		// Promise/IPC transport cannot infer whether the plugin observed every earlier rejection.
		const pending = await Promise.allSettled([...authority.pending]);
		const failures = [execution, ...pending].filter((result) => result.status === "rejected");
		if (failures.length === 1) throw failures[0]?.reason;
		if (failures.length > 1)
			throw new AggregateError(
				failures.map((result) => result.reason),
				"Plugin operation and capability cleanup failed",
			);
		if (execution.status === "rejected") throw execution.reason;
		return execution.value;
	}

	private trackedCall(authority: Authority, name: string, input: unknown): Promise<unknown> {
		const pending = this.call(authority, name, input);
		authority.pending.add(pending);
		void pending.then(
			() => authority.pending.delete(pending),
			() => authority.pending.delete(pending),
		);
		return pending;
	}

	private async call(authority: Authority, name: string, input: unknown): Promise<unknown> {
		const check = () => {
			if (authority.closed) throw new Error("Plugin capability caller completed");
			authority.context.signal.throwIfAborted();
			authority.check();
		};
		check();
		const handler = Object.hasOwn(this.options.handlers, name) ? this.options.handlers[name] : undefined;
		if (!handler) throw new Error(`Plugin capability is not registered: ${name}`);
		if (!Check(handler.inputSchema, input)) throw new Error(`Invalid plugin capability input: ${name}`);
		if (handler.effect === "write" && authority.effect !== "write")
			throw new Error(`Read-only plugin invocation cannot use write capability: ${name}`);
		if (authority.context.bootstrap) {
			if (!handler.bootstrap || handler.effect !== "read")
				throw new Error(`Plugin capability is unavailable during bootstrap: ${name}`);
		} else if (!(await authority.authorize(name, input, handler.effect, handler.approvalDetail?.(input)))) {
			throw new Error(`Plugin capability denied: ${name}`);
		}
		check();
		const result = await handler.execute(input, authority.context);
		check();
		if (!Check(handler.resultSchema, result)) throw new Error(`Invalid plugin capability result: ${name}`);
		return result;
	}
}

export type PluginRuntimeCapabilitiesProvider = (activation: {
	pluginId: string;
	applicationId: string;
	signal: AbortSignal;
	events: { changed(): void };
}) => PluginRuntimeCapabilitiesOptions | Promise<PluginRuntimeCapabilitiesOptions>;
