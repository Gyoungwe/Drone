import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import type {
	ArtifactManifest,
	HostCapability,
	HostProfile,
	JobRecord,
	JobSpec,
	JobState,
} from "@drone/compute";
import { createCausalEnvelope, type DroneRuntime } from "@drone/shared";
import { JsonStore } from "../json-store";
import { createLogger } from "../log";
import { getAgentDir } from "../session-engine/engine";
import type { StorageRegistry } from "../storage/registry";
import { validateArtifactManifest, verifyArtifactChecksums } from "./compute-artifact-checks";
import { type ComputeCancelHost, cancelComputeJob } from "./compute-cleanup";
import { createComputeInflight } from "./compute-inflight";
import { asRecord, now, setRecordFields, statusOf } from "./compute-job-state";
import { assertComputePreflight, type ComputePreflightJobSpec } from "./compute-preflight";
import { type ComputeReconcileHost, reconcileComputeJob } from "./compute-reconcile";

export { artifactSha256, validateArtifactManifest } from "./compute-artifact-checks";

const log = createLogger("compute-service");

/** Result returned by a transport/runner adapter after a side-effecting start. */
export interface ComputeSubmitResult {
	remoteId?: string;
	pid?: number;
	startedAt?: number;
	status?: JobState;
	[key: string]: unknown;
}

/** A runner status response. The service deliberately accepts a structural value. */
export interface ComputeStatusResult {
	status: JobState;
	remoteId?: string;
	pid?: number;
	error?: string;
	usage?: Record<string, number>;
	[key: string]: unknown;
}

export interface ComputeLogEvent {
	readonly type: string;
	readonly at?: number;
	readonly text?: string;
	readonly [key: string]: unknown;
}

export interface ComputeLogsResult {
	events: readonly ComputeLogEvent[];
	cursor?: string;
}

export interface ComputeCollectResult {
	/** Manifest of files copied into the approved local output directory. */
	manifest: ArtifactManifest;
	/** Optional runner supplied metadata. */
	[key: string]: unknown;
}

export interface ComputeTerminalSession {
	readonly id: string;
	readonly hostAlias: string;
	readonly cwd: string;
	readonly mode: "shell" | "command";
	write(text: string): Promise<void>;
	close(): Promise<void>;
	onOutput(handler: (text: string) => void): () => void;
}

/**
 * Backend-owned runner boundary. The domain package owns protocol and state
 * semantics; this interface owns connection lifetime and filesystem policy.
 * Tests can inject a deterministic fake without opening an SSH connection.
 */
export interface ComputeExecutor {
	probeHost?(host: HostProfile): Promise<HostCapability>;
	listWorkflowModules?(): Promise<readonly ComputeWorkflowModule[]>;
	submit(spec: JobSpec, host: HostProfile, signal?: AbortSignal): Promise<ComputeSubmitResult>;
	status(job: JobRecord, host: HostProfile): Promise<ComputeStatusResult>;
	logs?(job: JobRecord, host: HostProfile, cursor?: string): Promise<ComputeLogsResult>;
	cancel?(job: JobRecord, host: HostProfile): Promise<ComputeStatusResult | undefined>;
	collect?(
		job: JobRecord,
		host: HostProfile,
		options?: ComputeCollectOptions,
		signal?: AbortSignal,
	): Promise<ComputeCollectResult>;
	openTerminal?(
		host: HostProfile,
		input: { cwd?: string; mode?: "shell" | "command" },
	): Promise<ComputeTerminalSession>;
}

export interface ComputeWorkflowModule {
	readonly id: string;
	readonly name: string;
	readonly source: "nf-core" | "user" | "agent";
	readonly version: string;
	readonly containerDigest?: string;
}

export interface ComputeCollectOptions {
	/** Approved local writable directory. Paths are checked before accepting a manifest. */
	targetDir: string;
	/** Expected output paths/checksums from the job contract. */
	expected?: readonly string[];
	/** Collection cap; the contract default is 500 MiB. */
	maxBytes?: number;
}

