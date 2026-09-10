import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpService } from "../src/mcp/service";

const agentDir = await mkdtemp(join(tmpdir(), "percho-mcp-service-"));
process.env.PI_CODING_AGENT_DIR = agentDir;

describe("McpService", () => {
	it("reads configured servers without exposing secrets", async () => {
		await writeFile(join(agentDir, "mcp.json"), JSON.stringify({ mcpServers: {
			docs: { command: "node", args: ["server.js"], env: { TOKEN: "secret" } },
		}, settings: { token: "hidden" } }));
		const result = await new McpService().getConfig();
		expect(result.servers).toEqual([{ name: "docs", transport: "stdio", command: "node", disabled: false }]);
		expect(JSON.stringify(result)).not.toContain("secret");
	});

	it("writes only the selected server disabled flag", async () => {
		const path = join(agentDir, "mcp.json");
		await new McpService().setServerEnabled("docs", false);
		const value = JSON.parse(await readFile(path, "utf8"));
		expect(value.mcpServers.docs.disabled).toBe(true);
		expect(value.mcpServers.docs.env.TOKEN).toBe("secret");
	});
});
