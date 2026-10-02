import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { HostCapability, HostProfile, JobRecord } from "@drone/compute";
import type {
	ComputeHealthSnapshot,
	ComputeHost,
	ComputeHostInput,
	ComputeId,
	ComputeJob,
	ComputeLogChunk,
	ComputeOnboardingStatus,
	ComputeOnboardingStep,
	ComputeTerminal,
} from "@drone/shared";
import { JsonStore } from "../json-store";
import { getAgentDir } from "../session-engine/engine";
import type { StorageRegistry } from "../storage/registry";
import type { ComputeExecutor, ComputeService, ComputeServicePort } from "./compute";

export interface ComputeJobFilter {
	states?: readonly ComputeJob["state"][];
	hostId?: ComputeId;
	limit?: number;
}

/** Adapter-owned approval context for operations that can contact a host. */
export interface ComputeRemoteOperation {
	kind: "probe_host" | "get_logs" | "cancel_job" | "open_terminal" | "write_terminal" | "close_terminal";
	hostId?: ComputeId;
	jobId?: ComputeId;
	terminalId?: ComputeId;
}

/** Dependencies for the renderer projection over B1's durable compute service. */
export interface ComputeHostAdapterOptions {
	service: ComputeServicePort;
	storage?: StorageRegistry;
	agentDir?: string;
	/** The host/session approval boundary. It must reject when no task approval exists. */
	authorizeRemoteOperation?: (operation: ComputeRemoteOperation) => Promise<void>;
}

export interface ComputeHostAdapter {
	init?(): Promise<void>;
	dispose?(): Promise<void> | void;
	listHosts(): Promise<ComputeHost[]>;
	getHost(id: ComputeId): Promise<ComputeHost | null>;
	saveHost(input: ComputeHostInput): Promise<ComputeHost>;
	removeHost(id: ComputeId): Promise<void>;
	probeHost(id: ComputeId): Promise<ComputeHost>;
	getHealthSnapshot(): Promise<ComputeHealthSnapshot>;
	listJobs(filter?: ComputeJobFilter): Promise<ComputeJob[]>;
	getJob(id: ComputeId): Promise<ComputeJob | null>;
	getLogs(id: ComputeId, cursor?: string): Promise<ComputeLogChunk>;
	cancelJob(id: ComputeId): Promise<void>;
	openTerminal(input: {
		hostId: ComputeId;
		cwd?: string;
		mode?: "shell" | "command";
	}): Promise<ComputeTerminal>;
	getTerminal(id: ComputeId): Promise<ComputeTerminal | null>;
	writeTerminal(id: ComputeId, text: string): Promise<void>;
	closeTerminal(id: ComputeId): Promise<void>;
	getOnboardingStatus(): Promise<ComputeOnboardingStatus[]>;
	checkOnboardingStep(step: ComputeOnboardingStep): Promise<ComputeOnboardingStatus>;
	/** Throws unless the current task/session approval covers this remote effect. */
	authorizeRemoteOperation(operation: ComputeRemoteOperation): Promise<void>;
	onHealthChanged(handler: (snapshot: ComputeHealthSnapshot) => void): () => void;
	onJobUpdated(handler: (job: ComputeJob) => void): () => void;
	onLogChunk(handler: (chunk: ComputeLogChunk) => void): () => void;
	onTerminalOutput(
		handler: (event: { terminalId: ComputeId; text: string; truncated: boolean }) => void,
	): () => void;
	onTerminalClosed(handler: (event: { terminalId: ComputeId }) => void): () => void;
}

type PersistedHost = ComputeHost;

const MAX_LOG_BYTES = 1_048_576;
const HOST_METADATA_STORAGE_ID = "agent-compute-projection-hosts";

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function iso(value: unknown, fallback = new Date().toISOString()): string {
	if (typeof value === "string" && value.length > 0) return value;
	if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString();
	return fallback;
}

function unavailable(operation: string, cause?: unknown): Error {
	const suffix = cause instanceof Error && cause.message ? `: ${cause.message}` : "";
	return new Error(`Compute service unavailable for ${operation}${suffix}`);
}

