import { describe, expect, it } from "vitest";
import { diagnoseExternalMcpServer, mcpIsolationKey } from "./mcp-external";

const projectServer = {
	name: "paper2agent",
	transport: "http" as const,
	url: "https://mcp.example.test/sse",
	disabled: false,
	scope: "project" as const,
	sourcePath: "/work/project/.mcp.json",
};

describe("external MCP policy", () => {
	it("requires explicit approval for project servers and keeps isolation keys opaque", () => {
		const diagnostics = diagnoseExternalMcpServer(projectServer);
		expect(diagnostics).toMatchObject([{ code: "project-approval-required", severity: "warning" }]);
		const key = mcpIsolationKey(projectServer, "/work/project");
		expect(key).toMatch(/^mcp-[a-f0-9]{24}$/u);
		expect(key).not.toContain("paper2agent");
		expect(mcpIsolationKey(projectServer, "/work/other")).not.toBe(key);
	});

	it("accepts an approved endpoint and reports an origin violation", () => {
		expect(
			diagnoseExternalMcpServer(projectServer, {
				approvedProjectServers: ["paper2agent"],
				allowedOrigins: ["https://mcp.example.test"],
			}),
		).toEqual([]);
		expect(
			diagnoseExternalMcpServer(projectServer, {
				approvedProjectServers: ["paper2agent"],
				allowedOrigins: [],
			}),
		).toMatchObject([{ code: "cross-origin-url", severity: "error" }]);
	});

	it("fails closed for malformed transports without exposing config secrets", () => {
		const diagnostics = diagnoseExternalMcpServer({
			name: "broken",
			transport: "unknown",
			disabled: false,
			scope: "user",
			sourcePath: "/Users/user/.pi/agent/mcp.json",
		});
		expect(diagnostics).toMatchObject([{ code: "unknown-transport", severity: "error" }]);
		expect(JSON.stringify(diagnostics)).not.toContain(".pi/agent");
	});
});
