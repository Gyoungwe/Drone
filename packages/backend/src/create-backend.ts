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
import type { DiagnosticsServicePort } from "./diagnostics";
import type { KnowledgeUiServicePort } from "./knowledge/ui";
import type { McpServicePort } from "./mcp/service";
import { createDroneRuntime } from "./runtime";
import type { ApprovalService } from "./services/approvals";
import type { InstitutionalServicePort } from "./services/institutional";
import type { KnowledgeSessionServicePort } from "./services/knowledge-session";
import type { PackageServicePort } from "./services/packages";
import { PermissionSettingsService } from "./services/permissions";
import type { ProjectTrustService } from "./services/project-trust";
import type { SubagentServicePort } from "./services/subagents";
import type { ZoteroServicePort } from "./services/zotero";
import type { SessionEngine } from "./session-engine/engine";
import { PiBackend, type PiBackendOptions } from "./session-service";
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
	/** Zotero integration status service. */
	zotero: ZoteroServicePort;
	/** Institutional access configuration and session probe boundary. */
	institutional: InstitutionalServicePort;
	/** Session-scoped subagent panel and settings discovery boundary. */
	subagents: SubagentServicePort;
	/** Project trust store and interactive trust gate. */
	projectTrust: ProjectTrustService;
	dispose(): void;
}

export function createBackend(options: PiBackendOptions = {}): BackendServices {
	const runtime = options.runtime ?? createDroneRuntime();
	const permissions = new PermissionSettingsService();
	const sessions = new PiBackend({ ...options, runtime, permissions });
	const diagnostics: DiagnosticsServicePort = {
		getDiagnostics: (diagnosticsOptions) => sessions.getDiagnostics(diagnosticsOptions),
	};
	return {
		runtime,
		diagnostics,
		sessions,
		sessionEngine: sessions.sessionEngine,
		knowledge: sessions.knowledge,
		knowledgeSession: sessions.knowledgeSession,
		packages: sessions.packages,
		settings: sessions.settings,
		models: sessions.models,
		login: sessions.login,
		mcp: sessions.mcp,
		permissions,
		approvals: sessions.approvals,
		zotero: sessions.zotero,
		institutional: sessions.institutional,
		subagents: sessions.subagents,
		projectTrust: sessions.projectTrust,
		dispose: () => {
			sessions.dispose();
			void runtime.dispose();
		},
	};
}
