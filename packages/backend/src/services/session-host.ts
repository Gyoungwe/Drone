import type {
	AskRequest,
	DroneRuntime,
	ImageInput,
	LoginEventPayload,
	McpStatus,
	PromptReceipt,
	SessionEvent,
	SessionMeta,
	TrustRequest,
	WikiModelReviewInput,
	WikiModelReviewResult,
} from "@drone/shared";
import type { CapabilityRuntime } from "../capabilities/runtime";
import type { KnowledgeUiService } from "../knowledge/ui";
import type { McpService } from "../mcp/service";
import type { ProjectResourceLoader } from "../project/trust-loader";
import type { AskGate } from "../session/ask-gate";
import type { ModelWaitMonitor } from "../session/model-wait";
import type { EventRateTracker } from "../session/rates";
import type { SessionRecovery } from "../session/recovery";
import type { RegisteredSession, SessionRegistry } from "../session/registry";
import type { StreamGuard } from "../session/stream-guard";
import type { SessionTraces } from "../session/traces";
import type { ModelRuntime, SessionEngine } from "../session-engine/engine";
import type { SessionExtensionDependencies } from "../session-engine/extensions";
import type { SessionServiceOptions } from "../session-service";
import type { ModelSettingsService } from "../settings/models";
import type { SettingsService } from "../settings/settings";
import type { StorageRegistry } from "../storage/registry";
import type { SubagentPanelService } from "../tools/subagent";
import type { ApprovalDecision, ApprovalService } from "./approvals";
import type { KnowledgeReviewControl, KnowledgeSessionService } from "./knowledge-session";
import type { PackageService } from "./packages";
import type { PermissionSettingsService } from "./permissions";
import type { ProjectTrustService } from "./project-trust";
import type { SessionConstructionService } from "./session-construction";
import type { SessionControlService } from "./session-control";
import type { SessionExtensionsService } from "./session-extensions";
import type { SessionLifecycleService } from "./session-lifecycle";
import type { SessionMessageService } from "./session-messages";
import type { SessionModelsService } from "./session-models";
import type { SessionPermissionService } from "./session-permissions";
import type { SessionResourceService } from "./session-resources";
import type { SessionSettingsBoundary } from "./session-settings-boundary";
import type { SubagentService } from "./subagents";
import type { ZoteroService } from "./zotero";

export interface SessionEventPort {
	emit(sessionId: string, event: SessionEvent): void;
	onEvent(handler: (sessionId: string, event: SessionEvent) => void): () => void;
	clear(): void;
}

export interface LiveSubagentControl {
	steer(message: string, mode?: "steer" | "followUp"): Promise<void>;
	reply(requestId: string, message: string): boolean;
}

/** Typed composition port shared by the façade and its extracted services. */
export interface SessionHost {
	readonly options: SessionServiceOptions;
	runtime: DroneRuntime;
	readonly knowledge: KnowledgeUiService;
	knowledgeSession: KnowledgeSessionService;
	readonly registry: SessionRegistry;
	readonly askHandlers: Set<(req: AskRequest) => void>;
	readonly trustHandlers: Set<(req: TrustRequest) => void>;
	readonly loginHandlers: Set<(payload: LoginEventPayload) => void>;
	readonly mcpHandlers: Set<(cwd: string, status: McpStatus) => void>;
	readonly liveSubagents: Map<string, LiveSubagentControl>;
	mcp: McpService;
	permissions: PermissionSettingsService;
	approvals: ApprovalService;
	readonly zotero: ZoteroService;
	readonly capabilityRuntimes: Map<string, CapabilityRuntime>;
	readonly askGates: Map<string, Set<AskGate>>;
	readonly sessionPermissions: SessionPermissionService;
	projectTrust: ProjectTrustService;
	readonly traces: SessionTraces;
	storage: StorageRegistry;
	readonly subagentPanel: SubagentPanelService;
	readonly streamGuard: StreamGuard;
	readonly recovery: SessionRecovery;
	readonly modelWait: ModelWaitMonitor;
	readonly eventRates: EventRateTracker;
	getEventService(): SessionEventPort;
	setEventService(service: SessionEventPort): void;
	messageService: SessionMessageService;
	control: SessionControlService;
	modelsService: SessionModelsService;
	settingsBoundary: SessionSettingsBoundary;
	resources: SessionResourceService;
	construction: SessionConstructionService;
	extensions: SessionExtensionsService;
	projectLoader: ProjectResourceLoader;
	readonly sessionEngine: SessionEngine;
	lifecycle: SessionLifecycleService;
	readonly settings: SettingsService;
	readonly models: ModelSettingsService;
	readonly modelPrefs: ModelSettingsService;
	readonly modelSettings: ModelSettingsService;
	packages: PackageService;
	subagents: SubagentService;

	getModelRuntime(): Promise<ModelRuntime>;
	sessionExtensionDependencies(): SessionExtensionDependencies;
	reloadMcpSessions(cwd?: string): Promise<void>;
	emitEvent(sessionId: string, event: SessionEvent): void;
	abort(sessionId: string): Promise<void>;
	prompt(sessionId: string, text: string, images?: ImageInput[]): Promise<PromptReceipt>;
	openSession(path: string): Promise<SessionMeta>;
	closeSession(sessionId: string): Promise<void>;
	listAllSessions(): Promise<SessionMeta[]>;
	requireSession(sessionId: string): RegisteredSession;
	toMetaOrThrow(sessionId: string): SessionMeta;
	registerAskGate(sessionId: string, gate: AskGate): void;
	dispatchAskRequest(request: AskRequest): boolean;
	dispatchTrustRequest(request: TrustRequest): void;
	persistPermissionDecision(decision: ApprovalDecision): void;
	reapplyCapabilities(sessionId: string): void;
	setMcpStatus(cwd: string, status: McpStatus): void;
	evaluateKnowledgeReview(
		input: WikiModelReviewInput,
		control: KnowledgeReviewControl,
	): Promise<WikiModelReviewResult>;
}