export interface ComputeServiceOptions {
	runtime?: DroneRuntime;
	storage: StorageRegistry;
	agentDir?: string;
	executor?: ComputeExecutor;
	/** Optional host hook for additional checks; built-in B7 preflight always runs. */
	preflight?: (spec: ComputePreflightJobSpec) => void | Promise<void>;
	/** Receives terminal/collection observations for the B4 experience store. */
	experienceRecorder?: ComputeExperienceRecorder;
	pollIntervalMs?: number;
}

export interface ComputeExperienceRecorder {
	record(event: ComputeEvent, job: JobRecord): void | Promise<void>;
}

/** Host contracts permit an omitted id; the service allocates one before prepare/start. */
export type ComputeJobInput = Omit<JobSpec, "jobId"> & {
	jobId?: string;
	/** Optional B7 records and immutable design contract supplied by the task host. */
	dataDesign?: unknown;
	/** Approved task contract, including the B7 dataDesign hash binding. */
	authorization?: unknown;
	contractHash?: string;
};
type ComputeEventKind = "created" | "submitted" | "status" | "logs" | "collected" | "cancelled" | "error";
export interface ComputeEvent {
	readonly id: string;
	readonly jobId: string;
	readonly type: ComputeEventKind | "cleanup";
	readonly at: number;
	readonly status?: JobState;
	readonly cursor?: string;
	readonly detail?: string;
	/** Verified runner entries emitted when collection completes. */
	readonly artifacts?: ArtifactManifest["entries"];
	readonly lineage?: import("@drone/shared").CausalEnvelope;
}

export interface ComputeServicePort {
	init(): Promise<void>;
	listHosts(): Promise<HostProfile[]>;
	getHost(alias: string): Promise<HostProfile | null>;
	upsertHost(host: HostProfile): Promise<HostProfile>;
	removeHost(alias: string): Promise<boolean>;
	probeHost(alias: string): Promise<HostCapability>;
	listJobs(): Promise<JobRecord[]>;
	getJob(jobId: string): Promise<JobRecord | null>;
	listEvents(jobId: string): Promise<ComputeEvent[]>;
	submit(spec: ComputeJobInput, signal?: AbortSignal): Promise<JobRecord>;
	submitJob(spec: ComputeJobInput): Promise<JobRecord>;
	status(jobId: string): Promise<JobRecord>;
	getJobStatus(jobId: string): Promise<JobRecord>;
	reconcile(jobId?: string): Promise<JobRecord[]>;
	reconcileJob(jobId?: string): Promise<JobRecord[]>;
	logs(jobId: string, cursor?: string): Promise<ComputeLogsResult>;
	cancel(jobId: string): Promise<JobRecord>;
	collect(jobId: string, options: ComputeCollectOptions, signal?: AbortSignal): Promise<ComputeCollectResult>;
	/** ComputeContract naming aliases kept at the backend boundary. */
	getJobLogs(jobId: string, cursor?: string): Promise<ComputeLogsResult>;
	cancelJob(jobId: string): Promise<JobRecord>;
	collectJob(input: ComputeCollectOptions & { jobId: string }): Promise<ComputeCollectResult>;
	listWorkflowModules(): Promise<readonly ComputeWorkflowModule[]>;
	openTerminal(
		hostAlias: string,
		input: { cwd?: string; mode?: "shell" | "command" },
	): Promise<ComputeTerminalSession>;
	onEvent(handler: (event: ComputeEvent) => void): () => void;
	dispose(): Promise<void>;
}

function safeAlias(alias: string): string {
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(alias)) throw new Error("Invalid compute host alias");
	return alias;
}

function safeJobId(jobId: string): string {
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(jobId)) throw new Error("Invalid compute job id");
	return jobId;
}

