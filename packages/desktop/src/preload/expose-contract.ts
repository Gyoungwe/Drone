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
	/** Override a channel during incremental migrations that preserve legacy names. */
	channelForMethod?: (contract: DomainContract, method: string) => string;
}

/**
 * main 的 bindContract 在参数 / 结果未通过 schema 时 resolve 一个错误信封（不是 reject）。
 * 在这里统一转成 reject：调用方的 try/catch 才能拦住，界面不会把它当成功（PITFALLS 四）。
 */
export function isHostApiValidationEnvelope(value: unknown): value is { code: string; detail: string } {
	if (!value || typeof value !== "object") return false;
	const record = value as Record<string, unknown>;
	return (
		(record.code === "invalid_arguments" || record.code === "invalid_result") &&
		record.source === "app" &&
		typeof record.titleKey === "string" &&
		record.titleKey.startsWith("error.title.") &&
		typeof record.detail === "string"
	);
}

export class HostApiValidationFailure extends Error {
	readonly code: string;
	constructor(envelope: { code: string; detail: string }) {
		super(envelope.detail);
		this.name = "HostApiValidationFailure";
		this.code = envelope.code;
	}
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
		const channel = options.channelForMethod?.(contract, methodName) ?? channelOf(contract, methodName);
		api[methodName] = async (...args: unknown[]) => {
			const result = await renderer.invoke(channel, ...args);
			if (isHostApiValidationEnvelope(result)) throw new HostApiValidationFailure(result);
			return result;
		};
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
