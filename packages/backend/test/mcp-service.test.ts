import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { McpService } from "../src/mcp/service";

const agentDir = await mkdtemp(join(tmpdir(), "percho-mcp-service-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
const homeDir = await mkdtemp(join(tmpdir(), "percho-mcp-home-"));

describe("McpService", () => {
	it("keeps runtime status isolated by project", () => {
		const service = new McpService({ agentDir, homeDir });
		const first = {
			version: 1 as const,
			servers: [{ name: "first", status: "connected" as const, toolCount: 2, disabled: false }],
			totalTools: 2,
			totalResources: 0,
			connectedCount: 1,
			disabledCount: 0,
		};
		service.setStatus(first, "/projects/first");

		expect(service.getStatus("/projects/first")).toEqual(first);
		expect(service.getStatus("/projects/second").servers).toEqual([]);
	});

	it("reads configured servers without exposing secrets", async () => {
		await writeFile(
			join(agentDir, "mcp.json"),
			JSON.stringify({
				mcpServers: {
					docs: { command: "node", args: ["server.js"], env: { TOKEN: "secret" } },
				},
				settings: { token: "hidden" },
			}),
		);
		const result = await new McpService({ agentDir, homeDir }).getConfig();
		expect(result.servers).toEqual([
			{
				name: "docs",
				transport: "stdio",
				command: "node",
				disabled: false,
				scope: "user",
				sourcePath: join(agentDir, "mcp.json"),
			},
		]);
		expect(JSON.stringify(result)).not.toContain("secret");
	});

	it("merges project config after user config and reports its source", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "percho-mcp-project-"));
		await writeFile(
			join(agentDir, "mcp.json"),
			JSON.stringify({
				mcpServers: {
					docs: { command: "node", args: ["user.js"], disabled: true },
				},
			}),
		);
		await writeFile(
			join(cwd, ".mcp.json"),
			JSON.stringify({
				mcpServers: {
					docs: { command: "bun", args: ["project.ts"] },
					vault: { url: "http://127.0.0.1:3000" },
				},
			}),
		);

		const result = await new McpService({ agentDir, homeDir }).getConfig(cwd);
		expect(result.path).toBe(join(cwd, ".mcp.json"));
		expect(result.servers).toEqual([
			{
				name: "docs",
				transport: "stdio",
				command: "bun",
				disabled: true,
				scope: "project",
				sourcePath: join(cwd, ".mcp.json"),
			},
			{
				name: "vault",
				transport: "http",
				url: "http://127.0.0.1:3000",
				disabled: false,
				scope: "project",
				sourcePath: join(cwd, ".mcp.json"),
			},
		]);
	});

	it("writes a project-only disabled override without modifying shared config", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "percho-mcp-project-"));
		const sharedPath = join(cwd, ".mcp.json");
		const shared = { mcpServers: { docs: { command: "node", env: { TOKEN: "secret" } } } };
		await writeFile(sharedPath, JSON.stringify(shared));

		const service = new McpService({ agentDir, homeDir });
		await service.setServerEnabled("docs", false, cwd);

		const sharedAfter = JSON.parse(await readFile(sharedPath, "utf8"));
		expect(sharedAfter).toEqual(shared);
		const override = JSON.parse(await readFile(join(cwd, ".pi", "mcp.json"), "utf8"));
		expect(override).toEqual({ mcpServers: { docs: { disabled: true } } });
		expect(JSON.stringify(override)).not.toContain("secret");
	});

	it("enables a server disabled by a lower-precedence user config", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "percho-mcp-project-"));
		await writeFile(
			join(agentDir, "mcp.json"),
			JSON.stringify({
				mcpServers: {
					docs: { command: "node", disabled: true },
				},
			}),
		);
		await writeFile(
			join(cwd, ".mcp.json"),
			JSON.stringify({
				mcpServers: {
					docs: { command: "node" },
				},
			}),
		);
		await mkdir(join(cwd, ".pi"), { recursive: true });

		const result = await new McpService({ agentDir, homeDir }).setServerEnabled("docs", true, cwd);
		const override = JSON.parse(await readFile(join(cwd, ".pi", "mcp.json"), "utf8"));
		expect(override.mcpServers.docs.disabled).toBe(false);
		expect(result.servers.find((server) => server.name === "docs")?.disabled).toBe(false);
	});
});