function profileKind(profile: HostProfile): ComputeHost["kind"] {
	if (profile.alias === "local" || profile.host === "local") return "local";
	return "ssh";
}

function statusOf(job: JobRecord): string {
	const status = asRecord(job).status;
	return typeof status === "string" ? status : "unknown";
}

function toUiState(status: string): ComputeJob["state"] {
	switch (status) {
		case "running":
		case "collecting":
			return "running";
		case "succeeded":
			return "succeeded";
		case "failed":
		case "blocked":
		case "partial":
			return "failed";
		case "cancelled":
			return "cancelled";
		case "unknown":
			return "unknown";
		default:
			return "queued";
	}
}

function workflowLabel(job: JobRecord): string | undefined {
	const workflow = asRecord(asRecord(job).spec).workflow;
	const row = asRecord(workflow);
	if (typeof row.name === "string") return row.name;
	const modules = Array.isArray(row.modules) ? row.modules : [];
	const first = asRecord(modules[0]);
	return typeof first.name === "string" ? first.name : undefined;
}

function operationKey(operation: ComputeRemoteOperation): string {
	return JSON.stringify(operation);
}

function capabilityNames(capability: HostCapability): ComputeHost["capabilities"] {
	const result: ComputeHost["capabilities"] = [
		{
			name: "runner",
			version: capability.runnerVersion,
			available: true,
			details: `protocol v${capability.protocolVersion}`,
		},
		{
			name: "scheduler",
			available: capability.scheduler !== "unsupported",
			details: capability.scheduler,
		},
	];
	if (capability.containerRuntime)
		result.push({ name: "container", version: capability.containerRuntime, available: true });
	if (capability.nextflowVersion)
		result.push({ name: "nextflow", version: capability.nextflowVersion, available: true });
	return result;
}

function capabilityResources(capability: HostCapability): ComputeHost["resources"] {
	const resources: NonNullable<ComputeHost["resources"]> = {};
	if (typeof capability.cpuCount === "number" && Number.isFinite(capability.cpuCount))
		resources.cpuCores = Math.max(1, Math.floor(capability.cpuCount));
	if (typeof capability.memoryBytes === "number" && Number.isFinite(capability.memoryBytes))
		resources.memoryBytes = Math.max(0, Math.floor(capability.memoryBytes));
	if (typeof capability.diskBytes === "number" && Number.isFinite(capability.diskBytes))
		resources.diskFreeBytes = Math.max(0, Math.floor(capability.diskBytes));
	return Object.keys(resources).length > 0 ? resources : undefined;
}

function computeJob(job: JobRecord): ComputeJob {
	const row = asRecord(job);
	const spec = asRecord(row.spec);
	const resources = asRecord(spec.resources);
	const startedAt = row.startedAt ?? row.processStartedAt;
	const manifest = asRecord(row.artifacts);
	const entries = Array.isArray(manifest.entries) ? manifest.entries : [];
	const artifacts = entries.flatMap((entry) => {
		const item = asRecord(entry);
		if (typeof item.path !== "string" || item.path.length === 0) return [];
		return [
			{
				name: item.path.split(/[\\/]/).pop() || item.path,
				path: item.path,
				...(typeof item.sha256 === "string" ? { sha256: item.sha256 } : {}),
			},
		];
	});
	const budget = {
		coreHours:
			typeof resources.cpus === "number" && typeof resources.wallTimeSeconds === "number"
				? (resources.cpus * resources.wallTimeSeconds) / 3600
				: 0,
		wallMinutes: typeof resources.wallTimeSeconds === "number" ? resources.wallTimeSeconds / 60 : 0,
		diskBytes: typeof manifest.totalBytes === "number" ? Math.max(0, manifest.totalBytes) : 0,
	};
	const error = row.error;
	const summary =
		typeof error === "string"
			? error
			: typeof asRecord(error).message === "string"
				? String(asRecord(error).message)
				: undefined;
	return {
		id: String(row.jobId),
		hostId: String(row.hostAlias),
		state: toUiState(statusOf(job)),
		...(typeof row.taskId === "string" ? { taskId: row.taskId } : {}),
		...(typeof row.sessionId === "string" ? { sessionId: row.sessionId } : {}),
		...(workflowLabel(job) ? { label: workflowLabel(job) } : {}),
		...(startedAt !== undefined ? { startedAt: iso(startedAt) } : {}),
		...(statusOf(job) === "succeeded" || statusOf(job) === "failed" || statusOf(job) === "cancelled"
			? { finishedAt: iso(row.updatedAt) }
			: {}),
		...(typeof row.exitCode === "number" ? { exitCode: row.exitCode } : {}),
		budget,
		...(summary ? { publicSummary: summary } : {}),
		artifacts,
		updatedAt: iso(row.updatedAt),
	};
}

