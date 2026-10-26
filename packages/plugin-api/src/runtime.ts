/** JSON-compatible operations use null for a void result; no Pi or renderer dependency. */
export type PluginRuntimeSchema = object;

/** Host-resolved per-call scope. A window without a selected session is explicitly application-scoped. */
export type PluginRuntimeScope =
	| { readonly kind: "application" }
	| { readonly kind: "workspace"; readonly workspaceId: string }
	| { readonly kind: "session"; readonly workspaceId: string; readonly sessionId: string };

/** One domain owner per application activation, shared by its caller scopes. */
export interface PluginRuntimeFactoryContext {
	readonly applicationId: string;
	readonly signal: AbortSignal;
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
	/** Release the application's resources after outstanding calls have settled. */
	dispose(): Promise<void>;
}

/**
 * Optional Drone adapter using the native entry's domain implementation.
 * This contract first ships in the unpublished 1.3 candidate; factory scope is
 * application-owned, while operation context is resolved separately for every call.
 * A factory that fails before returning releases resources it acquired itself.
 */
export type PluginRuntimeFactory = (context: PluginRuntimeFactoryContext) => Promise<PluginRuntimeInstance>;

/** Bound by the host after trust, caller identity and scope resolution. */
export interface PluginRuntimeClient {
	invoke(operation: string, input: unknown, signal?: AbortSignal): Promise<unknown>;
}
