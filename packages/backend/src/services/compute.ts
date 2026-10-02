import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import type {
	ArtifactManifest,
	HostCapability,
	HostProfile,
	JobRecord,
	JobSpec,
	JobState,
} from "@drone/compute";
import type { DroneRuntime } from "@drone/shared";
import { JsonStore } from "../json-store";
import { createLogger } from "../log";
import { getAgentDir } from "../session-engine/engine";
import type { StorageRegistry } from "../storage/registry";

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

/**
 * Backend-owned runner boundary. The domain package owns protocol and state
 * semantics; this interface owns connection lifetime and filesystem policy.
 * Tests can inject a deterministic fake without opening an SSH connection.
 */
export interface ComputeExecutor {
	probeHost?(host: HostProfile): Promise<HostCapability>;
	listWorkflowModules?(): Promise<readonly ComputeWorkflowModule[]>;
	submit(spec: JobSpec, host: HostProfile): Promise<ComputeSubmitResult>;
	status(job: JobRecord, host: HostProfile): Promise<ComputeStatusResult>;
	logs?(job: JobRecord, host: HostProfile, cursor?: string): Promise<ComputeLogsResult>;
	cancel?(job: JobRecord, host: HostProfile): Promise<ComputeStatusResult | undefined>;
	collect?(job: JobRecord, host: HostProfile, options?: ComputeCollectOptions): Promise<ComputeCollectResult>;
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
	pollIntervalMs?: number;
}

/** Host contracts permit an omitted id; the service allocates one before prepare/start. */
export type ComputeJobInput = Omit<JobSpec, "jobId"> & { jobId?: string };

export interface ComputeEvent {
	readonly id: string;
	readonly jobId: string;
	readonly type: "created" | "submitted" | "status" | "logs" | "collected" | "cancelled" | "error";
	readonly at: number;
	readonly status?: JobState;
	readonly cursor?: string;
	readonly detail?: string;
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
	submit(spec: ComputeJobInput): Promise<JobRecord>;
	submitJob(spec: ComputeJobInput): Promise<JobRecord>;
	status(jobId: string): Promise<JobRecord>;
	getJobStatus(jobId: string): Promise<JobRecord>;
	reconcile(jobId?: string): Promise<JobRecord[]>;
	reconcileJob(jobId?: string): Promise<JobRecord[]>;
	logs(jobId: string, cursor?: string): Promise<ComputeLogsResult>;
	cancel(jobId: string): Promise<JobRecord>;
	collect(jobId: string, options: ComputeCollectOptions): Promise<ComputeCollectResult>;
	/** ComputeContract naming aliases kept at the backend boundary. */
	getJobLogs(jobId: string, cursor?: string): Promise<ComputeLogsResult>;
	cancelJob(jobId: string): Promise<JobRecord>;
	collectJob(input: ComputeCollectOptions & { jobId: string }): Promise<ComputeCollectResult>;
	listWorkflowModules(): Promise<readonly ComputeWorkflowModule[]>;
	onEvent(handler: (event: ComputeEvent) => void): () => void;
	dispose(): Promise<void>;
}

const TERMINAL = new Set<JobState>(["succeeded", "failed", "cancelled", "blocked", "partial"]);
const POLLABLE = new Set<JobState>([
	"draft",
	"authorized",
	"prepared",
	"submitting",
	"queued",
	"running",
	"collecting",
	"cancelling",
	"unknown",
	"needs-login",
	"needs_login",
]);

function now(): number {
	return Date.now();
}

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function statusOf(value: JobRecord): JobState {
	const status = asRecord(value).status;
	return typeof status === "string" ? (status as JobState) : "unknown";
}

function setRecordFields<T extends object>(value: T, fields: Record<string, unknown>): T {
	return { ...asRecord(value), ...fields } as T;
}

function isTerminal(status: JobState): boolean {
	return TERMINAL.has(status);
}

const STATUS_RANK: Partial<Record<JobState, number>> = {
	draft: 0,
	authorized: 1,
	prepared: 2,
	submitting: 3,
	queued: 4,
	running: 5,
	collecting: 6,
	cancelling: 6,
};

