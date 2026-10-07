import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { describeMcpStatusChange, McpService } from "../src/mcp/service";

const agentDir = await mkdtemp(join(tmpdir(), "drone-mcp-service-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
const homeDir = await mkdtemp(join(tmpdir(), "drone-mcp-home-"));

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

		expect(service.getStatus("/projects/first")).toEqual({ ...first, runtime: "running" });
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
		const cwd = await mkdtemp(join(tmpdir(), "drone-mcp-project-"));
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

	it("toggles a server in the file that defines it, without writing partial overrides", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "drone-mcp-project-"));
		const sharedPath = join(cwd, ".mcp.json");
		await writeFile(
			sharedPath,
			JSON.stringify({ mcpServers: { docs: { command: "node", env: { TOKEN: "secret" } } } }),
		);

		const service = new McpService({ agentDir, homeDir });
		const result = await service.setServerEnabled("docs", false, cwd);

		expect(JSON.parse(await readFile(sharedPath, "utf8"))).toEqual({
			mcpServers: { docs: { command: "node", env: { TOKEN: "secret" }, disabled: true } },
		});
		expect(existsSync(join(cwd, ".pi", "mcp.json"))).toBe(false);
		expect(result.servers.find((server) => server.name === "docs")).toMatchObject({
			disabled: true,
			command: "node",
		});
	});

	it("disables a user-level server in the user file and reloads every session", async () => {
		const dir = await mkdtemp(join(tmpdir(), "drone-mcp-agent-"));
		const cwd = await mkdtemp(join(tmpdir(), "drone-mcp-project-"));
		await writeFile(
			join(dir, "mcp.json"),
			JSON.stringify({ mcpServers: { zotero: { command: "zotero-mcp" } } }),
		);
		const reloads: Array<string | undefined> = [];
		const service = new McpService({
			agentDir: dir,
			homeDir,
			onServerEnabled: async (target) => {
				reloads.push(target);
			},
		});
		await service.setServerEnabled("zotero", false, cwd);
		expect(JSON.parse(await readFile(join(dir, "mcp.json"), "utf8")).mcpServers.zotero).toEqual({
			command: "zotero-mcp",
			disabled: true,
		});
		// Regression: older builds wrote { zotero: { disabled: true } } into <project>/.pi/mcp.json, which
		// replaces the global definition in pi-mcp-adapter and leaves a server without a command.
		expect(existsSync(join(cwd, ".pi", "mcp.json"))).toBe(false);
		expect(reloads).toEqual([undefined]);
	});

	it("repairs a legacy project stub that shadows the global definition", async () => {
		const dir = await mkdtemp(join(tmpdir(), "drone-mcp-agent-"));
		const cwd = await mkdtemp(join(tmpdir(), "drone-mcp-project-"));
		await writeFile(
			join(dir, "mcp.json"),
			JSON.stringify({ mcpServers: { zotero: { command: "zotero-mcp" } } }),
		);
		await mkdir(join(cwd, ".pi"), { recursive: true });
		await writeFile(
			join(cwd, ".pi", "mcp.json"),
			JSON.stringify({ mcpServers: { zotero: { disabled: true }, local: { command: "local-mcp" } } }),
		);
		const service = new McpService({ agentDir: dir, homeDir });
		// Same replace semantics as the runtime: the stub wins and the server has no transport.
		expect((await service.getConfig(cwd)).servers.find((server) => server.name === "zotero")).toMatchObject({
			transport: "unknown",
			disabled: true,
			scope: "project",
		});
		const result = await service.setServerEnabled("zotero", true, cwd);
		expect(JSON.parse(await readFile(join(cwd, ".pi", "mcp.json"), "utf8"))).toEqual({
			mcpServers: { local: { command: "local-mcp" } },
		});
		expect(JSON.parse(await readFile(join(dir, "mcp.json"), "utf8")).mcpServers.zotero).toEqual({
			command: "zotero-mcp",
		});
		expect(result.servers.find((server) => server.name === "zotero")).toMatchObject({
			transport: "stdio",
			command: "zotero-mcp",
			disabled: false,
			scope: "user",
		});
	});

	it("enables a server disabled by a lower-precedence user config", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "drone-mcp-project-"));
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

		const result = await new McpService({ agentDir, homeDir }).setServerEnabled("docs", true, cwd);
		const owner = JSON.parse(await readFile(join(cwd, ".mcp.json"), "utf8"));
		expect(owner.mcpServers.docs).toEqual({ command: "node", disabled: false });
		expect(result.servers.find((server) => server.name === "docs")?.disabled).toBe(false);
	});

	it("reports the runtime as missing or starting until it publishes a status", () => {
		expect(new McpService({ agentDir, homeDir }).getStatus("/projects/x").runtime).toBe("missing");
		const bundled = new McpService({ agentDir, homeDir, runtimeBundled: true });
		expect(bundled.getStatus("/projects/x").runtime).toBe("starting");
		bundled.setStatus(
			{ version: 1, servers: [], totalTools: 0, totalResources: 0, connectedCount: 0, disabledCount: 0 },
			"/projects/x",
		);
		expect(bundled.getStatus("/projects/x").runtime).toBe("running");
		expect(bundled.getStatus("/projects/y").runtime).toBe("starting");
	});
});