/**
 * Renderer-facing projection over B1's ComputeServicePort. The B1 service is
 * the source of truth for host profiles, jobs and runner events; this class
 * only persists the fields that belong to the desktop contract and maps the
 * richer runner state into the smaller UI state vocabulary.
 */
export class ComputeServiceAdapter implements ComputeHostAdapter {
	private readonly service: ComputeServicePort;
	private readonly metadataStore: JsonStore<PersistedHost[]>;
	private readonly metadata = new Map<string, PersistedHost>();
	private readonly healthHandlers = new Set<(snapshot: ComputeHealthSnapshot) => void>();
	private readonly jobHandlers = new Set<(job: ComputeJob) => void>();
	private readonly logHandlers = new Set<(chunk: ComputeLogChunk) => void>();
	private readonly approved = new Set<string>();
	private readonly authorize?: (operation: ComputeRemoteOperation) => Promise<void>;
	private unsubscribeService?: () => void;
	private initPromise?: Promise<void>;
	private initialized = false;
	private disposed = false;

	constructor(options: ComputeHostAdapterOptions) {
		this.service = options.service;
		this.authorize = options.authorizeRemoteOperation;
		const agentDir = options.agentDir ?? getAgentDir();
		const path = join(agentDir, "compute", "desktop-hosts.json");
		if (options.storage && !options.storage.get(HOST_METADATA_STORAGE_ID))
			options.storage.register({
				id: HOST_METADATA_STORAGE_ID,
				path,
				owner: "compute/desktop-projection",
				schema: 1,
				sensitivity: "config",
			});
		this.metadataStore = new JsonStore<PersistedHost[]>({
			path,
			storageId: HOST_METADATA_STORAGE_ID,
			defaultValue: () => [],
		});
	}

	async init(): Promise<void> {
		if (this.initialized) return;
		if (this.initPromise) return this.initPromise;
		this.initPromise = (async () => {
			await this.service.init();
			for (const value of await this.metadataStore.read()) {
				const host = this.normalizePersistedHost(value);
				if (host) this.metadata.set(host.alias, host);
			}
			this.unsubscribeService = this.service.onEvent((event) => {
				if (event.type === "logs") return;
				void this.emitJob(event.jobId);
			});
			this.initialized = true;
			await this.syncMetadata();
		})().catch((error) => {
			this.initPromise = undefined;
			throw error;
		});
		return this.initPromise;
	}

	async dispose(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;
		this.unsubscribeService?.();
		this.unsubscribeService = undefined;
		this.healthHandlers.clear();
		this.jobHandlers.clear();
		this.logHandlers.clear();
		this.approved.clear();
	}

	async listHosts(): Promise<ComputeHost[]> {
		await this.init();
		const profiles = await this.service.listHosts();
		await this.syncMetadata(profiles);
		return profiles.map((profile) => this.projectHost(profile));
	}

	async getHost(id: ComputeId): Promise<ComputeHost | null> {
		await this.init();
		const profile = await this.service.getHost(id);
		if (!profile) return null;
		await this.syncMetadata([profile]);
		return this.projectHost(profile);
	}

