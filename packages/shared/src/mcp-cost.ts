import type { McpServerStatus, McpStatus } from "./mcp";

/**
 * MCP 上下文成本（P19）：直接暴露给模型的工具每个都要带 schema 进系统提示。
 * 没有真实 schema 字节时按经验值估算（每个直接工具 ≈ 350 token，代理工具只算一次入口 ≈ 120 token）。
 */
export const TOKENS_PER_DIRECT_TOOL = 350;
export const PROXY_ENTRY_TOKENS = 120;

export function estimateMcpServerTokens(
	server: Pick<McpServerStatus, "toolCount" | "directToolCount" | "disabled" | "status"> & {
		schemaBytes?: number;
	},
): number {
	if (server.disabled) return 0;
	if (server.schemaBytes != null && server.schemaBytes > 0) return Math.ceil(server.schemaBytes / 4);
	const direct = server.directToolCount ?? 0;
	const proxied = Math.max(0, server.toolCount - direct);
	return direct * TOKENS_PER_DIRECT_TOOL + (proxied > 0 ? PROXY_ENTRY_TOKENS : 0);
}

export function estimateMcpTotalTokens(status: Pick<McpStatus, "servers"> | null | undefined): number {
	return (status?.servers ?? []).reduce((n, s) => n + estimateMcpServerTokens(s), 0);
}

export function formatTokenCost(tokens: number): string {
	if (tokens <= 0) return "0";
	return tokens >= 1000 ? `≈${(tokens / 1000).toFixed(tokens >= 10_000 ? 0 : 1)}k` : `≈${tokens}`;
}

export type McpProbeResult = { ok: true; toolCount: number } | { ok: false; reason: string };

/** 「测试连接」：刷新状态后按服务名判断结果。 */
export function mcpProbeResult(status: Pick<McpStatus, "servers"> | null, name: string): McpProbeResult {
	const s = status?.servers.find((x) => x.name === name);
	if (!s) return { ok: false, reason: "not-loaded" };
	if (s.disabled) return { ok: false, reason: "disabled" };
	if (s.blockedReason) return { ok: false, reason: s.blockedReason };
	if (s.status === "connected") return { ok: true, toolCount: s.toolCount };
	return { ok: false, reason: String(s.status) };
}