/** Keep reconciliation monotonic. A stale runner response cannot revive a terminal job. */
function mergeStatus(previous: JobState, next: JobState): JobState {
	if (isTerminal(previous)) return previous;
	if (next === "unknown") return "unknown";
	if (previous === "unknown") return next;
	if (next === "failed" || next === "cancelled") return next;
	if ((STATUS_RANK[next] ?? -1) < (STATUS_RANK[previous] ?? -1)) return previous;
	return next;
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
	const { jobId: _jobId, ...withoutId } = row;
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
	private readonly executor?: ComputeExecutor;
	private readonly runtime?: DroneRuntime;
	private readonly pollIntervalMs: number;
	private pollTimer: ReturnType<typeof setInterval> | undefined;
	private initialized = false;
	private disposed = false;

	constructor(private readonly options: ComputeServiceOptions) {
		this.runtime = options.runtime;
		this.executor = options.executor;
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
		this.pollTimer = setInterval(() => void this.reconcile(), this.pollIntervalMs);
		this.pollTimer.unref?.();
		await this.reconcile();
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

	async submit(spec: ComputeJobInput): Promise<JobRecord> {
		if (!this.initialized) await this.init();
		const raw = asRecord(spec);
		const requestedId = typeof raw.jobId === "string" ? raw.jobId : undefined;
		const idempotencyKey = typeof raw.idempotencyKey === "string" ? raw.idempotencyKey : undefined;
		if (requestedId) {
			const existing = await this.getJob(requestedId);
			if (existing) {
				if (specFingerprint(asRecord(existing).spec) !== specFingerprint(spec))
					throw new Error(`Compute job already exists with a different specification: ${requestedId}`);
				return existing;
			}
		}
		if (idempotencyKey) {
			const existing = [...this.jobs.values()].find(
				(job) => asRecord(asRecord(job).spec).idempotencyKey === idempotencyKey,
			);
			if (existing) {
				if (specFingerprint(asRecord(existing).spec) !== specFingerprint(spec))
					throw new Error(
						`Compute idempotency key already exists with a different specification: ${idempotencyKey}`,
					);
				return { ...existing };
			}
		}
		const jobId = safeJobId(requestedId ?? randomUUID());
		const hostAlias = String(raw.hostAlias ?? raw.host ?? "");
		const host = await this.requireHost(hostAlias);
		const timestamp = now();
		const normalizedSpec = { ...spec, jobId } as JobSpec;
		const job = {
			...raw,
			jobId,
			spec: normalizedSpec,
			hostAlias,
			status: "draft",
			createdAt: timestamp,
			updatedAt: timestamp,
		} as unknown as JobRecord;
		this.jobs.set(jobId, job);
		await this.persistJob(job);
		await this.appendEvent({
			id: randomUUID(),
			jobId,
			type: "created",
			at: timestamp,
			status: "draft",
		});
		if (!this.executor) return { ...job };
		try {
			const result = await this.runExclusive(jobId, () => this.executor?.submit(normalizedSpec, host));
			const submitted = this.updateJob(job, {
				status: result?.status ?? "queued",
				remoteId: result?.remoteId,
				pid: result?.pid,
				startedAt: result?.startedAt ?? now(),
				updatedAt: now(),
			});
			await this.persistJob(submitted);
			await this.appendEvent({
				id: randomUUID(),
				jobId,
				type: "submitted",
				at: now(),
				status: statusOf(submitted),
			});
			return { ...submitted };
		} catch (error) {
			// An unknown side-effect result must be reconciled rather than replayed.
			const unknown = this.updateJob(job, { status: "unknown", updatedAt: now(), error: String(error) });
			await this.persistJob(unknown);
			await this.appendEvent({
				id: randomUUID(),
				jobId,
				type: "error",
				at: now(),
				status: "unknown",
				detail: String(error),
			});
			return { ...unknown };
		}
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
		if (!this.initialized) {
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
		const candidates = jobId ? [await this.getJob(jobId)] : [...this.jobs.values()];
		const result: JobRecord[] = [];
		for (const current of candidates) {
			if (!current) continue;
			const status = statusOf(current);
			if (!POLLABLE.has(status) || !this.executor) {
				result.push({ ...current });
				continue;
			}
			const host = this.hostCache.get(String(asRecord(current).hostAlias));
			if (!host) {
				result.push({ ...current });
				continue;
			}
			try {
				const remote = await this.runExclusive(String(asRecord(current).jobId), () =>
					this.executor?.status(current, host),
				);
				if (!remote) {
					result.push({ ...current });
					continue;
				}
				const nextStatus = mergeStatus(status, remote.status);
				const updated = this.updateJob(current, {
					...remote,
					status: nextStatus,
					updatedAt: now(),
				});
				await this.persistJob(updated);
				if (nextStatus !== status)
					await this.appendEvent({
						id: randomUUID(),
						jobId: String(asRecord(current).jobId),
						type: "status",
						at: now(),
						status: nextStatus,
					});
				result.push({ ...updated });
			} catch (error) {
				const updated = this.updateJob(current, {
					status: "unknown",
					updatedAt: now(),
					error: String(error),
				});
				await this.persistJob(updated);
				await this.appendEvent({
					id: randomUUID(),
					jobId: String(asRecord(current).jobId),
					type: "error",
					at: now(),
					status: "unknown",
					detail: String(error),
				});
				result.push({ ...updated });
			}
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
		const job = await this.requireJob(jobId);
		if (isTerminal(statusOf(job))) return job;
		const host = await this.requireHost(String(asRecord(job).hostAlias));
		const cancelling = this.updateJob(job, { status: "cancelling", updatedAt: now() });
		await this.persistJob(cancelling);
		if (!this.executor?.cancel) return cancelling;
		try {
			const result = await this.runExclusive(jobId, () => this.executor?.cancel?.(cancelling, host));
			const cancelled = this.updateJob(cancelling, {
				...(result ?? {}),
				status: result?.status ?? "cancelled",
				updatedAt: now(),
			});
			await this.persistJob(cancelled);
			await this.appendEvent({
				id: randomUUID(),
				jobId,
				type: "cancelled",
				at: now(),
				status: statusOf(cancelled),
			});
			return cancelled;
		} catch (error) {
			const unknown = this.updateJob(cancelling, {
				status: "unknown",
				updatedAt: now(),
				error: String(error),
			});
			await this.persistJob(unknown);
			return unknown;
		}
	}

	cancelJob(jobId: string): Promise<JobRecord> {
		return this.cancel(jobId);
	}

	async collect(jobId: string, options: ComputeCollectOptions): Promise<ComputeCollectResult> {
		const job = await this.requireJob(jobId);
		if (statusOf(job) !== "succeeded")
			throw new Error("Artifacts can only be collected from a succeeded job");
		if (!this.executor?.collect) throw new Error("Compute runner does not provide artifact collection");
		const targetDir = resolve(options.targetDir);
		await mkdir(targetDir, { recursive: true });
		const host = await this.requireHost(String(asRecord(job).hostAlias));
		const result = await this.runExclusive(jobId, async () =>
			this.executor?.collect?.(job, host, { ...options, targetDir }),
		);
		if (!result) throw new Error("Compute runner returned no artifact manifest");
		validateArtifactManifest(result.manifest, targetDir, options.expected, options.maxBytes);
		await verifyArtifactChecksums(result.manifest, targetDir);
		await this.appendEvent({ id: randomUUID(), jobId, type: "collected", at: now(), status: "succeeded" });
		return result;
	}

	collectJob(input: ComputeCollectOptions & { jobId: string }): Promise<ComputeCollectResult> {
		return this.collect(input.jobId, input);
	}

	async listWorkflowModules(): Promise<readonly ComputeWorkflowModule[]> {
		return (await this.executor?.listWorkflowModules?.()) ?? [];
	}

	onEvent(handler: (event: ComputeEvent) => void): () => void {
		this.events.add(handler);
		return () => this.events.delete(handler);
	}

	async dispose(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;
		if (this.pollTimer) clearInterval(this.pollTimer);
		this.pollTimer = undefined;
		this.events.clear();
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
		await this.eventStore(event.jobId).update((events) => [...events, event]);
		for (const handler of this.events) {
			try {
				handler(event);
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

/** Verify collection paths and sha256 before exposing artifacts to host readers. */
export function validateArtifactManifest(
	manifest: ArtifactManifest,
	targetDir: string,
	expected?: readonly string[],
	maxBytes = 500 * 1024 * 1024,
): void {
	const files = (asRecord(manifest).entries ?? []) as unknown;
	if (!Array.isArray(files)) throw new Error("Invalid artifact manifest");
	const expectedSet = expected ? new Set(expected) : undefined;
	const seen = new Set<string>();
	let totalBytes = 0;
	for (const item of files) {
		const record = asRecord(item);
		const path = record.path;
		if (typeof path !== "string" || !path || isAbsolute(path) || path.split(/[\\/]/).includes(".."))
			throw new Error("Artifact manifest contains an unsafe path");
		if (expectedSet && !expectedSet.has(path)) throw new Error(`Unexpected artifact: ${path}`);
		seen.add(path);
		const size = record.bytes ?? record.size;
		if (typeof size === "number" && Number.isFinite(size) && size >= 0) totalBytes += size;
		const target = resolve(targetDir, path);
		if (relative(targetDir, target).startsWith("..") || isAbsolute(relative(targetDir, target)))
			throw new Error("Artifact escapes target directory");
		const checksum = record.sha256 ?? record.checksum;
		if (typeof checksum !== "string" || !/^[a-f0-9]{64}$/i.test(checksum))
			throw new Error(`Invalid checksum for artifact: ${path}`);
	}
	for (const path of expectedSet ?? []) if (!seen.has(path)) throw new Error(`Missing artifact: ${path}`);
	if (totalBytes > maxBytes) throw new Error(`Artifacts exceed collection limit: ${maxBytes} bytes`);
}

async function verifyArtifactChecksums(manifest: ArtifactManifest, targetDir: string): Promise<void> {
	const files = (asRecord(manifest).entries ?? []) as unknown;
	if (!Array.isArray(files)) throw new Error("Invalid artifact manifest");
	for (const item of files) {
		const record = asRecord(item);
		const path = record.path;
		if (typeof path !== "string") continue;
		const expected = record.sha256 ?? record.checksum;
		if (expected === undefined) continue;
		const fullPath = resolve(targetDir, path);
		const info = await lstat(fullPath);
		if (info.isSymbolicLink() || !info.isFile()) throw new Error(`Artifact is not a regular file: ${path}`);
		const actual = artifactSha256(await readFile(fullPath));
		if (actual.toLowerCase() !== String(expected).toLowerCase())
			throw new Error(`Artifact checksum mismatch: ${path}`);
	}
}

export function artifactSha256(content: Uint8Array): string {
	return createHash("sha256").update(content).digest("hex");
}
