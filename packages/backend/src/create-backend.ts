import { join } from "node:path";
import type { ControlledKernelRunner } from "@drone/discovery";
import type { ExperienceStorePort } from "@drone/knowledge";
import type {
	AskRequest,
	AskResponse,
	ContextManagerMode,
	DroneRuntime,
	LoginEventPayload,
	McpStatus,
	PermissionAnswer,
	PermissionMode,
	PermissionRequest,
	PermissionResolved,
	SessionEvent,
	SessionMessage,
	SessionsApi,
	TrustAnswer,
	TrustRequest,
} from "@drone/shared";
import { createDefaultComputeExecutor } from "./compute/default-executor";
import type { DiagnosticsServicePort } from "./diagnostics";
import {
	type DiscoveryAuthorization,
	DiscoveryService,
	type DiscoveryServicePort,
} from "./discovery/service";
import type { KnowledgeUiServicePort } from "./knowledge/ui";
import type { McpServicePort } from "./mcp/service";
import { createDroneRuntime } from "./runtime";
import type { ApprovalService } from "./services/approvals";
import { type ComputeExecutor, ComputeService, type ComputeServicePort } from "./services/compute";
import {
	type ComputeHostAdapter,
	type ComputeRemoteOperation,
	createComputeServiceAdapter,
} from "./services/compute-adapter";
import {
	type ComputeDataDesignServicePort,
	createComputeDataDesignService,
} from "./services/compute-data-design";
import {
	type ComputeExperienceRecorder,
	createComputeExperienceRecorder,
} from "./services/compute-experience";
import { InquiryService, type InquiryServicePort } from "./services/inquiry";
import { computeInquiryMetadata, createInquiryComputeRerun } from "./services/inquiry-compute";
import type { InstitutionalServicePort } from "./services/institutional";
import type { KnowledgeSessionServicePort } from "./services/knowledge-session";
import type { PackageServicePort } from "./services/packages";
import { PermissionSettingsService } from "./services/permissions";
import type { ProjectTrustService } from "./services/project-trust";
import type { SessionLifecycleServicePort } from "./services/session-lifecycle";
import type { SessionPermissionServicePort } from "./services/session-permissions";
import type { SubagentServicePort } from "./services/subagents";
import type { ZoteroServicePort } from "./services/zotero";
import type { SessionEngine } from "./session-engine/engine";
import { getAgentDir } from "./session-engine/engine";
import { SessionService, type SessionServiceOptions } from "./session-service";
import type { LoginServicePort } from "./settings/login";
import type { ModelSettingsServicePort } from "./settings/models";
import type { SettingsServicePort } from "./settings/settings";

/**
 * Transitional composition root for the v2 migration.
 *
 * The existing PiBackend remains the compatibility façade while callers move
 * to explicit service groups. Keeping construction here gives desktop, LAN
 * and future CLI hosts one place to assemble the runtime and makes the final
 * façade removal an internal change.
 */
/**
 * Host-facing session boundary.  This is deliberately structural: desktop,
 * LAN, and future hosts depend on the transport/session contract and lifecycle
 * events, while the concrete PiBackend remains an internal composition-root
 * implementation.  Compatibility-only domain delegates are intentionally not
 * part of this port.
 */
export interface SessionServicePort extends Omit<SessionsApi, "replySubagentSupervisor"> {
	/**
	 * Host-facing session boundary. Domain services intentionally do not live
	 * here; consumers should obtain them from BackendServices. The concrete
	 * PiBackend still exposes compatibility properties at runtime, but they are
	 * not part of the host contract.
	 */
	replySubagentSupervisor(sessionId: string, requestId: string, message: string): void | Promise<void>;
	init(): Promise<void>;
	getEventRates(): Map<string, { window60s: number[]; lastEventAt: number }>;
	onEvent(handler: (sessionId: string, event: SessionEvent) => void): () => void;
	onAskRequest(handler: (request: AskRequest) => void): () => void;
	onPermissionRequest(handler: (request: PermissionRequest) => void): () => void;
	onPermissionResolved(handler: (result: PermissionResolved) => void): () => void;
	onTrustRequest(handler: (request: TrustRequest) => void): () => void;
	onLoginEvent(handler: (payload: LoginEventPayload) => void): () => void;
	onMcpStatus(handler: (cwd: string, status: McpStatus) => void): () => void;
	respondAsk(requestId: string, response: AskResponse): boolean;
	respondPermission(requestId: string, answer: PermissionAnswer): void;
	respondTrust(requestId: string, answer: TrustAnswer): void;
	getSessionPermissionMode(sessionId: string): PermissionMode;
	setSessionPermissionMode(sessionId: string, mode: PermissionMode): void;
	getContextManagerConfig(): { mode: ContextManagerMode };
	setContextManagerMode(mode: ContextManagerMode): void;
	getChannelWatchConfig(): { enabled: boolean };
	setChannelWatchEnabled(enabled: boolean): void;
	peekSessionMessages(sessionId: string): Promise<SessionMessage[] | null>;
	listActiveSessionRuntime(): Array<{ sessionId: string; streaming: boolean; compacting: boolean }>;
	getPendingPermissionRequests(): PermissionRequest[];
	checkSessionWritable(sessionId: string): "ok" | "not_found" | "read_only";
}

