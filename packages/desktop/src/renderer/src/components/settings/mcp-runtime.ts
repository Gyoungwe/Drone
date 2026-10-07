import type { McpServerStatus, McpStatus } from "@drone/shared";

/**
 * Settings › MCP banner: which runtime notice to show. A config file alone does nothing; until the
 * MCP runtime (bundled pi-mcp-adapter) reports a status for this project, say so instead of
 * listing servers as merely "not connected".
 */
export function mcpRuntimeNotice(status: McpStatus | null): "runtimeMissing" | "runtimeStarting" | null {
	if (!status) return null;
	if (status.runtime === "missing") return "runtimeMissing";
	if (status.runtime === "starting") return "runtimeStarting";
	return null;
}

export type McpStatusKey =
	| Exclude<McpServerStatus["status"], "needs-auth" | "not-connected">
	| "needsAuth"
	| "notConnected";

export function mcpStatusKey(status: McpServerStatus["status"]): McpStatusKey {
	if (status === "needs-auth") return "needsAuth";
	if (status === "not-connected") return "notConnected";
	return status;
}