	async saveHost(input: ComputeHostInput): Promise<ComputeHost> {
		await this.init();
		if (
			input.endpoint &&
			(input.endpoint.includes("@") ||
				/(?:token|password|secret|private[_-]?key)\s*[=:]/i.test(input.endpoint))
		)
			throw new Error("Host endpoints cannot contain credentials or private keys.");
		const previous = await this.service.getHost(input.alias);
		const profile: HostProfile = {
			alias: input.alias,
			host: input.endpoint ?? previous?.host ?? (input.kind === "local" ? "local" : input.alias),
			...((input.port ?? previous?.port) ? { port: input.port ?? previous?.port } : {}),
			...((input.user ?? previous?.username) ? { username: input.user ?? previous?.username } : {}),
			...(input.kind === "ssh"
				? { transport: "builtin-ssh" as const }
				: input.kind === "scheduler"
					? { transport: "openssh" as const }
					: previous?.transport
						? { transport: previous.transport }
						: {}),
		};
		const stored = await this.service.upsertHost(profile);
		const old = this.metadata.get(stored.alias);
		const timestamp = new Date().toISOString();
		const host: ComputeHost = {
			...(old ?? this.defaultHost(stored)),
			id: stored.alias,
			alias: stored.alias,
			displayName: input.displayName,
			kind: input.kind,
			...(input.endpoint ? { endpoint: input.endpoint } : {}),
			...(input.port ? { port: input.port } : {}),
			...(input.user ? { user: input.user } : {}),
			...(input.workspaceRoot ? { workspaceRoot: input.workspaceRoot } : {}),
			managed: input.managed ?? old?.managed ?? true,
			createdAt: old?.createdAt ?? timestamp,
			updatedAt: timestamp,
		};
		this.metadata.set(stored.alias, host);
		await this.persistMetadata();
		this.emitHealth();
		return structuredClone(host);
	}

	async removeHost(id: ComputeId): Promise<void> {
		await this.init();
		const removed = await this.service.removeHost(id);
		if (!removed) throw new Error(`Compute host not found: ${id}`);
		this.metadata.delete(id);
		await this.persistMetadata();
		this.emitHealth();
	}

	async probeHost(id: ComputeId): Promise<ComputeHost> {
		await this.init();
		await this.requireRunner("host probe", "probeHost");
		await this.requireAuthorization({ kind: "probe_host", hostId: id });
		try {
			const capability = await this.service.probeHost(id);
			const profile = await this.service.getHost(id);
			if (!profile) throw new Error(`Compute host not found: ${id}`);
			const existing = this.projectHost(profile);
			const details = [
				`runner ${capability.runnerVersion}`,
				`protocol v${capability.protocolVersion}`,
				`scheduler ${capability.scheduler}`,
				...(capability.nextflowVersion ? [`Nextflow ${capability.nextflowVersion}`] : []),
			].join("; ");
			const updated: ComputeHost = {
				...existing,
				health: {
					status: capability.scheduler === "unsupported" ? "degraded" : "healthy",
					checkedAt: iso(capability.probedAt),
					version: capability.runnerVersion,
					details,
				},
				capabilities: capabilityNames(capability),
				...(capabilityResources(capability) ? { resources: capabilityResources(capability) } : {}),
				updatedAt: new Date().toISOString(),
			};
			this.metadata.set(updated.alias, updated);
			await this.persistMetadata();
			this.emitHealth();
			return structuredClone(updated);
		} catch (error) {
			await this.recordProbeFailure(id, error);
			throw unavailable("host probe", error);
		}
	}

	async getHealthSnapshot(): Promise<ComputeHealthSnapshot> {
		const hosts = await this.listHosts();
		return {
			checkedAt: new Date().toISOString(),
			hosts: hosts.map((host) => ({ id: host.id, alias: host.alias, ...host.health })),
		};
	}

	async listJobs(filter?: ComputeJobFilter): Promise<ComputeJob[]> {
		await this.init();
		const states = filter?.states ? new Set(filter.states) : undefined;
		const jobs = (await this.service.listJobs())
			.map(computeJob)
			.filter((job) => !states || states.has(job.state))
			.filter((job) => !filter?.hostId || job.hostId === filter.hostId);
		return jobs.slice(0, Math.min(filter?.limit ?? 100, 100));
	}

	async getJob(id: ComputeId): Promise<ComputeJob | null> {
		await this.init();
		const job = await this.service.getJob(id);
		return job ? computeJob(job) : null;
	}

