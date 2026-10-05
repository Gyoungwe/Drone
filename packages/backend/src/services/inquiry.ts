import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
	type ArtifactLocation,
	type ArtifactProvenance,
	type ArtifactPurpose,
	type ArtifactRecord,
	type ArtifactRerunRecord,
	type ArtifactRerunResult,
	type ArtifactSource,
	type ArtifactStatus,
	type AttemptOutcome,
	type AttemptRecord,
	type DecisionKind,
	type DecisionRecord,
	InquiryService as DomainInquiryService,
	type InquiryStorage,
	type RunProvenanceSummary,
	SqliteInquiryStorage,
} from "@drone/inquiry";
import type { StorageRegistry } from "../storage/registry";

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
	readonly parameters?: Readonly<Record<string, string | number | boolean | null>>;
	readonly hostId?: string;
	readonly sessionId?: string;
	readonly turn?: number;
	readonly runProvenance?: RunProvenanceSummary;
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
	readonly parameters?: Readonly<Record<string, string | number | boolean | null>>;
	readonly sessionId?: string;
	readonly turn?: number;
	readonly runProvenance?: RunProvenanceSummary;
	readonly artifacts?: readonly InquiryEventArtifact[];
	readonly manifest?: InquiryEventManifest;
	readonly projectId?: string;
}

/** Host callbacks keep the domain package independent from compute/tasks. */
export interface InquiryEventSource {
	readonly onComputeEvent?: (handler: (event: InquiryComputeEvent) => void) => () => void;
	readonly onTaskTerminal?: (handler: (event: InquiryTaskTerminalEvent) => void) => () => void;
	readonly onDecision?: (handler: (event: InquiryDecisionEvent) => void) => () => void;
	readonly enrichComputeEvent?: (event: InquiryComputeEvent) => Promise<InquiryComputeEvent>;
}

/** Successful host receipt for an agent-made decision. */
export interface InquiryDecisionEvent {
	readonly id: string;
	readonly kind: DecisionKind;
	readonly summary: string;
	readonly basis?: readonly string[];
	readonly affectedArtifactIds?: readonly string[];
	readonly at?: number | string;
	readonly projectId?: string;
}

export type InquiryReadOnlySnapshot = Awaited<ReturnType<DomainInquiryService["readOnlyState"]>> & {
	readonly attempts: readonly AttemptRecord[];
};

/** Backend composition-root adapter for the host-injected inquiry domain. */
export interface InquiryServiceOptions {
	/** Directory registered as `inquiry-root`; the SQLite file is created inside it. */
	readonly inquiryDir?: string;
	/** Desktop host root for lazy, independently isolated project ledgers. */
	readonly projectsDir?: string;
	readonly storageRegistry?: StorageRegistry;
	/** Stable project identity. Callers should supply a project id when multiple projects share a host. */
	readonly projectId?: string;
	/** Optional host subscriptions. Callbacks are serialized before touching the ledger. */
	readonly eventSource?: InquiryEventSource;
	/** Event failures are reported here while the host event stream continues. */
	readonly onEventError?: (error: unknown) => void;
	readonly rerunHandler?: (
		provenance: ArtifactProvenance,
	) => Promise<{ readonly jobId: string } | ArtifactRecord>;
}

export type InquiryRerunHandler = (
	provenance: ArtifactProvenance,
) => Promise<{ readonly jobId: string } | ArtifactRecord>;

