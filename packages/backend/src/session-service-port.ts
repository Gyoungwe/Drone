import type {
	AskRequest,
	AskResponse,
	ContextManagerMode,
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
import type { PluginSessionCallerContext } from "./plugins/session-caller";
import type { StorageRegistry } from "./storage/registry";

/**
 * Host-facing session boundary. This is deliberately structural: desktop and
 * future hosts depend on the transport/session contract and lifecycle
 * events, while the concrete SessionService remains an internal composition-root
 * implementation.  Compatibility-only domain delegates are intentionally not
 * part of this port.
 */
export interface SessionServicePort extends Omit<SessionsApi, "replySubagentSupervisor"> {
	/**
	 * Host-facing session boundary. Domain services intentionally do not live
	 * here; consumers should obtain them from BackendServices. SessionService
	 * composes the concrete implementation; callers use this typed port
	 * as the host contract.
	 */
	replySubagentSupervisor(sessionId: string, requestId: string, message: string): void | Promise<void>;
	init(): Promise<void>;
	getPluginCallerContext(sessionId: string): PluginSessionCallerContext | undefined;
	getPluginSessionCapabilities(
		recordAdoptions?: import("@gyoungwe/plugin-api/runtime").PluginRecordAdoptions,
	): ReturnType<import("./services/session-api").SessionServiceApi["getPluginSessionCapabilities"]>;
	getPluginSourceCapabilities(
		source: import("./plugins/coordinator").PluginRuntimeSource,
	): ReturnType<import("./services/session-api").SessionServiceApi["getPluginSourceCapabilities"]>;
	getPluginHostEvents(
		source: import("./plugins/coordinator").PluginRuntimeSource,
		signal: AbortSignal,
	): ReturnType<import("./services/session-api").SessionServiceApi["getPluginHostEvents"]>;
	getTaskGrants(): import("./plugins/task-grants").TaskGrantStore;
	getPluginWorkspaceCapabilities: import("./services/session-api").SessionServiceApi["getPluginWorkspaceCapabilities"];
	getStorageRegistry(): StorageRegistry;
	getEventRates(): Map<string, { window60s: number[]; lastEventAt: number }>;
	onEvent(handler: (sessionId: string, event: SessionEvent) => void): () => void;
	onAskRequest(handler: (request: AskRequest) => void): () => void;
	onPermissionRequest(handler: (request: PermissionRequest) => void): () => void;
	onPermissionResolved(handler: (result: PermissionResolved) => void): () => void;
	onTrustRequest(handler: (request: TrustRequest) => void): () => void;
	onLoginEvent(handler: (payload: LoginEventPayload) => void): () => void;
	onMcpStatus(handler: (cwd: string, status: McpStatus) => void): () => void;
	respondAsk(requestId: string, response: AskResponse, ownerId?: number): boolean;
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
