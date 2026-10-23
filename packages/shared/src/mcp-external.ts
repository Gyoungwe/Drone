import type { McpConfigServer } from "./mcp";

export type McpDiagnosticSeverity = "warning" | "error";
export type McpDiagnosticCode =
	| "project-approval-required"
	| "unknown-transport"
	| "invalid-url"
	| "missing-command"
	| "cross-origin-url";

export interface McpDiagnostic {
	readonly server: string;
	readonly severity: McpDiagnosticSeverity;
	readonly code: McpDiagnosticCode;
	readonly message: string;
}

function opaqueHash(value: string): string {
	// Keep this contract browser/preload-safe; cryptographic integrity belongs to
	// the package installer, while this value is only an isolation namespace.
	let hash = 2166136261;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(16).padStart(8, "0").repeat(3);
}

/** Stable, opaque key used to keep external MCP state isolated per user/project. */
export function mcpIsolationKey(
	server: Pick<McpConfigServer, "name" | "scope" | "sourcePath">,
	cwd?: string,
): string {
	const scope =
		server.scope === "project" ? (cwd ?? "").replace(/[\\/]+/gu, "/").replace(/\/$/u, "") || "/" : "user";
	return `mcp-${opaqueHash(`${server.scope}:${server.name}:${scope}`)}`;
}

/**
 * Diagnose user-configured MCP entries without reading command arguments,
 * environment variables, or server output.  The result is safe to surface in
 * settings and intentionally contains no credential material.
 */
export function diagnoseExternalMcpServer(
	server: McpConfigServer,
	options: {
		readonly approvedProjectServers?: readonly string[];
		readonly allowedOrigins?: readonly string[];
	} = {},
): readonly McpDiagnostic[] {
	const diagnostics: McpDiagnostic[] = [];
	if (server.scope === "project" && !options.approvedProjectServers?.includes(server.name)) {
		diagnostics.push({
			server: server.name,
			severity: "warning",
			code: "project-approval-required",
			message: "Project-scoped MCP server requires explicit approval before tools are exposed",
		});
	}
	if (server.transport === "unknown") {
		diagnostics.push({
			server: server.name,
			severity: "error",
			code: "unknown-transport",
			message: "MCP server has no supported command, URL, or socket transport",
		});
	}
	if (server.transport === "stdio" && !server.command?.trim()) {
		diagnostics.push({
			server: server.name,
			severity: "error",
			code: "missing-command",
			message: "stdio MCP server has no executable command",
		});
	}
	if (server.transport === "http" && server.url) {
		try {
			const url = new URL(server.url);
			if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("protocol");
			if (options.allowedOrigins && !options.allowedOrigins.includes(url.origin)) {
				diagnostics.push({
					server: server.name,
					severity: "error",
					code: "cross-origin-url",
					message: "MCP server URL is outside the configured origin allowlist",
				});
			}
		} catch {
			diagnostics.push({
				server: server.name,
				severity: "error",
				code: "invalid-url",
				message: "MCP server URL is not a valid HTTP(S) URL",
			});
		}
	}
	return diagnostics;
}
