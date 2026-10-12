import { describe, expect, it } from "vitest";
import { estimateMcpServerTokens, estimateMcpTotalTokens, formatTokenCost, mcpProbeResult } from "./mcp-cost";

const server = (over: Record<string, unknown> = {}) =>
	({
		name: "browser",
		status: "connected",
		toolCount: 10,
		directToolCount: 4,
		disabled: false,
		...over,
	}) as never;

describe("MCP cost (P19)", () => {
	it("estimates direct tools plus one proxy entry", () => {
		expect(estimateMcpServerTokens(server())).toBe(4 * 350 + 120);
		expect(estimateMcpServerTokens(server({ directToolCount: 10 }))).toBe(3500);
		expect(estimateMcpServerTokens(server({ disabled: true }))).toBe(0);
		expect(estimateMcpServerTokens(server({ schemaBytes: 8000 }))).toBe(2000);
		expect(
			estimateMcpTotalTokens({ servers: [server(), server({ directToolCount: 0, toolCount: 0 })] }),
		).toBe(1520);
	});
	it("formats costs", () => {
		expect(formatTokenCost(0)).toBe("0");
		expect(formatTokenCost(820)).toBe("≈820");
		expect(formatTokenCost(1520)).toBe("≈1.5k");
		expect(formatTokenCost(35_000)).toBe("≈35k");
	});
	it("reports probe results", () => {
		expect(mcpProbeResult({ servers: [server()] }, "browser")).toEqual({ ok: true, toolCount: 10 });
		expect(mcpProbeResult({ servers: [server({ status: "failed" })] }, "browser")).toEqual({
			ok: false,
			reason: "failed",
		});
		expect(mcpProbeResult({ servers: [] }, "browser")).toEqual({ ok: false, reason: "not-loaded" });
		expect(mcpProbeResult({ servers: [server({ blockedReason: "needs approval" })] }, "browser")).toEqual({
			ok: false,
			reason: "needs approval",
		});
	});
});
