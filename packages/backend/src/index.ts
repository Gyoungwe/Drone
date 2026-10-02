export { type BackendServices, createBackend, type SessionServicePort } from "./create-backend";
export {
	buildDiagnostics,
	type DiagnosticsOptions,
	type DiagnosticsServicePort,
	type DiagnosticsSnapshot,
	redactDiagnosticText,
} from "./diagnostics";
export * from "./institutional";
export {
	JsonStore,
	JsonStoreCorruptedError,
	type JsonStoreOptions,
	type ReadResult,
} from "./json-store";
export { KnowledgeUiService, type KnowledgeUiServicePort } from "./knowledge/ui";
export { LanConfigService } from "./lan/config";
export {
	applyEvent as applyLanEvent,
	applyPermissionRequest as applyLanPermissionRequest,
	applyPermissionResolved as applyLanPermissionResolved,
	type LanPendingPermission,
	type LanSessionRuntime,
	seedView as seedLanView,
} from "./lan/projector";
export { type LanObserverBackend, LanObserverServer, type LanObserverServerOptions } from "./lan/server";
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
export { createDroneRuntime, KeyedScheduler } from "./runtime";
export { type ApprovalDecision, ApprovalService, type ApprovalServiceOptions } from "./services/approvals";
export {
	artifactSha256,
	type ComputeCollectOptions,
	type ComputeCollectResult,
	type ComputeEvent,
	type ComputeExecutor,
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