export interface InquiryServicePort {
	readonly enabled: boolean;
	readonly storage?: InquiryStorage;
	readonly domain?: DomainInquiryService;
	recordComputeEvent(event: InquiryComputeEvent): Promise<void>;
	recordTaskTerminal(event: InquiryTaskTerminalEvent): Promise<void>;
	recordDecision(event: InquiryDecisionEvent | DecisionRecord): Promise<void>;
	listDecisions(projectId?: string): Promise<readonly DecisionRecord[]>;
	revokeDecision(id: string, reason: string): Promise<DecisionRecord>;
	confirmDecision(id: string, reason: string): Promise<DecisionRecord>;
	reviewDecisionArtifacts(id: string, reason: string): Promise<DecisionRecord>;
	listArtifacts(): Promise<readonly ArtifactRecord[]>;
	artifactProvenance(artifactId: string): Promise<ArtifactProvenance | undefined>;
	rerunArtifact(artifactId: string): Promise<ArtifactRerunResult>;
	setRerunHandler(
		handler: (provenance: ArtifactProvenance) => Promise<{ readonly jobId: string } | ArtifactRecord>,
	): void;
	setRerunCompletionHandler(handler: (pending: ArtifactRerunRecord) => Promise<ArtifactRecord>): void;
	onRerunUpdated(handler: (result: ArtifactRerunResult) => void): () => void;
	readOnlySnapshot(projectId?: string): Promise<InquiryReadOnlySnapshot | undefined>;
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
	private rerunHandler?: (
		provenance: ArtifactProvenance,
	) => Promise<{ readonly jobId: string } | ArtifactRecord>;
	private rerunCompletionHandler?: (pending: ArtifactRerunRecord) => Promise<ArtifactRecord>;
	private readonly rerunListeners = new Set<(result: ArtifactRerunResult) => void>();
	private readonly activeReruns = new Set<string>();
	private eventTail: Promise<void> = Promise.resolve();
	private disposed = false;
	private readonly projects = new Map<string, InquiryService>();
	private readonly options: InquiryServiceOptions;

