export type McpServerRuntimeStatus =
	| "connected"
	| "cached"
	| "failed"
	| "needs-auth"
	| "not-connected"
	| "disabled";

export interface McpServerStatus {
	name: string;
	status: McpServerRuntimeStatus;
	toolCount: number;
	resourceCount?: number;
	failedAgoSeconds?: number;
	disabled: boolean;
	listenState?: string;
	catalogStale?: boolean;
}

export interface McpStatus {
	version: 1;
	servers: McpServerStatus[];
	totalTools: number;
	totalResources: number;
	connectedCount: number;
	disabledCount: number;
}

export interface McpConfigServer {
	name: string;
	transport: "stdio" | "http" | "socket" | "unknown";
	command?: string;
	url?: string;
	disabled: boolean;
	scope: "user" | "project";
	sourcePath: string;
}

export interface McpConfigSnapshot {
	path: string;
	cwd: string | null;
	servers: McpConfigServer[];
}

export interface McpStatusEvent {
	cwd: string;
	status: McpStatus;
}
