/** JSON-compatible operations use null for a void result. JSON-schema declarations for optional desktop operations; no Pi or renderer dependency. */
export type PluginRuntimeSchema = object;

/** Scope is resolved by the host, never taken from an operation's renderer payload. */
export interface PluginRuntimeScope {
	readonly workspaceId: string;
	readonly sessionId?: string;
}

export interface PluginRuntimeContext {
	readonly scope: PluginRuntimeScope;
	readonly signal: AbortSignal;
}

/** Read operations still pass the host's access policy; writes additionally need approval. */
export interface PluginRuntimeOperation {
	readonly inputSchema: PluginRuntimeSchema;
	readonly resultSchema: PluginRuntimeSchema;
	readonly effect: "read" | "write";
	execute(input: unknown, context: PluginRuntimeContext): Promise<unknown>;
}

export interface PluginRuntimeInstance {
	readonly operations: Readonly<Record<string, PluginRuntimeOperation>>;
	/** Release this scope's resources after its outstanding calls have settled. */
	dispose(): Promise<void>;
}

/**
 * An optional Drone adapter using the same domain implementation as the Pi entry.
 * A factory that fails before returning must release resources it acquired itself.
 */
export type PluginRuntimeFactory = (context: PluginRuntimeContext) => Promise<PluginRuntimeInstance>;

/** Bound by the host after trust, caller identity and scope resolution. */
export interface PluginRuntimeClient {
	invoke(operation: string, input: unknown, signal?: AbortSignal): Promise<unknown>;
}