	async getLogs(id: ComputeId, cursor = ""): Promise<ComputeLogChunk> {
		await this.init();
		await this.requireRunner("job logs", "logs");
		await this.requireAuthorization({ kind: "get_logs", jobId: id });
		try {
			const result = await this.service.logs(id, cursor);
			const pieces = result.events.map((event) => (typeof event.text === "string" ? event.text : ""));
			const fullText = pieces.join("");
			const truncated = Boolean(
				fullText.length > MAX_LOG_BYTES || pieces.some((piece) => piece.length > MAX_LOG_BYTES),
			);
			const chunk: ComputeLogChunk = {
				jobId: id,
				cursor: result.cursor ?? cursor,
				text: fullText.slice(0, MAX_LOG_BYTES),
				truncated,
				at: new Date().toISOString(),
			};
			for (const handler of this.logHandlers) handler(structuredClone(chunk));
			return chunk;
		} catch (error) {
			throw unavailable("job logs", error);
		}
	}

	async cancelJob(id: ComputeId): Promise<void> {
		await this.init();
		await this.requireRunner("job cancellation", "cancel");
		await this.requireAuthorization({ kind: "cancel_job", jobId: id });
		try {
			const job = await this.service.cancel(id);
			this.emitJobValue(computeJob(job));
		} catch (error) {
			throw unavailable("job cancellation", error);
		}
	}

	async openTerminal(): Promise<ComputeTerminal> {
		throw unavailable("terminal transport");
	}

	async getTerminal(): Promise<ComputeTerminal | null> {
		return null;
	}

	async writeTerminal(): Promise<void> {
		throw unavailable("terminal transport");
	}

	async closeTerminal(): Promise<void> {
		throw unavailable("terminal transport");
	}

	async getOnboardingStatus(): Promise<ComputeOnboardingStatus[]> {
		const hosts = await this.listHosts();
		const remote =
			hosts.length === 0
				? { state: "not_configured" as const, summary: "No compute host has been configured." }
				: hosts.some((host) => host.authState === "ready" && host.health.status === "healthy")
					? { state: "ready" as const, summary: "A compute host is connected and healthy." }
					: { state: "needs_action" as const, summary: "Configure and authenticate a compute host." };
		return [
			{ step: "model", state: "not_configured", summary: "Compute does not manage model configuration." },
			{ step: "project", state: "not_configured", summary: "Compute does not manage project configuration." },
			{
				step: "knowledge",
				state: "not_configured",
				summary: "Compute does not manage knowledge configuration.",
			},
			{
				step: "literature",
				state: "not_configured",
				summary: "Compute does not manage literature configuration.",
			},
			{ step: "mcp", state: "not_configured", summary: "Compute does not manage MCP configuration." },
			{ step: "remote-host", ...remote },
			{ step: "example-task", state: "not_configured", summary: "No example compute task is configured." },
		];
	}

	async checkOnboardingStep(step: ComputeOnboardingStep): Promise<ComputeOnboardingStatus> {
		return (
			(await this.getOnboardingStatus()).find((item) => item.step === step) ?? {
				step,
				state: "not_configured",
				summary: "This onboarding step is not configured.",
			}
		);
	}

	async authorizeRemoteOperation(operation: ComputeRemoteOperation): Promise<void> {
		if (!this.authorize) throw new Error("Compute remote operation is not authorized");
		await this.authorize(operation);
		this.approved.add(operationKey(operation));
	}

	onHealthChanged(handler: (snapshot: ComputeHealthSnapshot) => void): () => void {
		this.healthHandlers.add(handler);
		return () => this.healthHandlers.delete(handler);
	}

	onJobUpdated(handler: (job: ComputeJob) => void): () => void {
		this.jobHandlers.add(handler);
		return () => this.jobHandlers.delete(handler);
	}

	onLogChunk(handler: (chunk: ComputeLogChunk) => void): () => void {
		this.logHandlers.add(handler);
		return () => this.logHandlers.delete(handler);
	}

	onTerminalOutput(): () => void {
		return () => {};
	}

	onTerminalClosed(): () => void {
		return () => {};
	}

	private async requireAuthorization(operation: ComputeRemoteOperation): Promise<void> {
		const key = operationKey(operation);
		if (this.approved.delete(key)) return;
		await this.authorizeRemoteOperation(operation);
	}