export interface BackendServices {
	/** Per-host runtime container; extension bridges must not use process globals. */
	runtime: DroneRuntime;
	/** Host-facing diagnostics boundary; keeps desktop IPC independent of PiBackend. */
	diagnostics: DiagnosticsServicePort;
	/** Session lifecycle and compatibility methods during A3 migration. */
	sessions: SessionServicePort;
	/** SDK lifecycle boundary; hosts can migrate session calls without importing Pi SDK types. */
	sessionEngine: SessionEngine;
	/** Session discovery and disposal coordination during the lifecycle migration. */
	lifecycle: SessionLifecycleServicePort;
	/** Domain-owned knowledge service; consumers do not need the compatibility façade. */
	knowledge: KnowledgeUiServicePort;
	/** Session-bound knowledge actions (setup/review/resume) independent of IPC. */
	knowledgeSession: KnowledgeSessionServicePort;
	/** Community package catalog and package-manager operations. */
	packages: PackageServicePort;
	/** Provider and credential settings service. */
	settings: SettingsServicePort;
	/** User-level model visibility and subagent preferences. */
	models: ModelSettingsServicePort;
	/** Interactive provider login service. */
	login: LoginServicePort;
	/** MCP configuration and status service. */
	mcp: McpServicePort;
	/** Durable permissions.json settings and rule-probe service. */
	permissions: PermissionSettingsService;
	/** Per-session permission approval registry and host event boundary. */
	approvals: ApprovalService;
	/** In-memory per-session permission mode boundary; resets when a session closes. */
	sessionPermissions: SessionPermissionServicePort;
	/** Zotero integration status service. */
	zotero: ZoteroServicePort;
	/** Institutional access configuration and session probe boundary. */
	institutional: InstitutionalServicePort;
	/** Session-scoped subagent panel and settings discovery boundary. */
	subagents: SubagentServicePort;
	/** Project trust store and interactive trust gate. */
	projectTrust: ProjectTrustService;
	/** Long-running remote compute jobs, persisted independently from sessions. */
	compute: ComputeServicePort;
	/** Optional project research-state ledger; disabled unless inquiryDir is configured. */
	inquiry: InquiryServicePort;
	/** Project-scoped B5d–B5f discovery sessions, reviews and evaluations. */
	discovery: DiscoveryServicePort;
	/** Durable B7 dataset, public-fetch and RO-Crate registry. */
	dataDesign: ComputeDataDesignServicePort;
	/** Renderer-facing projection over the durable B1 compute service. */
	computeAdapter: ComputeHostAdapter;
	dispose(): void;
}

export interface BackendOptions extends SessionServiceOptions {
	/** Inject the renderer-facing host adapter without coupling the composition root to SSH details. */
	compute?: ComputeHostAdapter;
	/** Optional runner used by tests or a host-specific transport integration. */
	computeExecutor?: ComputeExecutor;
	/** Agent directory for compute persistence; defaults to the session engine directory. */
	computeAgentDir?: string;
	/** Approval callback for runner and remote-read operations. Omitted means fail closed. */
	computeAuthorizeRemoteOperation?: (operation: ComputeRemoteOperation) => Promise<void>;
	/** Optional host-side preflight hook for additional task contract checks. */
	computePreflight?: (
		spec: import("./services/compute-preflight").ComputePreflightJobSpec,
	) => void | Promise<void>;
	/** Optional experience bridge; production hosts can supply their bound knowledge store. */
	computeExperienceRecorder?: ComputeExperienceRecorder;
	/** Bound knowledge store used to create the default compute experience bridge. */
	computeExperienceStore?: ExperienceStorePort;
	computeExperienceTopicId?: string | null;
	computeDataDesign?: ComputeDataDesignServicePort;
	/** Optional project research-state root; enables the SQLite inquiry ledger. */
	inquiryDir?: string;
	/** Stable project identity for the inquiry ledger. */
	inquiryProjectId?: string;
	/** Project root used by the discovery kernel and run-file boundary. */
	discoveryProjectRoot?: string;
	/** Stable project identity for discovery records. */
	discoveryProjectId?: string;
	/** Authorization gate for discovery execution and exports; omitted means fail closed. */
	discoveryAuthorize?: DiscoveryAuthorization;
	/** Test or host supplied kernel runner; production defaults to Docker/Podman. */
	discoveryRunner?: ControlledKernelRunner;
	/** Durable discovery metadata root; defaults to the host agent directory. */
	discoveryAgentDir?: string;
}

