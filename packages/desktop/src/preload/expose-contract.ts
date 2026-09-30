import type { ClientOf, DomainContract } from "@drone/shared";
import { channelOf } from "@drone/shared";
import { contextBridge, ipcRenderer } from "electron";

interface IpcRendererLike {
	invoke(channel: string, ...args: unknown[]): Promise<unknown>;
	on(channel: string, listener: (...args: unknown[]) => void): unknown;
	removeListener(channel: string, listener: (...args: unknown[]) => void): unknown;
}

interface ContextBridgeLike {
	exposeInMainWorld(key: string, api: unknown): void;
}

export interface ExposeContractOptions {
	ipc?: IpcRendererLike;
	bridge?: ContextBridgeLike;
	globalName?: string;
}

function eventClientName(name: string): string {
	return name.startsWith("on") ? name : `on${name.charAt(0).toUpperCase()}${name.slice(1)}`;
}

/**
 * Build an invoke + event client from a host contract and expose it to the
 * renderer. Every event subscription returns a listener-specific unsubscribe.
 */
export function exposeContract<TContract extends DomainContract>(
	contract: TContract,
	options: ExposeContractOptions = {},
): ClientOf<TContract> {
	const renderer = options.ipc ?? ipcRenderer;
	const api: Record<string, unknown> = {};
	for (const methodName of Object.keys(contract.methods)) {
		const channel = channelOf(contract, methodName);
		api[methodName] = (...args: unknown[]) => renderer.invoke(channel, ...args);
	}
	for (const eventName of Object.keys(contract.events)) {
		const channel = channelOf(contract, eventName);
		api[eventClientName(eventName)] = (callback: (payload: unknown) => void) => {
			const listener = (_event: unknown, payload: unknown) => callback(payload);
			renderer.on(channel, listener);
			return () => renderer.removeListener(channel, listener);
		};
	}
	const client = api as ClientOf<TContract>;
	if (options.bridge) options.bridge.exposeInMainWorld(options.globalName ?? contract.name, client);
	return client;
}

/** Convenience entry point for standalone preload modules. */
export function exposeContractInMainWorld<TContract extends DomainContract>(
	contract: TContract,
	globalName = contract.name,
): ClientOf<TContract> {
	return exposeContract(contract, { bridge: contextBridge, globalName });
}
