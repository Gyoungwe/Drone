import { randomUUID } from "node:crypto";
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

export interface ComputeJobFilter {
	states?: readonly ComputeJob["state"][];
	hostId?: ComputeId;
	limit?: number;
}

/** Adapter-owned approval context for operations that can contact a host. */
export interface ComputeRemoteOperation {
	kind: "probe_host" | "cancel_job" | "open_terminal" | "write_terminal" | "close_terminal";
	hostId?: ComputeId;
	jobId?: ComputeId;
	terminalId?: ComputeId;
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