describe("MCP status log lines", () => {
	const base = { version: 1 as const, totalResources: 0, disabledCount: 0 };
	it("logs ready, failed and tool counts once per transition", () => {
		const first = {
			...base,
			servers: [
				{ name: "playwright", status: "connected" as const, toolCount: 21, disabled: false },
				{ name: "zotero", status: "failed" as const, toolCount: 0, disabled: false },
			],
			totalTools: 21,
			connectedCount: 1,
		};
		const lines = describeMcpStatusChange(undefined, first);
		expect(lines).toEqual([
			{
				level: "info",
				message: "MCP server ready",
				data: { server: "playwright", status: "connected", tools: 21 },
			},
			{ level: "warn", message: "MCP server failed", data: { server: "zotero", status: "failed", tools: 0 } },
			{
				level: "info",
				message: "MCP runtime status",
				data: { servers: 2, connected: 1, disabled: 0, tools: 21 },
			},
		]);
		expect(describeMcpStatusChange(first, first)).toEqual([]);
	});
});

describe("MCP presets", () => {
	it("adds the Playwright browser-control preset to the user config and re-enables it instead of overwriting", async () => {
		const dir = await mkdtemp(join(tmpdir(), "drone-mcp-preset-"));
		const service = new McpService({ agentDir: dir, homeDir });
		const added = await service.addPreset("playwright");
		expect(added.servers.find((server) => server.name === "playwright")).toMatchObject({
			command: "npx",
			disabled: false,
		});
		const written = JSON.parse(await readFile(join(dir, "mcp.json"), "utf8"));
		expect(written.mcpServers.playwright.args).toEqual(["-y", "@playwright/mcp@latest"]);
		written.mcpServers.playwright = { command: "my-playwright", disabled: true };
		await writeFile(join(dir, "mcp.json"), JSON.stringify(written));
		const again = await service.addPreset("playwright");
		expect(again.servers.find((server) => server.name === "playwright")).toMatchObject({
			command: "my-playwright",
			disabled: false,
		});
		expect(JSON.parse(await readFile(join(dir, "mcp.json"), "utf8")).mcpServers.playwright).toEqual({
			command: "my-playwright",
		});
	});

	it("adds the open-Chrome preset in Playwright extension mode and reloads every session", async () => {
		const dir = await mkdtemp(join(tmpdir(), "drone-mcp-preset-"));
		const reloads: Array<string | undefined> = [];
		const service = new McpService({
			agentDir: dir,
			homeDir,
			onServerEnabled: async (cwd) => {
				reloads.push(cwd);
			},
		});
		await service.addPreset("playwright-chrome");
		const written = JSON.parse(await readFile(join(dir, "mcp.json"), "utf8"));
		expect(written.mcpServers["playwright-chrome"]).toEqual({
			command: "npx",
			args: ["-y", "@playwright/mcp@latest", "--extension"],
		});
		expect(reloads).toEqual([undefined]);
	});
});
