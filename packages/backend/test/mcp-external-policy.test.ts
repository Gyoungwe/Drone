import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { McpService } from "../src/mcp/service";

describe("McpService external diagnostics", () => {
	it("returns metadata-only project approval diagnostics without config secrets", async () => {
		const agentDir = await mkdtemp(join(tmpdir(), "drone-mcp-external-agent-"));
		const homeDir = await mkdtemp(join(tmpdir(), "drone-mcp-external-home-"));
		const cwd = await mkdtemp(join(tmpdir(), "drone-mcp-external-project-"));
		await writeFile(
			join(cwd, ".mcp.json"),
			JSON.stringify({
				mcpServers: {
					remote: { url: "https://mcp.example.test/sse", env: { TOKEN: "fixture-secret" } },
				},
			}),
		);
		const config = await new McpService({ agentDir, homeDir }).getConfig(cwd);
		expect(config.diagnostics).toMatchObject([
			{ server: "remote", code: "project-approval-required", severity: "warning" },
		]);
		expect(JSON.stringify(config.diagnostics)).not.toContain("fixture-secret");
		expect(JSON.stringify(config.diagnostics)).not.toContain(cwd);
	});
});
