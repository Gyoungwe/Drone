export { type BackendServices, createBackend } from "./create-backend";
export { buildDiagnostics, type DiagnosticsSnapshot, redactDiagnosticText } from "./diagnostics";
export * from "./institutional";
export {
	JsonStore,
	JsonStoreCorruptedError,
	type JsonStoreOptions,
	type ReadResult,
} from "./json-store";
export { KnowledgeUiService } from "./knowledge/ui";
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
export { McpService } from "./mcp/service";
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
	isNpmSpawnEnoent,
	NPM_NOT_FOUND_SENTINEL,
	PackageService,
	type PackageServicePort,
} from "./services/packages";
export { PermissionSettingsService } from "./services/permissions";
export { ProjectTrustService } from "./services/project-trust";
export { SubagentService, type SubagentServicePort } from "./services/subagents";
export { ZoteroService } from "./services/zotero";
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
export { LoginService, type LoginServiceDeps } from "./settings/login";
export { ModelPrefsService } from "./settings/model-prefs";
export { ModelSettingsService } from "./settings/models";
export { SettingsService } from "./settings/settings";
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