	private async requireRunner(operation: string, method: keyof ComputeExecutor): Promise<void> {
		const service = this.service as ComputeService & {
			hasExecutor?: () => boolean;
			hasExecutorMethod?: (name: keyof ComputeExecutor) => boolean;
		};
		if (service.hasExecutor && !service.hasExecutor()) throw unavailable(operation);
		if (service.hasExecutorMethod && !service.hasExecutorMethod(method)) throw unavailable(operation);
	}

	private defaultHost(profile: HostProfile): ComputeHost {
		const timestamp = new Date().toISOString();
		return {
			id: profile.alias,
			alias: profile.alias,
			displayName: profile.alias,
			kind: profileKind(profile),
			...(profile.host ? { endpoint: profile.host } : {}),
			...(profile.port ? { port: profile.port } : {}),
			...(profile.username ? { user: profile.username } : {}),
			authState: "not_configured",
			managed: true,
			health: { status: "unknown", details: "Host has not been probed." },
			capabilities: [],
			createdAt: timestamp,
			updatedAt: timestamp,
		};
	}

	private projectHost(profile: HostProfile): ComputeHost {
		const existing = this.metadata.get(profile.alias);
		if (existing) return structuredClone(existing);
		return this.defaultHost(profile);
	}

	private normalizePersistedHost(value: unknown): PersistedHost | undefined {
		const row = asRecord(value);
		if (
			typeof row.alias !== "string" ||
			typeof row.id !== "string" ||
			typeof row.displayName !== "string" ||
			!row.health ||
			!Array.isArray(row.capabilities)
		)
			return undefined;
		return value as PersistedHost;
	}

	private async syncMetadata(profiles?: readonly HostProfile[]): Promise<void> {
		const values = profiles ?? (await this.service.listHosts());
		const aliases = new Set(values.map((profile) => profile.alias));
		let changed = false;
		for (const profile of values) {
			if (!this.metadata.has(profile.alias)) {
				this.metadata.set(profile.alias, this.defaultHost(profile));
				changed = true;
			}
		}
		for (const alias of this.metadata.keys()) {
			if (!aliases.has(alias)) {
				this.metadata.delete(alias);
				changed = true;
			}
		}
		if (changed) await this.persistMetadata();
	}

	private async persistMetadata(): Promise<void> {
		await this.metadataStore.write([...this.metadata.values()].map((host) => structuredClone(host)));
	}

	private async recordProbeFailure(id: ComputeId, error: unknown): Promise<void> {
		const profile = await this.service.getHost(id);
		if (!profile) return;
		const host = this.projectHost(profile);
		const details = error instanceof Error ? error.message : String(error);
		this.metadata.set(id, {
			...host,
			health: {
				...host.health,
				status: "offline",
				checkedAt: new Date().toISOString(),
				details,
				errorCode: "probe_failed",
			},
			updatedAt: new Date().toISOString(),
		});
		await this.persistMetadata();
		this.emitHealth();
	}

	private emitHealth(): void {
		void this.getHealthSnapshot().then((snapshot) => {
			for (const handler of this.healthHandlers) handler(snapshot);
		});
	}

	private async emitJob(id: string): Promise<void> {
		const job = await this.service.getJob(id);
		if (job) this.emitJobValue(computeJob(job));
	}

	private emitJobValue(job: ComputeJob): void {
		for (const handler of this.jobHandlers) handler(structuredClone(job));
	}
}

export function createComputeServiceAdapter(options: ComputeHostAdapterOptions): ComputeHostAdapter {
	return new ComputeServiceAdapter(options);
}

const NOW = () => new Date().toISOString();

/**
 * B2 composition fallback. B1 replaces this adapter with the JsonStore/SSH/
 * runner implementation; keeping the port here lets desktop and renderer land
 * without copying a second compute backend. It intentionally exposes no host
 * and refuses side effects until a real adapter is installed.
 */