function specFingerprint(spec: unknown): string {
	const row = asRecord(spec);
	const { jobId: _jobId, lineage: _lineage, ...withoutId } = row;
	return createHash("sha256").update(JSON.stringify(withoutId)).digest("hex");
}

/** Host profiles are configuration, never a credential vault. */
function sanitizeHost(host: HostProfile): HostProfile {
	const copy = { ...asRecord(host) };
	for (const key of [
		"password",
		"passphrase",
		"privateKey",
		"private_key",
		"secret",
		"token",
		"credential",
	]) {
		delete copy[key];
	}
	return copy as unknown as HostProfile;
}

function eventStorePath(root: string, jobId: string): string {
	return join(root, "events", `${safeJobId(jobId)}.jsonl`);
}

function jobStorePath(root: string, jobId: string): string {
	return join(root, "jobs", `${safeJobId(jobId)}.json`);
}

/** ComputeService owns only metadata and runner coordination; no credentials are persisted. */
export class ComputeService implements ComputeServicePort {
	private readonly root: string;
	private readonly hostsStore: JsonStore<HostProfile[]>;
	private readonly jobs = new Map<string, JobRecord>();
	private readonly hostCache = new Map<string, HostProfile>();
	private readonly events = new Set<(event: ComputeEvent) => void>();
	private readonly inflight = createComputeInflight();
	private readonly executor?: ComputeExecutor;
	private readonly preflight?: (spec: ComputePreflightJobSpec) => void | Promise<void>;
	private readonly experienceRecorder?: ComputeExperienceRecorder;
	private readonly runtime?: DroneRuntime;
	private readonly pollIntervalMs: number;
	private pollTimer: ReturnType<typeof setInterval> | undefined;
	private initialized = false;
	private disposed = false;

	constructor(private readonly options: ComputeServiceOptions) {
		this.runtime = options.runtime;
		this.executor = options.executor;
		this.preflight = options.preflight;
		this.experienceRecorder = options.experienceRecorder;
		this.pollIntervalMs = Math.max(1_000, options.pollIntervalMs ?? 15_000);
		this.root = join(options.agentDir ?? getAgentDir(), "compute");
		this.registerStorage();
		this.hostsStore = new JsonStore<HostProfile[]>({
			path: join(this.root, "hosts.json"),
			storageId: "agent-compute-hosts",
			defaultValue: () => [],
		});
	}

	/** Whether a concrete runner was supplied for remote compute operations. */
	hasExecutor(): boolean {
		return this.executor !== undefined;
	}

	/** Whether the configured runner implements one of the optional operations. */
	hasExecutorMethod(method: keyof ComputeExecutor): boolean {
		return typeof this.executor?.[method] === "function";
	}

	private registerStorage(): void {
		const entries = [
			{
				id: "agent-compute-root",
				path: this.root,
				owner: "compute/service",
				schema: 1,
				sensitivity: "private" as const,
			},
			{
				id: "agent-compute-hosts",
				path: join(this.root, "hosts.json"),
				owner: "compute/hosts",
				schema: 1,
				sensitivity: "config" as const,
			},
			{
				id: "agent-compute-jobs-root",
				path: join(this.root, "jobs"),
				owner: "compute/jobs",
				schema: 1,
				sensitivity: "private" as const,
			},
			{
				id: "agent-compute-events-root",
				path: join(this.root, "events"),
				owner: "compute/events",
				schema: 1,
				sensitivity: "private" as const,
			},
		];
		for (const entry of entries) {
			if (!this.options.storage.get(entry.id)) this.options.storage.register(entry);
		}
	}

	private registerJobStorage(jobId: string): void {
		const id = `agent-compute-job-${jobId}`;
		if (!this.options.storage.get(id))
			this.options.storage.register({
				id,
				path: jobStorePath(this.root, jobId),
				owner: "compute/jobs",
				schema: 1,
				sensitivity: "private",
			});
		const eventId = `agent-compute-events-${jobId}`;
		if (!this.options.storage.get(eventId))
			this.options.storage.register({
				id: eventId,
				path: eventStorePath(this.root, jobId),
				owner: "compute/events",
				schema: 1,
				sensitivity: "private",
			});
	}