export function createBackend(options: BackendOptions = {}): BackendServices {
	const runtime = options.runtime ?? createDroneRuntime();
	const permissions = new PermissionSettingsService();
	const sessions = new SessionService({ ...options, runtime, permissions, inquiryDir: options.inquiryDir });
	const inquiry = new InquiryService({
		inquiryDir: options.inquiryDir,
		projectId: options.inquiryProjectId ?? options.defaultCwd ?? process.cwd(),
	});
	const discovery = new DiscoveryService({
		projectId: options.discoveryProjectId ?? options.inquiryProjectId ?? options.defaultCwd ?? "default",
		projectRoot: options.discoveryProjectRoot ?? options.defaultCwd ?? process.cwd(),
		agentDir: options.discoveryAgentDir ?? join(getAgentDir(), "discovery"),
		storage: sessions.getStorageRegistry(),
		...(inquiry.domain ? { inquiry: inquiry.domain } : {}),
		...(options.discoveryAuthorize ? { authorize: options.discoveryAuthorize } : {}),
		...(options.discoveryRunner ? { runner: options.discoveryRunner } : {}),
	});
	const dataDesign =
		options.computeDataDesign ??
		createComputeDataDesignService({
			storage: sessions.getStorageRegistry(),
			...(options.computeAgentDir ? { agentDir: options.computeAgentDir } : {}),
		});
	const experienceRecorder =
		options.computeExperienceRecorder ??
		(options.computeExperienceStore
			? createComputeExperienceRecorder({
					store: options.computeExperienceStore,
					...(options.computeExperienceTopicId !== undefined
						? { topicId: options.computeExperienceTopicId }
						: {}),
				})
			: undefined);
	const compute = new ComputeService({
		runtime,
		storage: sessions.getStorageRegistry(),
		...(options.computeAgentDir ? { agentDir: options.computeAgentDir } : {}),
		executor:
			options.computeExecutor ??
			createDefaultComputeExecutor({
				...(options.computeAgentDir ? { agentDir: options.computeAgentDir } : {}),
			}),
		...(options.computePreflight ? { preflight: options.computePreflight } : {}),
		...(experienceRecorder ? { experienceRecorder } : {}),
	});
	const computeAdapter =
		options.compute ??
		createComputeServiceAdapter({
			service: compute,
			storage: sessions.getStorageRegistry(),
			...(options.computeAgentDir ? { agentDir: options.computeAgentDir } : {}),
			...(options.computeAuthorizeRemoteOperation
				? { authorizeRemoteOperation: options.computeAuthorizeRemoteOperation }
				: {}),
		});
	const detachInquiryComputeEvents = inquiry.attachEventSource({
		onComputeEvent: (handler) =>
			compute.onEvent((event) => {
				void compute
					.getJob(event.jobId)
					.then((job) => {
						if (!job) return handler(event);
						handler({ ...event, ...computeInquiryMetadata(job) });
					})
					.catch(() => handler(event));
			}),
		enrichComputeEvent: async (event) => {
			try {
				const job = await compute.getJob(event.jobId);
				return job ? { ...event, ...computeInquiryMetadata(job) } : event;
			} catch {
				return event;
			}
		},
		onTaskTerminal: (handler) =>
			sessions.onEvent((sessionId, event) => {
				const value = event as unknown as { type?: string; willRetry?: boolean };
				if (value.type !== "agent_end") return;
				handler({
					id: `session:${sessionId}:${Date.now()}`,
					taskId: sessionId,
					status: value.willRetry ? "partial" : "succeeded",
					at: Date.now(),
				});
			}),
	});
	// One-click reruns use the same adapter and therefore the same authorization
	// boundary as a user-submitted compute job. Collection verifies every output
	// checksum before the ledger receives the compact artifact summary.
	inquiry.setRerunHandler(
		createInquiryComputeRerun({
			compute,
			adapter: computeAdapter,
			collectionRoot: join(options.inquiryDir ?? options.defaultCwd ?? process.cwd(), "reruns"),
			drainEvents: () => inquiry.drainEvents(),
		}),
	);

	if (runtime.compute) {
		runtime.compute.service = compute;
		runtime.compute.adapter = computeAdapter;
	} else {
		runtime.compute = { service: compute, adapter: computeAdapter };
	}
	void computeAdapter.init?.();
	void discovery.init();
	const diagnostics: DiagnosticsServicePort = {
		getDiagnostics: (diagnosticsOptions) => sessions.getDiagnostics(diagnosticsOptions),
	};
	return {
		runtime,
		diagnostics,
		sessions,
		sessionEngine: sessions.sessionEngine,
		lifecycle: sessions.lifecycle,
		knowledge: sessions.knowledge,
		knowledgeSession: sessions.knowledgeSession,
		packages: sessions.packages,
		settings: sessions.settings,
		models: sessions.models,
		login: sessions.login,
		mcp: sessions.mcp,
		permissions,
		approvals: sessions.approvals,
		sessionPermissions: sessions.sessionPermissions,
		zotero: sessions.zotero,
		institutional: sessions.institutional,
		subagents: sessions.subagents,
		projectTrust: sessions.projectTrust,
		compute,
		computeAdapter,
		inquiry,
		discovery,
		dataDesign,
		dispose: () => {
			detachInquiryComputeEvents();
			sessions.dispose();
			void compute.dispose();
			void computeAdapter.dispose?.();
			inquiry.dispose();
			discovery.dispose();
			void runtime.dispose();
		},
	};
}