export function createUnavailableComputeService(): ComputeHostAdapter {
	const unavailable = (operation: string): never => {
		throw new Error(`Compute service is unavailable: ${operation}`);
	};
	const hosts = new Map<string, ComputeHost>();
	const onboarding: ComputeOnboardingStatus[] = [
		{ step: "model", state: "ready", summary: "The local model configuration is available." },
		{ step: "project", state: "ready", summary: "The current project is available." },
		{ step: "knowledge", state: "ready", summary: "Knowledge services are available." },
		{ step: "literature", state: "ready", summary: "Literature services are available." },
		{ step: "mcp", state: "ready", summary: "MCP is available." },
		{ step: "remote-host", state: "needs_action", summary: "Add and authenticate a remote compute host." },
		{ step: "example-task", state: "ready", summary: "Example tasks can be planned locally." },
	];
	const now = () => new Date().toISOString();
	const cloneHost = (host: ComputeHost): ComputeHost => structuredClone(host);
	const emptyUnsubscribe = () => () => {};
	return {
		init: async () => {},
		dispose: async () => {},
		listHosts: async () => [...hosts.values()].map(cloneHost),
		getHost: async (id) => {
			const host = hosts.get(id);
			return host ? cloneHost(host) : null;
		},
		saveHost: async (input) => {
			if (
				input.endpoint &&
				(input.endpoint.includes("@") ||
					/(?:token|password|secret|private[_-]?key)\s*[=:]/i.test(input.endpoint))
			)
				throw new Error("Host endpoints cannot contain credentials or private keys.");
			const previous = [...hosts.values()].find((host) => host.alias === input.alias);
			const timestamp = now();
			const host: ComputeHost = {
				id: previous?.id ?? `host-${randomUUID()}`,
				alias: input.alias,
				displayName: input.displayName,
				kind: input.kind,
				...(input.endpoint ? { endpoint: input.endpoint } : {}),
				...(input.port ? { port: input.port } : {}),
				...(input.user ? { user: input.user } : {}),
				...(input.workspaceRoot ? { workspaceRoot: input.workspaceRoot } : {}),
				authState: previous?.authState ?? "not_configured",
				managed: input.managed ?? previous?.managed ?? true,
				health: previous?.health ?? { status: "unknown", details: "Host has not been probed." },
				capabilities: previous?.capabilities ?? [],
				...(previous?.resources ? { resources: previous.resources } : {}),
				createdAt: previous?.createdAt ?? timestamp,
				updatedAt: timestamp,
			};
			hosts.set(host.id, host);
			return cloneHost(host);
		},
		removeHost: async (id) => {
			if (!hosts.delete(id)) unavailable("removeHost");
		},
		probeHost: async (id) => {
			const host = hosts.get(id);
			if (!host) return unavailable("probeHost");
			const updated = {
				...host,
				health: {
					...host.health,
					status: "unknown" as const,
					checkedAt: now(),
					details: "No remote probe adapter is configured.",
				},
				updatedAt: now(),
			};
			hosts.set(id, updated);
			return cloneHost(updated);
		},
		getHealthSnapshot: async () => ({
			checkedAt: now(),
			hosts: [...hosts.values()].map((host) => ({ id: host.id, alias: host.alias, ...host.health })),
		}),
		listJobs: async () => [],
		getJob: async () => null,
		getLogs: async (id, cursor = "") => ({ jobId: id, cursor, text: "", truncated: false, at: NOW() }),
		cancelJob: async () => unavailable("cancelJob"),
		openTerminal: async () => unavailable("openTerminal"),
		getTerminal: async () => null,
		writeTerminal: async () => unavailable("writeTerminal"),
		closeTerminal: async () => unavailable("closeTerminal"),
		getOnboardingStatus: async () => structuredClone(onboarding),
		checkOnboardingStep: async (step) =>
			structuredClone(
				onboarding.find((item) => item.step === step) ?? {
					step,
					state: "not_configured",
					summary: "This onboarding step is not configured.",
				},
			),
		authorizeRemoteOperation: async () => {},
		onHealthChanged: emptyUnsubscribe,
		onJobUpdated: emptyUnsubscribe,
		onLogChunk: emptyUnsubscribe,
		onTerminalOutput: emptyUnsubscribe,
		onTerminalClosed: emptyUnsubscribe,
	};
}