	private jobStore(jobId: string): JsonStore<JobRecord | null> {
		this.registerJobStorage(jobId);
		return new JsonStore<JobRecord | null>({
			path: jobStorePath(this.root, jobId),
			storageId: "agent-compute-jobs-root",
			defaultValue: () => null,
		});
	}

	private eventStore(jobId: string): JsonStore<ComputeEvent[]> {
		this.registerJobStorage(jobId);
		return new JsonStore<ComputeEvent[]>({
			path: eventStorePath(this.root, jobId),
			storageId: "agent-compute-events-root",
			defaultValue: () => [],
			parse: (raw) => {
				const lines = raw
					.split(/\r?\n/)
					.map((line) => line.trim())
					.filter(Boolean);
				return lines.map((line) => JSON.parse(line) as ComputeEvent);
			},
			serialize: (events) => events.map((event) => JSON.stringify(event)).join("\n"),
		});
	}

	async init(): Promise<void> {
		if (this.initialized) return;
		await this.initializeStorage();
		if (this.disposed) return;
		this.pollTimer = setInterval(() => void this.reconcile(), this.pollIntervalMs);
		this.pollTimer.unref?.();
		await this.reconcile();
	}

	private async initializeStorage(): Promise<void> {
		this.initialized = true;
		await mkdir(join(this.root, "jobs"), { recursive: true });
		await mkdir(join(this.root, "events"), { recursive: true });
		for (const host of await this.hostsStore.read()) {
			const alias = asRecord(host).alias;
			if (typeof alias !== "string") continue;
			try {
				this.hostCache.set(safeAlias(alias), sanitizeHost(host));
			} catch {
				log.warn("skipping invalid persisted compute host", alias);
			}
		}
		await this.loadPersistedJobs();
	}

	async listHosts(): Promise<HostProfile[]> {
		if (!this.initialized) await this.init();
		return [...this.hostCache.values()].map((host) => ({ ...host }));
	}

	async getHost(alias: string): Promise<HostProfile | null> {
		if (!this.initialized) await this.init();
		return this.hostCache.get(safeAlias(alias)) ?? null;
	}

	async upsertHost(host: HostProfile): Promise<HostProfile> {
		if (!this.initialized) await this.init();
		const alias = safeAlias(String(asRecord(host).alias ?? ""));
		const sanitized = sanitizeHost({ ...host, alias } as HostProfile);
		this.hostCache.set(alias, sanitized);
		await this.hostsStore.write([...this.hostCache.values()]);
		return sanitized;
	}

	async removeHost(alias: string): Promise<boolean> {
		if (!this.initialized) await this.init();
		const normalized = safeAlias(alias);
		const removed = this.hostCache.delete(normalized);
		if (removed) await this.hostsStore.write([...this.hostCache.values()]);
		return removed;
	}

	async probeHost(alias: string): Promise<HostCapability> {
		const host = await this.requireHost(alias);
		if (!this.executor?.probeHost) throw new Error("Compute runner is not configured");
		const capability = await this.executor.probeHost(host);
		const current = asRecord(host);
		log.info("compute host probed", { alias: current.alias, runnerVersion: capability.runnerVersion });
		return capability;
	}

	async listJobs(): Promise<JobRecord[]> {
		if (!this.initialized) await this.init();
		return [...this.jobs.values()].map((job) => ({ ...job }));
	}

	async getJob(jobId: string): Promise<JobRecord | null> {
		if (!this.initialized) await this.init();
		const id = safeJobId(jobId);
		const memory = this.jobs.get(id);
		if (memory) return { ...memory };
		try {
			const value = await this.jobStore(id).read();
			if (!value) return null;
			this.jobs.set(id, value);
			return { ...value };
		} catch {
			return null;
		}
	}

