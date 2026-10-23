export type { DiscoveryExplorationPlan } from "@drone/shared";
export {
	analysisHostLoader,
	createAnalysisAdapterRegistry,
	createAnalysisHost,
} from "@gyoungwe/pi-analysis/host";
export type {
	AnalysisAdapter,
	AnalysisAdapterContract,
	AnalysisAdapterPlan,
	AnalysisAdapterRegistryPort,
	AnalysisArtifactEvidence,
	AnalysisResearchStage,
	AnalysisSchemaField,
	AnalysisSideEffect,
} from "@gyoungwe/plugin-api";
export {
	type ComputeCredential,
	type ComputeCredentialProvider,
	createDefaultComputeExecutor,
	DefaultComputeExecutor,
	type DefaultComputeExecutorOptions,
} from "./compute/default-executor";
export {
	type BackendOptions,
	type BackendServices,
	createBackend,
	type SessionServicePort,
} from "./create-backend";
export {
	buildDiagnostics,
	type DiagnosticsOptions,
	type DiagnosticsServicePort,
	type DiagnosticsSnapshot,
	redactDiagnosticText,
} from "./diagnostics";
export {
	buildContainerKernelArgv,
	ContainerKernelRunner,
	type ContainerKernelRunnerOptions,
	type ContainerProcess,
	detectContainerRuntime,
	unavailableContainerCapabilities,
} from "./discovery/container-runner";
export {
	type DiscoveryAuthorization,
	type DiscoveryAuthorizationOperation,
	type DiscoveryKernelSessionInput,
	DiscoveryService,
	type DiscoveryServiceOptions,
	type DiscoveryServicePort,
} from "./discovery/service";
export * from "./institutional";
export {
	JsonStore,
	JsonStoreCorruptedError,
	type JsonStoreOptions,
	type ReadResult,
} from "./json-store";
export {
	type BackendKnowledgeWorkerResource,
	configureBackendKnowledgeWorker,
	getKnowledgeWorkerLifecycle,
	KnowledgeUiService,
	type KnowledgeUiServicePort,
	type KnowledgeWorkerLifecycleSnapshot,
	resolveBackendKnowledgeWorkerPath,
	resolveBackendKnowledgeWorkerResource,
} from "./knowledge/ui";
export {
	DEFAULT_WEBDAV_ENDPOINT,
	DEFAULT_WEBDAV_FOLDER,
	DEFAULT_WEBDAV_USERNAME,
	KnowledgeWebDavError,
	type KnowledgeWebDavOptions,
	KnowledgeWebDavService,
} from "./knowledge/webdav";
export { createLogger, initLogging, type Logger } from "./log";
export { McpService, type McpServiceOptions, type McpServicePort } from "./mcp/service";
export { fetchPackageCatalog, parseCatalogHtml } from "./packages/catalog";
export {
	createPermissionConfigLoader,
	DEFAULT_PERMISSION_CONFIG,
	evaluateBashCommand,
	evaluateRules,
	evaluateSegment,
	extractShellExecArg,
	extractSubstitutions,
	loadPermissionConfig,
	matchPattern,
	matchTextFor,
	mergeWithDefaults,
	type PermissionAction,
	type PermissionConfig,
	type PermissionOutside,
	type PermissionRule,
	type PermissionRules,
	parseConfig,
	patternMatchesToolCall,
	permissionConfigPath,
	probePermission,
	readPermissionAuditTail,
	readPermissionSettings,
	resetPermissionSettings,
	type SerializedPermissionConfig,
	serializeConfig,
	splitShellSegments,
	suggestPattern,
	validateConfig,
	writePermissionSettings,
} from "./permissions";
export {
	type PermissionAuditEntry,
	PermissionAuditLog,
	permissionAuditPath,
} from "./permissions/audit";
export {
	makePermissionGateExtension,
	type PermissionConfirm,
	type PermissionGateOptions,
	type PermissionModeRef,
} from "./permissions/extension";
export { PermissionGate, type PermissionRequestMeta, type PermissionResponder } from "./permissions/gate";
export { PiBackend, type PiBackendOptions } from "./pi-backend";
export {
	buildTrustOptions,
	type ResolveTrustOptions,
	resolveProjectTrust,
	TrustGate,
	type TrustOptionInternal,
	type TrustResponder,
} from "./project/trust";
export {
	addAllowedPattern,
	addWorkspaceRoot,
	createWorkspacesLoader,
	emptyWorkspaces,
	loadWorkspaces,
	removeWorkspaceRoot,
	suggestRootCandidate,
	type WorkspaceProjectEntry,
	type WorkspacesConfig,
	workspaceConfigPath,
} from "./project/workspace-store";
export { canonicalProjectId, normalizeProjectId } from "./project-id";
export {
	getReplyLanguage,
	hostText,
	normalizeReplyLanguage,
	type ReplyLanguage,
	replyLanguagePrompt,
	setReplyLanguage,
} from "./reply-language";
export { createDroneRuntime, KeyedScheduler } from "./runtime";
export {
	AnalysisEvidenceService,
	CAPSULE_LIMIT,
	type EvidenceAudience,
	type EvidenceCapsule,
	type EvidenceCheckpoint,
	type EvidenceReplayReceipt,
	type EvidenceReplayRunner,
	type FrozenFile,
} from "./services/analysis-evidence";
export {
	type AnalysisComputeBinding,
	type AnalysisLedger,
	AnalysisOrchestrationService,
	type AnalysisOrchestrationServiceOptions,
	analysisStatus,
	emptyAnalysisLedger,
} from "./services/analysis-orchestration";
export {
	type AnalysisComputeSubmission,
	type AnalysisResultReviewer,
	type AnalysisReviewArtifact,
	type AnalysisReviewDecision,
	type AnalysisReviewRequest,
	AnalysisTaskController,
	type AnalysisTaskControllerOptions,
	AnalysisTaskGateError,
} from "./services/analysis-task-controller";
export { type ApprovalDecision, ApprovalService, type ApprovalServiceOptions } from "./services/approvals";
export {
	type CapabilityDiscoveryResearchPort,
	CapabilityDiscoveryService,
	type CapabilityDiscoveryServiceOptions,
	type CapabilityDiscoverySnapshot,
	type CapabilityEnvironmentPort,
	type CapabilityRequestStore,
	type CapabilityValidationPort,
} from "./services/capability-discovery";
export {
	type CausalityProjection,
	type CausalityProjectionInput,
	type CausalityProjectionRecord,
	projectCausality,
} from "./services/causality-projection";
export {
	artifactSha256,
	type ComputeCollectOptions,
	type ComputeCollectResult,
	type ComputeEvent,
	type ComputeExecutor,
	type ComputeExperienceRecorder,
	type ComputeJobInput,
	type ComputeLogEvent,
	type ComputeLogsResult,
	ComputeService,
	type ComputeServiceOptions,
	type ComputeServicePort,
	type ComputeStatusResult,
	type ComputeSubmitResult,
	type ComputeWorkflowModule,
	validateArtifactManifest,
} from "./services/compute";
export {
	type ComputeHostAdapter,
	type ComputeHostAdapterOptions,
	type ComputeRemoteOperation,
	ComputeServiceAdapter,
	createComputeServiceAdapter,
	createUnavailableComputeService,
} from "./services/compute-adapter";
export {
	ComputeDataDesignService,
	type ComputeDataDesignServiceOptions,
	type ComputeDataDesignServicePort,
	createComputeDataDesignService,
} from "./services/compute-data-design";
export {
	type ComputeExperienceBridgeOptions,
	createComputeExperienceRecorder,
} from "./services/compute-experience";
export {
	assertComputePreflight,
	type ComputeDataDesignSubmission,
	ComputePreflightError,
	type ComputePreflightJobSpec,
	type ComputePreflightResult,
	type ComputeProposalQuestion,
	preflightComputeSubmission,
} from "./services/compute-preflight";
export {
	createRnaseqExecutionService,
	executeRnaseqFixture,
	planRnaseqExecution,
	preflightExecution,
	preflightRnaseqExecution,
	type RnaseqExecutionPlan,
	RnaseqExecutionService,
	type RnaseqExecutionServiceOptions,
	type RnaseqIntentInput,
	type RnaseqPreflight,
	type RnaseqSubmitResult,
	type RnaseqSubmitter,
	routeExecutionIntent,
	routeRnaseqIntent,
	runRnaseqFixture,
} from "./services/execution-route";
export { InquiryService, type InquiryServiceOptions, type InquiryServicePort } from "./services/inquiry";
export { InstitutionalService, type InstitutionalServicePort } from "./services/institutional";
export {
	type KnowledgeReviewControl,
	type KnowledgeSessionContext,
	KnowledgeSessionService,
	type KnowledgeSessionServiceDependencies,
	type KnowledgeSessionServicePort,
} from "./services/knowledge-session";
export {
	isNpmSpawnEnoent,
	NPM_NOT_FOUND_SENTINEL,
	PackageService,
	type PackageServicePort,
} from "./services/packages";
export { PermissionSettingsService } from "./services/permissions";
export { ProjectTrustService } from "./services/project-trust";
export {
	type CaptureLedger,
	emptyCaptureLedger,
	emptyResearchConnectorSettings,
	type ResearchConnectorSettings,
	ResearchResourceService,
	type ResearchResourceServiceOptions,
} from "./services/research-resource";
export {
	emptyResearchWriteLedger,
	type ResearchWriteLedger,
	ResearchWriteService,
	type ResearchWriteServiceOptions,
} from "./services/research-write";
export { SessionLifecycleService, type SessionLifecycleServicePort } from "./services/session-lifecycle";
export { SessionPermissionService, type SessionPermissionServicePort } from "./services/session-permissions";
export { SubagentService, type SubagentServicePort } from "./services/subagents";
export { ZoteroService, type ZoteroServicePort } from "./services/zotero";
export {
	assignEntryIds,
	blockImages,
	blockText,
	type ContentBlock,
	type RawMessage,
	resolveForkEntryId,
	resolveRecallEntryId,
	toSessionMessages,
} from "./session/messages";
export { type RegisteredSession, SessionRegistry } from "./session/registry";
export { TraceRecorder } from "./session/trace";
export { SessionEngine } from "./session-engine/engine";
export { LoginService, type LoginServiceDeps, type LoginServicePort } from "./settings/login";
export { ModelPrefsService } from "./settings/model-prefs";
export { ModelSettingsService, type ModelSettingsServicePort } from "./settings/models";
export { SettingsService, type SettingsServicePort } from "./settings/settings";
export { BUILTIN_SLASH_COMMANDS, slashCommandsForLoader, slashCommandsForSession } from "./slash-commands";
export {
	createDefaultStorageRegistry,
	type DefaultStorageRegistryOptions,
	type StorageEntry,
	StorageRegistry,
	type StorageSensitivity,
	type StorageState,
} from "./storage/registry";
export { makeShowImageTool, resolveShowImagePath, type ShowImageDetails } from "./tools/show-image";
export {
	buildSshArgs,
	makeSshTool,
	resolveSshKeyPath,
	runLocalSsh,
	type SshApproval,
	type SshRunner,
	type SshRunnerOptions,
	type SshRunnerResult,
	type SshToolDetails,
	type SshToolOptions,
	type SshToolParams,
} from "./tools/ssh";
export { formatTodoList, makeTodoTool, normalizeTodos } from "./tools/todo";
export { makeTodoReminderExtension } from "./tools/todo-reminder";
export {
	assertPublicUrl,
	type Cidr,
	FAKE_IP_CIDR,
	htmlToText,
	ipInCidr,
	isPublicIp,
	makeWebFetchTool,
	parseCidr,
	type WebFetchDetails,
	type WebFetchOptions,
} from "./tools/webfetch";
