import { randomUUID } from "node:crypto";
import { PluginRuntimeRegistry } from "@drone/backend";
import type { PluginRuntimeClient, PluginRuntimeFactory } from "@gyoungwe/plugin-api/runtime";

export interface DesktopRuntimeSource {
	readonly pluginId: string;
	readonly packageRoot: string;
	readonly entrypoint: string;
}

export interface DesktopRuntimeOwner {
	readonly id: number;
	isDestroyed(): boolean;
}

export interface DesktopRuntimeBridgeOptions {
	source(name: string): DesktopRuntimeSource | undefined;
	enabled(name: string): boolean;
	factory(source: DesktopRuntimeSource): PluginRuntimeFactory;
	approve(owner: DesktopRuntimeOwner, source: DesktopRuntimeSource, operation?: string): Promise<boolean>;
}

interface Binding {
	readonly token: string;
	readonly name: string;
	readonly owner: DesktopRuntimeOwner;
	readonly source: DesktopRuntimeSource;
	readonly registry: PluginRuntimeRegistry;
	readonly scope: { workspaceId: string };
	readonly ready: Promise<PluginRuntimeClient>;
}

function sameSource(a: DesktopRuntimeSource, b: DesktopRuntimeSource | undefined): boolean {
	return a.pluginId === b?.pluginId && a.packageRoot === b.packageRoot && a.entrypoint === b.entrypoint;
}

/** Per-window capabilities. Tokens convey provenance, not isolation within a shared trusted renderer. */
export class DesktopRuntimeBridge {
	private transitioning = false;
	private closing = false;
	private transition: Promise<unknown> | undefined;
	private readonly bindings = new Map<string, Binding>();
	private readonly stopping = new Map<string, { name: string; ownerId: number; promise: Promise<void> }>();
	private readonly requests = new Map<string, { name: string; ownerId: number; token: string }>();

	constructor(private readonly options: DesktopRuntimeBridgeOptions) {}

	async bind(name: string, owner: DesktopRuntimeOwner): Promise<string | undefined> {
		if (this.closing || this.transitioning) throw new Error("Plugin runtime unavailable");
		const source = this.options.source(name);
		if (!source) return undefined;
		if (!this.options.enabled(name) || owner.isDestroyed()) throw new Error("Plugin runtime unavailable");
		// A reloaded module gets a fresh generation; its previous closure cannot become active again.
		const stopping = this.revoke(name, owner.id);
		const token = randomUUID();
		const key = JSON.stringify([name, owner.id]);
		this.requests.set(key, { name, ownerId: owner.id, token });
		await stopping;
		if (this.requests.get(key)?.token !== token) throw new Error("Plugin runtime load superseded");
		const scope = { workspaceId: `desktop-window:${owner.id}` };
		const allowed = () =>
			!this.closing &&
			!this.transitioning &&
			this.bindings.has(token) &&
			!owner.isDestroyed() &&
			this.options.enabled(name) &&
			sameSource(source, this.options.source(name));
		const registry = new PluginRuntimeRegistry({
			authorizeActivation: async (_request, signal) => {
				if (!allowed()) return false;
				const approved = await this.options.approve(owner, source);
				return approved && !signal.aborted && allowed();
			},
			authorizeInvocation: async (request, signal) => {
				if (!allowed()) return false;
				if (request.effect === "read") return true;
				const approved = await this.options.approve(owner, source, request.operation);
				return approved && !signal.aborted && allowed();
			},
		});
		registry.register(source.pluginId, this.options.factory(source));
		const ready = registry.activate(source.pluginId, scope);
		const binding: Binding = { token, name, owner, source, registry, scope, ready };
		this.bindings.set(token, binding);
		try {
			await ready;
			if (!allowed()) throw new Error("Plugin runtime binding revoked");
			return token;
		} catch (error) {
			await this.stopBinding(binding);
			throw error;
		}
	}

	async invoke(
		owner: DesktopRuntimeOwner,
		token: string,
		operation: string,
		input: unknown,
	): Promise<unknown> {
		const binding = this.bindings.get(token);
		if (!binding || binding.owner !== owner || owner.isDestroyed()) {
			throw new Error("Plugin runtime binding is invalid for this window");
		}
		if (
			!this.options.enabled(binding.name) ||
			!sameSource(binding.source, this.options.source(binding.name))
		) {
			await this.revoke(binding.name);
			throw new Error("Plugin runtime source is no longer enabled");
		}
		return (await binding.ready).invoke(operation, input);
	}

	/** Drain runtime work before changing the configuration or installed package bytes. */
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

	/** Closing is permanent, including when disposal fails and must be reported to the user. */
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

	/** Revoke synchronously before awaiting outstanding work/disposal. */
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
		this.bindings.delete(binding.token);
		const key = JSON.stringify([binding.name, binding.owner.id]);
		const existing = this.stopping.get(key);
		if (existing) return existing.promise;
		const promise = binding.registry.deactivate(binding.source.pluginId, binding.scope).then(() => {
			this.stopping.delete(key);
		});
		// Failed disposal deliberately stays indexed: replacement cannot overlap an unconfirmed teardown.
		this.stopping.set(key, { name: binding.name, ownerId: binding.owner.id, promise });
		return promise;
	}
}