	async listEvents(jobId: string): Promise<ComputeEvent[]> {
		if (!this.initialized) await this.init();
		return await this.eventStore(safeJobId(jobId)).read();
	}

	submit(spec: ComputeJobInput, signal?: AbortSignal): Promise<JobRecord> {
		return this.inflight.run(signal, (opSignal) => this.submitActive(spec, opSignal));
	}

	private async submitActive(spec: ComputeJobInput, signal: AbortSignal): Promise<JobRecord> {
		// B7 is a host-side gate. Run it before idempotency lookup, persistence,
		// initialization, or any executor call so an invalid/mismatched design
		// cannot cause an observable compute side effect or silently alter intent.
		assertComputePreflight(spec as ComputePreflightJobSpec);
		if (this.preflight) await this.preflight(spec as ComputePreflightJobSpec);
		if (!this.initialized) await this.init();
		const raw = asRecord(spec);
		const requestedId = typeof raw.jobId === "string" ? raw.jobId : undefined;
		const idempotencyKey = typeof raw.idempotencyKey === "string" ? raw.idempotencyKey : undefined;
		const existingById = requestedId ? await this.getJob(requestedId) : null;
		const existing =
			existingById ??
			(idempotencyKey &&
				[...this.jobs.values()].find((job) => asRecord(job.spec).idempotencyKey === idempotencyKey));
		if (existing) {
			if (specFingerprint(asRecord(existing).spec) !== specFingerprint(spec)) {
				const conflict = existingById ? "job" : "idempotency key";
				throw new Error(
					`Compute ${conflict} already exists with a different specification: ${existingById ? requestedId : idempotencyKey}`,
				);
			}
			return existingById ?? { ...existing };
		}
		const jobId = safeJobId(requestedId ?? randomUUID());
		const hostAlias = String(raw.hostAlias ?? raw.host ?? "");
		const host = await this.requireHost(hostAlias);
		const timestamp = now();
		const job = {
			...raw,
			jobId,
			spec: { ...spec, jobId },
			hostAlias,
			status: "draft",
			createdAt: timestamp,
			updatedAt: timestamp,
		} as unknown as JobRecord;
		this.jobs.set(jobId, job);
		await this.recordSubmission(job, "created");
		return this.submitToExecutor(job, host, signal);
	}

	private async submitToExecutor(job: JobRecord, host: HostProfile, signal: AbortSignal) {
		const executor = this.executor;
		if (!executor) return { ...job };
		try {
			const result = await this.runExclusive(job.jobId, () => {
				signal.throwIfAborted();
				return executor.submit(job.spec, host, signal);
			});
			const submitted = this.updateJob(job, {
				status: result?.status ?? "queued",
				remoteId: result?.remoteId,
				pid: result?.pid,
				startedAt: result?.startedAt ?? now(),
				...(result?.progress && typeof result.progress === "object" ? { progress: result.progress } : {}),
				updatedAt: now(),
			});
			await this.recordSubmission(submitted, "submitted");
			return { ...submitted };
		} catch (error) {
			// An unknown side-effect result must be reconciled rather than replayed.
			const unknown = this.updateJob(job, { status: "unknown", updatedAt: now(), error: String(error) });
			await this.recordSubmission(unknown, "error", String(error));
			return { ...unknown };
		}
	}

	private async recordSubmission(job: JobRecord, type: "created" | "submitted" | "error", detail?: string) {
		await this.persistJob(job);
		await this.appendEvent({
			id: randomUUID(),
			jobId: job.jobId,
			type,
			at: type === "created" ? job.createdAt : now(),
			status: statusOf(job),
			...(detail === undefined ? {} : { detail }),
		});
	}

