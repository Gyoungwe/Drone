import { join } from "node:path";
import {
	type ArtifactLocation,
	type ArtifactPurpose,
	type ArtifactRecord,
	type ArtifactSource,
	type ArtifactStatus,
	type AttemptOutcome,
	type AttemptRecord,
	InquiryService as DomainInquiryService,
	type InquiryStorage,
	SqliteInquiryStorage,
} from "@drone/inquiry";

/** Metadata accepted from a trusted host event after it has verified the file. */
export interface InquiryEventArtifact {
	readonly id?: string;
	readonly path: string;
	readonly bytes?: number;
	/** `size` is accepted for runner manifests that use that spelling. */
	readonly size?: number;
	readonly sha256?: string;
	readonly location?: ArtifactLocation;
	readonly purpose?: ArtifactPurpose;
	readonly status?: ArtifactStatus;
	readonly parentIds?: readonly string[];
	readonly runId?: string;
	readonly sourceKind?: ArtifactSource["kind"];
	readonly sourceId?: string;
}

export interface InquiryEventManifest {
	readonly entries?: readonly InquiryEventArtifact[];
}

/** Structural compute event contract; no compute package is imported here. */
export interface InquiryComputeEvent {
	readonly id: string;
	readonly jobId: string;
	readonly type: "created" | "submitted" | "status" | "logs" | "collected" | "cancelled" | "error";
	readonly at: number | string;
	readonly status?: string;
	readonly cursor?: string;
	readonly detail?: string;
	readonly runId?: string;
	readonly startedAt?: number | string;
	readonly codeFingerprint?: string;
	readonly artifacts?: readonly InquiryEventArtifact[];
	readonly manifest?: InquiryEventManifest;
	readonly projectId?: string;
}

/** Terminal task projection supplied by the task/workflow host. */
export interface InquiryTaskTerminalEvent {
	readonly id: string;
	readonly taskId: string;
	readonly runId?: string;
	readonly status: "succeeded" | "failed" | "cancelled" | "blocked" | "partial" | "unknown";
	readonly at?: number | string;
	readonly startedAt?: number | string;
	readonly detail?: string;
	readonly codeFingerprint?: string;
	readonly artifacts?: readonly InquiryEventArtifact[];
	readonly manifest?: InquiryEventManifest;
	readonly projectId?: string;
}

/** Host callbacks keep the domain package independent from compute/tasks. */
export interface InquiryEventSource {
	readonly onComputeEvent?: (handler: (event: InquiryComputeEvent) => void) => () => void;
	readonly onTaskTerminal?: (handler: (event: InquiryTaskTerminalEvent) => void) => () => void;
}

export type InquiryReadOnlySnapshot = Awaited<ReturnType<DomainInquiryService["readOnlyState"]>> & {
	readonly attempts: readonly AttemptRecord[];
};

/** Backend composition-root adapter for the host-injected inquiry domain. */
export interface InquiryServiceOptions {
	/** Directory registered as `inquiry-root`; the SQLite file is created inside it. */
	readonly inquiryDir?: string;
	/** Stable project identity. Callers should supply a project id when multiple projects share a host. */
	readonly projectId?: string;
	/** Optional host subscriptions. Callbacks are serialized before touching the ledger. */
	readonly eventSource?: InquiryEventSource;
	/** Event failures are reported here while the host event stream continues. */
	readonly onEventError?: (error: unknown) => void;
}

export interface InquiryServicePort {
	readonly enabled: boolean;
	readonly storage?: InquiryStorage;
	readonly domain?: DomainInquiryService;
	recordComputeEvent(event: InquiryComputeEvent): Promise<void>;
	recordTaskTerminal(event: InquiryTaskTerminalEvent): Promise<void>;
	readOnlySnapshot(): Promise<InquiryReadOnlySnapshot | undefined>;
	drainEvents(): Promise<void>;
	attachEventSource(source: InquiryEventSource): () => void;
	dispose(): void;
}

const TERMINAL_COMPUTE_STATUSES = new Set(["succeeded", "failed", "cancelled", "blocked", "partial"]);
const TERMINAL_TASK_STATUSES = new Set(["succeeded", "failed", "cancelled", "blocked", "partial", "unknown"]);
const SHA256 = /^[a-f0-9]{64}$/i;

