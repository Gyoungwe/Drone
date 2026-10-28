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
	/** Only host-registered methods are available, under the current invocation authority.
	 * `caller.scope(null)` returns the current host-resolved PluginRuntimeScope, including
	 * application scope during bootstrap. It grants no file access or retained caller authority. */
	call(name: string, input: unknown): Promise<unknown>;
}

export interface PluginRuntimeResource {
	readonly handle: string;
	readonly kind: "state" | "files";
	/** Informational; the host still checks the actual root grant on every call. Omission means read-only. */
	readonly access?: "read" | "read-write";
}

/** Description of a root already approved for this activation; not a new path grant. */
export interface PluginRuntimeRootDescription extends PluginRuntimeResource {
	readonly path: string;
	readonly access: "read" | "read-write";
}
/** Exclusive JSON state writer lease, held until successful owner and resource disposal. */
export interface PluginStateReserveInput {
	readonly root: string;
	/** Existing root-relative directory; an empty path reserves the selected root itself. */
	readonly path: string;
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

/** Actual resolved selection. A profile names an existing host model preference, never a fallback. */
export interface PluginModelSelection {
	readonly provider: string;
	readonly model: string;
	readonly thinkingLevel: string;
	readonly profile?: string;
}
export interface PluginModelSelectionInput {
	readonly profile?: string;
}
/** One isolated structured result request; no parent transcript or executable tools are inherited. */
export interface PluginModelGenerateInput {
	readonly selection: PluginModelSelection;
	readonly systemPrompt: string;
	readonly prompt: string;
	readonly resultSchema: PluginRuntimeSchema;
	readonly maxTokens: number;
}
/** Missing telemetry or unknown pricing stays null, never an invented zero/free estimate. */
export interface PluginModelUsage {
	readonly inputTokens: number | null;
	readonly outputTokens: number | null;
	readonly cost: number | null;
}
export interface PluginModelGenerateResult {
	readonly selection: PluginModelSelection;
	readonly value: unknown;
	readonly usage: PluginModelUsage;
}

/** Fresh asynchronous caller fact; never a synchronous SDK isIdle snapshot. */
export interface PluginSessionInspection {
	readonly agentActive: boolean;
}

/** Fresh configured tool facts from the actual SDK session. Unknown hints stay null. */
export interface PluginSessionTool {
	readonly name: string;
	readonly readOnlyHint: boolean | null;
}

/** Questions return ordinary interaction data; they never grant file/model permissions. */
export interface PluginSessionSelectInput {
	readonly title: string;
	readonly options: readonly string[];
}
export interface PluginSessionInputRequest {
	readonly title: string;
	readonly placeholder?: string;
}
export interface PluginSessionConfirmInput {
	readonly title: string;
	readonly message: string;
}
export interface PluginSessionQuestionCancelled {
	readonly kind: "cancelled";
}
export type PluginSessionSelectResult =
	| PluginSessionQuestionCancelled
	| { readonly kind: "selected"; readonly value: string };
export type PluginSessionInputResult =
	| PluginSessionQuestionCancelled
	| { readonly kind: "input"; readonly value: string };
export type PluginSessionConfirmResult =
	| PluginSessionQuestionCancelled
	| { readonly kind: "confirmed"; readonly value: boolean };

/** Own-source custom checkpoints only. No chat messages or cross-plugin records are exposed. */
export interface PluginSessionRecord {
	readonly id: string;
	readonly type: string;
	readonly data: unknown;
}
export interface PluginSessionRecordAppendInput {
	readonly type: string;
	readonly data: unknown;
}
/** Deferred means the SDK has not created/flushed a conversation file; it is not a saved receipt. */
export interface PluginSessionRecordAppendResult {
	readonly id: string;
	readonly durability: "durable" | "deferred";
}
export interface PluginSessionRecordReadResult {
	/** Actual SDK session storage target; a persistent lazy session may still be deferred. */
	readonly mode: "persistent" | "memory";
	readonly state: "durable" | "deferred" | "needs-reopen";
	readonly error: string | null;
	/** Latest checkpoint per logical type on the actual current branch; never silently truncated. */
	readonly records: readonly PluginSessionRecord[];
}
export interface PluginSessionNotifyInput {
	readonly content: string;
}
export interface PluginSessionNotifyResult {
	readonly durability: "durable" | "deferred";
}

/** Temporary import declarations. Supported migrator versions never prove a legacy record's creator/version. */
export interface PluginRecordAdoptionDeclaration {
	readonly legacyType: string;
	readonly fromVersions: readonly string[];
	readonly removeBeforeVersion: string;
}
export type PluginRecordAdoptions = Readonly<Record<string, PluginRecordAdoptionDeclaration>>;
export interface PluginSessionRecordAdoptionInspectionInput {
	readonly type: string;
}
export interface PluginSessionRecordAdoptionInspection {
	readonly state: "candidate" | "absent" | "already-adopted" | "deferred";
	readonly legacyType: string;
	readonly supportedFromVersions: readonly string[];
	readonly creator: "unknown";
	readonly packageVersion: "unknown";
	readonly candidate: { readonly id: string; readonly hash: string; readonly data: unknown } | null;
}
export interface PluginSessionRecordAdoptionCommitInput {
	readonly type: string;
	readonly legacyId: string;
	/** Optimistic concurrency only. This hash is not an authorization/provenance token. */
	readonly legacyHash: string;
	readonly data: unknown;
}
export interface PluginSessionRecordAdoptionCommitResult {
	readonly state: "adopted";
	readonly id: string;
	readonly durability: "durable";
	readonly legacyId: string;
	readonly legacyHash: string;
}

/** Service contracts describe JSON operations, never functions or file/model authority. */
export interface PluginServiceProvision {
	readonly version: number;
	readonly operations: readonly string[];
}
export interface PluginServiceRequirement {
	readonly service: string;
	readonly version: number;
}
export interface PluginProviderInspectionInput {
	readonly alias: string;
}
export interface PluginProviderInvocationInput extends PluginProviderInspectionInput {
	readonly operation: string;
	readonly input: unknown;
}
export interface PluginProviderInspection {
	readonly state: "available" | "absent" | "disabled" | "unavailable" | "incompatible" | "ambiguous";
	readonly service: string;
	readonly requestedVersion: number;
	readonly provider: {
		readonly pluginId: string;
		readonly version: number;
		readonly contentHash: string;
	} | null;
}

/** Optional bounded execution capabilities; importing this contract never loads Node. */
export interface PluginExecutionInput {
	readonly requestId: string;
	readonly language: "python" | "r";
	readonly code: string;
	readonly runDirectory: string;
	/** Exact already-cached image identity; mutable tags are not execution authority. */
	readonly image: string;
	readonly timeoutMs: number;
	readonly maxOutputBytes: number;
	readonly dataClassification: "public" | "internal" | "controlled" | "restricted";
}
export interface PluginExecutionDescription {
	readonly kind: "container" | "unavailable";
	readonly images: Readonly<Partial<Record<"python" | "r", string>>>;
	readonly networkDisabled: true;
	readonly writesOnlyToRunDirectory: true;
}
export interface PluginExecutionReceipt {
	readonly id: string;
	readonly requestId: string;
	readonly language: "python" | "r";
	readonly codeSha256: string;
	readonly runDirectory: string;
	readonly image: string;
	readonly status: "accepted" | "succeeded" | "failed" | "cancelled" | "cleanup-failed";
	readonly acceptedAt: string;
	readonly finishedAt?: string;
	readonly exitCode?: number;
	readonly durationMs?: number;
	readonly producedBytes?: number;
}
export type PluginExecutionReceiptResult =
	| { readonly kind: "missing" }
	| { readonly kind: "value"; readonly receipt: PluginExecutionReceipt };
export interface PluginExecutionResult {
	readonly receipt: PluginExecutionReceipt;
	readonly result: {
		readonly exitCode: number;
		readonly durationMs: number;
		readonly producedBytes: number;
		readonly outputs: readonly {
			readonly text: string;
			readonly contentKind: "summary" | "plot" | "table" | "raw";
			readonly classification: "public" | "internal" | "controlled" | "restricted";
		}[];
	};
}
