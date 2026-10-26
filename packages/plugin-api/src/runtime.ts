/** JSON-compatible operations use null for a void result; no Pi or renderer dependency. */
export type PluginRuntimeSchema = object;

/** Host-resolved per-call scope. workspaceId is opaque identity, never a filesystem path.
 * workspaceDirectory preserves the actual session directory; it grants no filesystem access by itself.
 * A window without a selected session is explicitly application-scoped. */
export type PluginRuntimeScope =
	| { readonly kind: "application" }
	| { readonly kind: "workspace"; readonly workspaceId: string; readonly workspaceDirectory: string }
	| {
			readonly kind: "session";
			readonly workspaceId: string;
			readonly workspaceDirectory: string;
			readonly sessionId: string;
	  };

export interface PluginRuntimeChangedEvent {
	readonly type: "changed";
	readonly revision: number;
}

/** One domain owner per application activation, shared by its caller scopes. */
export interface PluginRuntimeCapabilities {
	/** Only host-registered methods are available, under the current invocation authority. */
	call(name: string, input: unknown): Promise<unknown>;
}

export interface PluginRuntimeResource {
	readonly handle: string;
	readonly kind: "state" | "files";
	/** Informational; the host still checks the actual root grant on every call. Omission means read-only. */
	readonly access?: "read" | "read-write";
}

/** Stops this activation's resource children, with no new file/model/caller authority.
 * Resolves after accepted resource work settles and real child processes exit.
 * Writer reservations stay held until the domain owner has also finished disposal. */
export interface PluginResourcesLifecycle {
	dispose(): Promise<void>;
}

export interface PluginRuntimeFactoryContext {
	readonly applicationId: string;
	readonly signal: AbortSignal;
	/** Present only when this activation owns a resource provider. Owner shutdown only. */
	readonly resourcesLifecycle?: PluginResourcesLifecycle;
	readonly resources: readonly PluginRuntimeResource[];
	readonly capabilities: PluginRuntimeCapabilities;
	/** Invalidate derived UI reads without transmitting domain data. Host assigns the revision. */
	readonly events: { changed(): void };
}

export interface PluginRuntimeContext {
	readonly capabilities: PluginRuntimeCapabilities;
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

export interface PluginRuntimeInstance<TNative = never> {
	readonly operations: Readonly<Record<string, PluginRuntimeOperation>>;
	/** Optional native Pi projection of this same owner, never a second domain instance. */
	createNativeSession?(): TNative | Promise<TNative>;
	/** Release the application's resources after outstanding calls have settled. */
	dispose(): Promise<void>;
}

/**
 * Optional Drone adapter using the native entry's domain implementation.
 * This contract first ships in the unpublished 1.3 candidate; factory scope is
 * application-owned, while operation context is resolved separately for every call.
 * A factory that fails before returning releases resources it acquired itself.
 */
export type PluginRuntimeFactory<TNative = never> = (
	context: PluginRuntimeFactoryContext,
) => Promise<PluginRuntimeInstance<TNative>>;

/** Bound by the host after trust, caller identity and scope resolution. */
export interface PluginRuntimeClient {
	invoke(operation: string, input: unknown, signal?: AbortSignal): Promise<unknown>;
	subscribe(listener: (event: PluginRuntimeChangedEvent) => void): () => void;
}

/** Version tokens describe raw stored JSON bytes, never a domain schema/revision field. */
export type PluginStateReadResult =
	| { readonly kind: "missing"; readonly version: null }
	| { readonly kind: "value"; readonly value: unknown; readonly version: string };
export interface PluginStateWriteInput {
	readonly root: string;
	readonly path: string;
	readonly value: unknown;
	/** null creates only a missing file. Existing files require the readJson SHA-256 token. */
	readonly expectedVersion: string | null;
}
/** Remove only a stored JSON document whose current bytes match a prior read. */
export interface PluginStateRemoveInput {
	readonly root: string;
	readonly path: string;
	readonly expectedVersion: string;
}
export interface PluginStateListEntry {
	readonly name: string;
	readonly kind: "file" | "directory" | "symlink" | "other";
}