	constructor(options: InquiryServiceOptions = {}) {
		this.options = options;
		this.onEventError = options.onEventError;
		this.rerunHandler = options.rerunHandler;
		if (options.projectsDir) {
			this.enabled = true;
			if (options.eventSource) this.attachEventSource(options.eventSource);
			return;
		}
		if (!options.inquiryDir) {
			this.enabled = false;
			return;
		}
		const projectId = options.projectId?.trim();
		if (!projectId) throw new Error("inquiryProjectId is required when inquiryDir is configured");
		this.storage = new SqliteInquiryStorage(projectId, join(options.inquiryDir, "ledger.sqlite"));
		this.domain = new DomainInquiryService(this.storage, {
			...(this.rerunHandler ? { rerunHandler: this.rerunHandler } : {}),
		});
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
					this.enqueue(async () =>
						this.recordComputeEvent(
							source.enrichComputeEvent ? await source.enrichComputeEvent(event) : event,
						),
					);
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
		if (source.onDecision) {
			attached.push(
				source.onDecision((event) => {
					this.enqueue(() => this.recordDecision(event));
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
		if (this.options.projectsDir)
			return this.project(event.projectId ?? this.options.projectId).recordComputeEvent({
				...event,
				projectId: event.projectId ?? this.options.projectId,
			});
		if (!this.domain || !this.storage) return;
		if (event.type === "submitted") {
			await this.recordDecision({
				id: `compute-submit:${event.jobId}`,
				kind: "compute-submit",
				summary: `Submitted compute job ${event.jobId}`,
				basis: [`job:${event.jobId}`, event.id],
				at: event.at,
				projectId: event.projectId,
			});
		}
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
			event.sessionId,
			event.turn,
			event.runProvenance,
		);
		const attempt: AttemptRecord = {
			id: `compute:${executionId}`,
			schemaVersion: 2,
			projectId: this.storage.projectId,
			hypothesisIds: [],
			parameters: {
				source: "compute",
				jobId: event.jobId,
				...(event.runId ? { runId: event.runId } : {}),
				eventType: event.type,
				status: event.status ?? null,
				...(event.hostId ? { hostId: event.hostId } : {}),
				...(event.parameters ?? {}),
			},
			artifactIds,
			...(summary(event.detail) ? { resultSummary: summary(event.detail) } : {}),
			outcome: outcomeFor(event.status, event.type),
			enteredReport: false,
			startedAt: asIso(event.startedAt ?? event.at),
			finishedAt: eventAt,
			...(event.codeFingerprint ? { codeFingerprint: event.codeFingerprint } : {}),
			...(event.sessionId ? { sessionId: event.sessionId } : {}),
			...(event.turn !== undefined ? { turn: event.turn } : {}),
			...(event.runProvenance ? { runProvenance: event.runProvenance } : {}),
		};
		await this.domain.recordAttempt(attempt);
		await this.associateReceipts([`job:${event.jobId}`, `run:${executionId}`], artifactIds);
	}

	/** Record a terminal task/workflow event and its verified artifact metadata. */
	async recordTaskTerminal(event: InquiryTaskTerminalEvent): Promise<void> {
		if (this.options.projectsDir)
			return this.project(event.projectId ?? this.options.projectId).recordTaskTerminal({
				...event,
				projectId: event.projectId ?? this.options.projectId,
			});
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
			event.sessionId,
			event.turn,
			event.runProvenance,
		);
		const attempt: AttemptRecord = {
			id: `task:${executionId}`,
			schemaVersion: 2,
			projectId: this.storage.projectId,
			hypothesisIds: [],
			parameters: {
				source: "task",
				taskId: event.taskId,
				...(event.runId ? { runId: event.runId } : {}),
				status: event.status,
				...(event.parameters ?? {}),
			},
			artifactIds,
			...(summary(event.detail) ? { resultSummary: summary(event.detail) } : {}),
			outcome: outcomeFor(event.status),
			enteredReport: false,
			startedAt: asIso(event.startedAt ?? event.at),
			finishedAt: eventAt,
			...(event.codeFingerprint ? { codeFingerprint: event.codeFingerprint } : {}),
			...(event.sessionId ? { sessionId: event.sessionId } : {}),
			...(event.turn !== undefined ? { turn: event.turn } : {}),
			...(event.runProvenance ? { runProvenance: event.runProvenance } : {}),
		};
		await this.domain.recordAttempt(attempt);
		await this.associateReceipts([`task:${event.taskId}`, `run:${executionId}`], artifactIds);
	}

	async recordDecision(event: InquiryDecisionEvent | DecisionRecord): Promise<void> {
		if (this.options.projectsDir) {
			const projectId = event.projectId ?? this.options.projectId;
			if (!projectId) throw new Error("A project identity is required for a decision");
			const project = this.project(projectId);
			return project.recordDecision({ ...event, id: `${this.projectKey(projectId)}:${event.id}` });
		}
		if (!this.domain || !this.storage) return;
		if (event.projectId && event.projectId !== this.storage.projectId)
			throw new Error(`Inquiry decision belongs to another project: ${event.projectId}`);
		const record: DecisionRecord =
			"schemaVersion" in event
				? event
				: {
						id: event.id,
						schemaVersion: 2,
						projectId: this.storage.projectId,
						kind: event.kind,
						summary: event.summary,
						basis: [...new Set(event.basis ?? [])],
						affectedArtifactIds: [...new Set(event.affectedArtifactIds ?? [])],
						status: "active",
						createdAt: asIso(event.at),
					};
		const snapshot = await this.storage.snapshot();
		const related = snapshot.artifacts.filter((item) =>
			record.basis.some(
				(basis) => basis === `${item.source.kind}:${item.source.id}` || basis === `run:${item.runId}`,
			),
		);
		await this.domain.recordDecision({
			...record,
			affectedArtifactIds: [...new Set([...record.affectedArtifactIds, ...related.map((item) => item.id)])],
		});
	}

	listDecisions(projectId?: string): Promise<readonly DecisionRecord[]> {
		if (this.options.projectsDir) return this.project(projectId).listDecisions(projectId);
		return this.domain?.listDecisions(projectId) ?? Promise.resolve([]);
	}

	revokeDecision(id: string, reason: string): Promise<DecisionRecord> {
		if (this.options.projectsDir) return this.projectForDecision(id).revokeDecision(id, reason);
		if (!this.domain) return Promise.reject(new Error("Inquiry service is unavailable"));
		const domain = this.domain;
		const operation = this.eventTail.then(() => domain.revokeDecision(id, reason));
		this.eventTail = operation.then(
			() => {},
			() => {},
		);
		return operation;
	}

	reviewDecisionArtifacts(id: string, reason: string): Promise<DecisionRecord> {
		return this.confirmDecision(id, reason);
	}

	confirmDecision(id: string, reason: string): Promise<DecisionRecord> {
		if (this.options.projectsDir) return this.projectForDecision(id).confirmDecision(id, reason);
		if (!this.domain) return Promise.reject(new Error("Inquiry service is unavailable"));
		const domain = this.domain;
		const operation = this.eventTail.then(() => domain.confirmDecision(id, reason));
		this.eventTail = operation.then(
			() => {},
			() => {},
		);
		return operation;
	}

	listArtifacts(): Promise<readonly ArtifactRecord[]> {
		if (this.options.projectsDir) return this.project(this.options.projectId).listArtifacts();
		return this.domain ? this.domain.snapshot().then((snapshot) => snapshot.artifacts) : Promise.resolve([]);
	}

	artifactProvenance(artifactId: string): Promise<ArtifactProvenance | undefined> {
		if (this.options.projectsDir) return this.project(this.options.projectId).artifactProvenance(artifactId);
		return this.domain?.artifactProvenance(artifactId) ?? Promise.resolve(undefined);
	}

	async rerunArtifact(artifactId: string): Promise<ArtifactRerunResult> {
		if (this.options.projectsDir) return this.project(this.options.projectId).rerunArtifact(artifactId);
		if (!this.domain) throw new Error("Inquiry service is unavailable");
		const result = await this.domain.rerunArtifact(artifactId);
		this.emitRerun(result);
		if (result.status === "submitted") {
			const pending = (await this.domain.pendingReruns()).find((item) => item.jobId === result.jobId);
			if (pending) void this.processRerun(pending);
		}
		return result;
	}

	setRerunHandler(
		handler: (provenance: ArtifactProvenance) => Promise<{ readonly jobId: string } | ArtifactRecord>,
	): void {
		this.rerunHandler = handler;
		this.domain?.setRerunHandler(handler);
	}

	setRerunCompletionHandler(handler: (pending: ArtifactRerunRecord) => Promise<ArtifactRecord>): void {
		this.rerunCompletionHandler = handler;
		if (this.domain) void this.resumePendingReruns();
	}

	onRerunUpdated(handler: (result: ArtifactRerunResult) => void): () => void {
		this.rerunListeners.add(handler);
		return () => this.rerunListeners.delete(handler);
	}

	private emitRerun(result: ArtifactRerunResult): void {
		for (const listener of this.rerunListeners) {
			try {
				listener(result);
			} catch (error) {
				this.onEventError?.(error);
			}
		}
	}

	private async resumePendingReruns(): Promise<void> {
		if (!this.domain || !this.rerunCompletionHandler) return;
		for (const pending of await this.domain.pendingReruns()) void this.processRerun(pending);
	}

	private async processRerun(pending: ArtifactRerunRecord): Promise<void> {
		if (this.disposed || !this.domain || !this.rerunCompletionHandler || this.activeReruns.has(pending.id))
			return;
		this.activeReruns.add(pending.id);
		try {
			const running = await this.domain.markRerunRunning(pending.id);
			if (running) this.emitRerun(this.toRerunResult(running));
			const artifact = await this.rerunCompletionHandler(pending);
			const result = await this.domain.completeRerun(pending.id, { artifact });
			if (result) this.emitRerun(result);
		} catch (error) {
			try {
				const result = await this.domain.completeRerun(pending.id, {
					error: error instanceof Error ? error.message : String(error),
				});
				if (result) this.emitRerun(result);
			} catch (completionError) {
				this.onEventError?.(completionError);
			}
		} finally {
			this.activeReruns.delete(pending.id);
		}
	}

	private toRerunResult(record: ArtifactRerunRecord): ArtifactRerunResult {
		return {
			status: record.status,
			jobId: record.jobId,
			previousArtifactId: record.sourceArtifactId,
			previousSha256: record.previousSha256,
			...(record.resultArtifactId ? { artifactId: record.resultArtifactId } : {}),
			...(record.sha256 ? { sha256: record.sha256 } : {}),
			...(record.difference ? { difference: record.difference } : {}),
			...(record.error ? { error: record.error } : {}),
		};
	}

	private projectKey(projectId: string): string {
		return createHash("sha256").update(projectId).digest("hex").slice(0, 32);
	}

	private project(projectId?: string): InquiryService {
		if (!projectId?.trim() || !this.options.projectsDir) throw new Error("A project identity is required");
		const key = this.projectKey(projectId);
		let service = this.projects.get(key);
		if (!service) {
			const root = join(this.options.projectsDir, key);
			this.options.storageRegistry?.registerDiscoveredRoot(
				"inquiry-ledger",
				join(root, "ledger.sqlite"),
				"inquiry/ledger",
				"private",
				2,
			);
			service = new InquiryService({
				inquiryDir: root,
				projectId,
				onEventError: this.onEventError,
				...(this.rerunHandler ? { rerunHandler: this.rerunHandler } : {}),
			});
			this.projects.set(key, service);
		}
		return service;
	}

	private projectForDecision(id: string): InquiryService {
		const key = id.split(":")[0] ?? "";
		if (!this.options.projectsDir || !/^[a-f0-9]{32}$/.test(key))
			throw new Error("Invalid project decision id");
		const cached = this.projects.get(key);
		if (cached) return cached;
		const path = join(this.options.projectsDir, key, "ledger.sqlite");
		if (!existsSync(path)) throw new Error("Decision project not found");
		const database = new DatabaseSync(path, { readOnly: true });
		try {
			const meta = database.prepare("SELECT project_id FROM inquiry_meta LIMIT 1").get();
			if (typeof meta?.project_id !== "string" || this.projectKey(meta.project_id) !== key)
				throw new Error("Invalid project ledger");
			return this.project(meta.project_id);
		} finally {
			database.close();
		}
	}

	private async associateReceipts(basis: readonly string[], artifactIds: readonly string[]): Promise<void> {
		if (!this.domain || !artifactIds.length) return;
		for (const decision of await this.domain.listDecisions()) {
			if (decision.basis.some((item) => basis.includes(item)))
				await this.domain.associateDecisionArtifacts(decision.id, artifactIds);
		}
	}

	/** Return the project projection only; no ledger mutation or file access occurs beyond the read. */
	async readOnlySnapshot(projectId?: string): Promise<InquiryReadOnlySnapshot | undefined> {
		await this.drainEvents();
		if (this.options.projectsDir) return projectId ? this.project(projectId).readOnlySnapshot() : undefined;
		if (!this.domain) return undefined;
		const [state, snapshot] = await Promise.all([this.domain.readOnlyState(), this.domain.snapshot()]);
		return { ...state, attempts: snapshot.attempts };
	}

	/** Wait until all host events observed so far have finished writing. */
	async drainEvents(): Promise<void> {
		await this.eventTail;
		await Promise.all([...this.projects.values()].map((project) => project.drainEvents()));
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		for (const unsubscribe of [...this.unsubscribers]) unsubscribe();
		for (const project of this.projects.values()) project.dispose();
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
		sessionId?: string,
		turn?: number,
		runProvenance?: RunProvenanceSummary,
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
				sessionId,
				turn,
				runProvenance,
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
		sessionId?: string,
		turn?: number,
		runProvenance?: RunProvenanceSummary,
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
			schemaVersion: 2,
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
			...(sessionId ? { sessionId } : {}),
			...(turn !== undefined ? { turn } : {}),
			...(runProvenance ? { runProvenance } : {}),
			createdAt: eventAt,
			updatedAt: eventAt,
		};
	}
}
