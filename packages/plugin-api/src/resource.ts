import type { PluginRuntimeCapabilities } from "./runtime";

export interface PluginResourceInvocationContext {
	/** Actual request signal; distinct from the factory resource lifetime. */
	readonly signal: AbortSignal;
}

/** Optional isolated resource in the same package, such as a local index. */
export interface PluginResourceFactoryContext {
	readonly parameters: unknown;
	/** Host-selected private cache directory; this is the resource's only filesystem write grant. */
	readonly storageDirectory: string;
	readonly signal: AbortSignal;
	readonly capabilities: PluginRuntimeCapabilities;
	readonly events: { changed(): void };
}

export interface PluginResourceInstance {
	/** Request and response payloads are the owning plugin's contract. */
	invoke(operation: string, input: unknown, context?: PluginResourceInvocationContext): Promise<unknown>;
	dispose(): Promise<void>;
}

export type PluginResourceFactory = (
	context: PluginResourceFactoryContext,
) => Promise<PluginResourceInstance>;