	async status(jobId: string): Promise<JobRecord> {
		const [job] = await this.reconcile(jobId);
		if (!job) throw new Error(`Compute job not found: ${jobId}`);
		return job;
	}

	submitJob(spec: ComputeJobInput): Promise<JobRecord> {
		return this.submit(spec);
	}

	getJobStatus(jobId: string): Promise<JobRecord> {
		return this.status(jobId);
	}

	async reconcile(jobId?: string): Promise<JobRecord[]> {
		if (!this.initialized) await this.initializeStorage();
		const candidates = jobId ? [await this.getJob(jobId)] : [...this.jobs.values()];
		const result: JobRecord[] = [];
		for (const current of candidates) {
			if (!current) continue;
			result.push(await reconcileComputeJob(this.reconcileHost, current));
		}
		return result;
	}

	reconcileJob(jobId?: string): Promise<JobRecord[]> {
		return this.reconcile(jobId);
	}

	async logs(jobId: string, cursor?: string): Promise<ComputeLogsResult> {
		const job = await this.requireJob(jobId);
		const host = await this.requireHost(String(asRecord(job).hostAlias));
		if (!this.executor?.logs) throw new Error("Compute runner does not provide logs");
		const result = await this.runExclusive(jobId, () => this.executor?.logs?.(job, host, cursor));
		if (!result) return { events: [], cursor };
		await this.appendEvent({ id: randomUUID(), jobId, type: "logs", at: now(), cursor: result.cursor });
		return result;
	}

	getJobLogs(jobId: string, cursor?: string): Promise<ComputeLogsResult> {
		return this.logs(jobId, cursor);
	}

	async cancel(jobId: string): Promise<JobRecord> {
		return cancelComputeJob(this.cancelHost, jobId);
	}

	cancelJob(jobId: string): Promise<JobRecord> {
		return this.cancel(jobId);
	}

	collect(jobId: string, options: ComputeCollectOptions, signal?: AbortSignal) {
		return this.inflight.run(signal, (opSignal) => this.collectActive(jobId, options, opSignal));
	}

	private async collectActive(jobId: string, options: ComputeCollectOptions, signal: AbortSignal) {
		const job = await this.requireJob(jobId);
		if (statusOf(job) !== "succeeded")
			throw new Error("Artifacts can only be collected from a succeeded job");
		const collect = this.executor?.collect?.bind(this.executor);
		if (!collect) throw new Error("Compute runner does not provide artifact collection");
		const targetDir = resolve(options.targetDir);
		await mkdir(targetDir, { recursive: true });
		const host = await this.requireHost(String(asRecord(job).hostAlias));
		const result = await this.runExclusive(jobId, () => {
			signal.throwIfAborted();
			return collect(job, host, { ...options, targetDir }, signal);
		});
		if (!result) throw new Error("Compute runner returned no artifact manifest");
		validateArtifactManifest(result.manifest, targetDir, options.expected, options.maxBytes);
		await verifyArtifactChecksums(result.manifest, targetDir);
		signal.throwIfAborted();
		await this.appendEvent({
			id: randomUUID(),
			jobId,
			type: "collected",
			at: now(),
			status: "succeeded",
			artifacts: result.manifest.entries,
		});
		return result;
	}

	collectJob(input: ComputeCollectOptions & { jobId: string }): Promise<ComputeCollectResult> {
		return this.collect(input.jobId, input);
	}

	async listWorkflowModules(): Promise<readonly ComputeWorkflowModule[]> {
		return (await this.executor?.listWorkflowModules?.()) ?? [];
	}

	async openTerminal(
		hostAlias: string,
		input: { cwd?: string; mode?: "shell" | "command" },
	): Promise<ComputeTerminalSession> {
		if (!this.executor?.openTerminal) throw new Error("Compute runner does not provide terminal access");
		const host = await this.requireHost(hostAlias);
		return this.executor.openTerminal(host, input);
	}