function asIso(value: number | string | undefined): string {
	if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString();
	if (typeof value === "string" && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
	return new Date().toISOString();
}

function outcomeFor(status: string | undefined, eventType?: InquiryComputeEvent["type"]): AttemptOutcome {
	if (eventType === "error" || status === "failed") return "failed";
	if (eventType === "collected" || status === "succeeded") return "succeeded";
	if (eventType === "cancelled") return "blocked";
	if (status === "cancelled" || status === "blocked") return "blocked";
	return "unknown";
}

function nonEmpty(value: string | undefined): string | undefined {
	const normalized = value?.trim();
	return normalized || undefined;
}

function summary(value: string | undefined): string | undefined {
	return nonEmpty(value);
}

/**
 * No UI, compute or remote side effects are performed here. When no inquiry
 * root is configured the service stays disabled and does not touch the disk.
 */
export class InquiryService implements InquiryServicePort {
	readonly enabled: boolean;
	readonly storage?: SqliteInquiryStorage;
	readonly domain?: DomainInquiryService;
	private readonly unsubscribers: Array<() => void> = [];
	private readonly onEventError?: (error: unknown) => void;
	private eventTail: Promise<void> = Promise.resolve();
	private disposed = false;

	constructor(options: InquiryServiceOptions = {}) {
		this.onEventError = options.onEventError;
		if (!options.inquiryDir) {
			this.enabled = false;
			return;
		}
		const projectId = options.projectId?.trim();
		if (!projectId) throw new Error("inquiryProjectId is required when inquiryDir is configured");
		this.storage = new SqliteInquiryStorage(projectId, join(options.inquiryDir, "ledger.sqlite"));
		this.domain = new DomainInquiryService(this.storage);
		this.enabled = true;
		if (options.eventSource) this.attachEventSource(options.eventSource);
	}

	/** Subscribe to host event streams without importing task or compute services. */
	attachEventSource(source: InquiryEventSource): () => void {
		if (!this.enabled || this.disposed) return () => {};
		const attached: Array<() => void> = [];
		if (source.onComputeEvent) {
			attached.push(
				source.onComputeEvent((event) => {
					this.enqueue(() => this.recordComputeEvent(event));
				}),
			);
		}
		if (source.onTaskTerminal) {
			attached.push(
				source.onTaskTerminal((event) => {
					this.enqueue(() => this.recordTaskTerminal(event));
				}),
			);
		}
		const unsubscribe = () => {
			for (const detach of attached.splice(0)) detach();
			const index = this.unsubscribers.indexOf(unsubscribe);
			if (index >= 0) this.unsubscribers.splice(index, 1);
		};
		this.unsubscribers.push(unsubscribe);
		return unsubscribe;
	}

	/** Record a terminal/collection compute event. Non-terminal progress is ignored. */
	async recordComputeEvent(event: InquiryComputeEvent): Promise<void> {
		if (!this.domain || !this.storage) return;
		if (
			event.type !== "collected" &&
			event.type !== "cancelled" &&
			event.type !== "error" &&
			!TERMINAL_COMPUTE_STATUSES.has(event.status ?? "")
		)
			return;
		this.assertProject(event.projectId);
		const executionId = nonEmpty(event.runId) ?? event.jobId;
		const eventAt = asIso(event.at);
		const artifactIds = await this.recordArtifacts(
			"run",
			executionId,
			event.artifacts ?? event.manifest?.entries,
			eventAt,
			event.status === "succeeded" || event.type === "collected" ? "deliverable" : "intermediate",
			"remote",
			event.runId ?? event.jobId,
		);
		const attempt: AttemptRecord = {
			id: `compute:${executionId}`,
			schemaVersion: 1,
			projectId: this.storage.projectId,
			hypothesisIds: [],
			parameters: {
				source: "compute",
				jobId: event.jobId,
				...(event.runId ? { runId: event.runId } : {}),
				eventType: event.type,
				status: event.status ?? null,
			},
			artifactIds,
			...(summary(event.detail) ? { resultSummary: summary(event.detail) } : {}),
			outcome: outcomeFor(event.status, event.type),
			enteredReport: false,
			startedAt: asIso(event.startedAt ?? event.at),
			finishedAt: eventAt,
			...(event.codeFingerprint ? { codeFingerprint: event.codeFingerprint } : {}),
		};
		await this.domain.recordAttempt(attempt);
	}

	/** Record a terminal task/workflow event and its verified artifact metadata. */
	async recordTaskTerminal(event: InquiryTaskTerminalEvent): Promise<void> {
		if (!this.domain || !this.storage) return;
		if (!TERMINAL_TASK_STATUSES.has(event.status)) return;
		this.assertProject(event.projectId);
		const executionId = nonEmpty(event.runId) ?? event.taskId;
		const eventAt = asIso(event.at);
		const artifactIds = await this.recordArtifacts(
			"task",
			executionId,
			event.artifacts ?? event.manifest?.entries,
			eventAt,
			event.status === "succeeded" ? "deliverable" : "intermediate",
			"local",
			event.runId ?? event.taskId,
		);
		const attempt: AttemptRecord = {
			id: `task:${executionId}`,
			schemaVersion: 1,
			projectId: this.storage.projectId,
			hypothesisIds: [],
			parameters: {
				source: "task",
				taskId: event.taskId,
				...(event.runId ? { runId: event.runId } : {}),
				status: event.status,
			},
			artifactIds,
			...(summary(event.detail) ? { resultSummary: summary(event.detail) } : {}),
			outcome: outcomeFor(event.status),
			enteredReport: false,
			startedAt: asIso(event.startedAt ?? event.at),
			finishedAt: eventAt,
			...(event.codeFingerprint ? { codeFingerprint: event.codeFingerprint } : {}),
		};
		await this.domain.recordAttempt(attempt);
	}

	/** Return the project projection only; no ledger mutation or file access occurs beyond the read. */
	async readOnlySnapshot(): Promise<InquiryReadOnlySnapshot | undefined> {
		if (!this.domain) return undefined;
		const [state, snapshot] = await Promise.all([this.domain.readOnlyState(), this.domain.snapshot()]);
		return { ...state, attempts: snapshot.attempts };
	}

	/** Wait until all host events observed so far have finished writing. */
	async drainEvents(): Promise<void> {
		await this.eventTail;
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		for (const unsubscribe of [...this.unsubscribers]) unsubscribe();
		if (this.storage) void this.storage.close();
	}

	private enqueue(work: () => Promise<void>): void {
		if (this.disposed) return;
		const task = this.eventTail.then(work);
		this.eventTail = task.catch((error) => {
			try {
				this.onEventError?.(error);
			} catch {
				// Event diagnostics must not interrupt the host stream.
			}
		});
	}

	private assertProject(projectId: string | undefined): void {
		if (projectId && projectId !== this.storage?.projectId)
			throw new Error(`Inquiry event belongs to another project: ${projectId}`);
	}

	private async recordArtifacts(
		kind: "run" | "task",
		executionId: string,
		entries: readonly InquiryEventArtifact[] | undefined,
		eventAt: string,
		defaultPurpose: ArtifactPurpose,
		defaultLocation: ArtifactLocation,
		defaultRunId: string,
	): Promise<string[]> {
		if (!this.domain || !this.storage || !entries?.length) return [];
		const artifactIds: string[] = [];
		for (const entry of entries) {
			const record = this.artifactRecord(
				kind,
				executionId,
				entry,
				eventAt,
				defaultPurpose,
				defaultLocation,
				defaultRunId,
			);
			if (!record) continue;
			await this.domain.recordArtifact(record);
			artifactIds.push(record.id);
		}
		return artifactIds;
	}

	private artifactRecord(
		kind: "run" | "task",
		executionId: string,
		entry: InquiryEventArtifact,
		eventAt: string,
		defaultPurpose: ArtifactPurpose,
		defaultLocation: ArtifactLocation,
		defaultRunId: string,
	): ArtifactRecord | undefined {
		const bytes = entry.bytes ?? entry.size;
		const sha256 = entry.sha256?.trim();
		if (
			typeof entry.path !== "string" ||
			!entry.path.trim() ||
			!Number.isSafeInteger(bytes) ||
			(bytes as number) < 0 ||
			!sha256 ||
			!SHA256.test(sha256)
		)
			return undefined;
		const id =
			nonEmpty(entry.id) ??
			`${kind}:${executionId}:${entry.path.replaceAll("\\", "/")}:${sha256.toLowerCase()}`;
		return {
			id,
			schemaVersion: 1,
			projectId: this.storage?.projectId ?? "",
			location: entry.location ?? defaultLocation,
			path: entry.path,
			bytes: bytes as number,
			sha256,
			source: {
				kind: entry.sourceKind ?? kind,
				id: nonEmpty(entry.sourceId) ?? executionId,
			},
			purpose: entry.purpose ?? defaultPurpose,
			status: entry.status ?? "valid",
			parentIds: [...new Set(entry.parentIds ?? [])],
			runId: nonEmpty(entry.runId) ?? defaultRunId,
			createdAt: eventAt,
			updatedAt: eventAt,
		};
	}
}
