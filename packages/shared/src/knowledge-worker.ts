/** Host-neutral contract for an optional knowledge worker resource. */
export interface KnowledgeWorkerMetadata {
	/** Human-readable worker artifact version (usually a build manifest hash). */
	readonly version: string;
	/** Absolute or package-relative resource path, when the host can disclose it. */
	readonly source?: string;
	/** SHA-256 of the exact worker bytes, when available. */
	readonly integrity?: string;
}

export type KnowledgeWorkerLifecycleStage =
	| "staged"
	| "verified"
	| "enabled"
	| "disabled"
	| "drained"
	| "reloaded"
	| "rolled_back";

export interface KnowledgeWorkerLifecycleEvent {
	readonly stage: KnowledgeWorkerLifecycleStage;
	readonly version: string;
	readonly previousVersion?: string;
	readonly source?: string;
	readonly integrity?: string;
	readonly reason?: string;
	readonly pendingRequests?: number;
	readonly at: string;
}

/** Stable process event name shared by hosts and installed knowledge providers. */
export const KNOWLEDGE_WORKER_LIFECYCLE_EVENT = "drone:knowledge-worker-lifecycle/v1";