	onEvent(handler: (event: ComputeEvent) => void): () => void {
		this.events.add(handler);
		return () => this.events.delete(handler);
	}

	async dispose(): Promise<void> {
		this.disposed = true;
		if (this.pollTimer) clearInterval(this.pollTimer);
		this.pollTimer = undefined;
		await this.inflight.abortAndDrain();
		this.events.clear();
	}

	private get cancelHost(): ComputeCancelHost {
		return {
			executor: this.executor,
			requireJob: this.requireJob.bind(this),
			requireHost: this.requireHost.bind(this),
			updateJob: this.updateJob.bind(this),
			persistJob: this.persistJob.bind(this),
			appendEvent: this.appendEvent.bind(this),
			runExclusive: this.runExclusive.bind(this),
		};
	}

	private get reconcileHost(): ComputeReconcileHost {
		return {
			executor: this.executor,
			hostFor: this.hostCache.get.bind(this.hostCache),
			updateJob: this.updateJob.bind(this),
			persistJob: this.persistJob.bind(this),
			appendEvent: this.appendEvent.bind(this),
			runExclusive: this.runExclusive.bind(this),
		};
	}

	private async requireHost(alias: string): Promise<HostProfile> {
		const host = await this.getHost(alias);
		if (!host) throw new Error(`Compute host not found: ${alias}`);
		return host;
	}

	private async loadPersistedJobs(): Promise<void> {
		let names: string[];
		try {
			names = await readdir(join(this.root, "jobs"));
		} catch {
			return;
		}
		for (const name of names) {
			if (!name.endsWith(".json")) continue;
			const id = name.slice(0, -5);
			if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id)) continue;
			try {
				const value = await this.jobStore(id).read();
				if (value && String(asRecord(value).jobId) === id) this.jobs.set(id, value);
			} catch (error) {
				log.warn("failed to load persisted compute job", id, error);
			}
		}
	}

	private async requireJob(jobId: string): Promise<JobRecord> {
		const job = await this.getJob(jobId);
		if (!job) throw new Error(`Compute job not found: ${jobId}`);
		return job;
	}

	private updateJob(job: JobRecord, fields: Record<string, unknown>): JobRecord {
		const next = setRecordFields(job, fields);
		this.jobs.set(String(asRecord(next).jobId), next);
		return next;
	}

	private async persistJob(job: JobRecord): Promise<void> {
		const id = safeJobId(String(asRecord(job).jobId));
		await this.jobStore(id).write(job);
		this.jobs.set(id, job);
	}

	private async appendEvent(event: ComputeEvent): Promise<void> {
		const job = this.jobs.get(event.jobId);
		const events = await this.eventStore(event.jobId).read();
		const parent = events.at(-1)?.id ?? job?.spec.lineage?.eventId;
		const lineage =
			event.lineage ??
			(job?.spec.lineage
				? createCausalEnvelope({
						eventId: event.id,
						...(parent ? { causationId: parent } : {}),
						...(job.spec.lineage.runAttemptId ? { runAttemptId: job.spec.lineage.runAttemptId } : {}),
					})
				: undefined);
		const recorded = lineage ? { ...event, lineage } : event;
		await this.eventStore(event.jobId).update((current) => [...current, recorded]);
		const observedJob = this.jobs.get(event.jobId);
		if (observedJob && this.experienceRecorder) {
			await Promise.resolve(this.experienceRecorder.record(recorded, observedJob)).catch((error) => {
				log.warn("compute experience recording failed", error);
			});
		}
		for (const handler of this.events) {
			try {
				handler(recorded);
			} catch (error) {
				log.warn("compute event handler failed", error);
			}
		}
	}

	private runExclusive<T>(jobId: string, task: () => Promise<T> | T): Promise<T> {
		if (this.runtime?.scheduler) return this.runtime.scheduler.run(`compute:${jobId}`, task);
		return Promise.resolve().then(task);
	}
}
