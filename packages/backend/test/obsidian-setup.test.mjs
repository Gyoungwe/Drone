import { access, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
	inspectObsidianSetup,
	inspectSetupDirectory,
	resolveSetupVault,
} from "@drone/extensions/internal/obsidian-setup";
import { resolveObsidianRuntime } from "@drone/extensions/internal/obsidian-workbench";
import obsidianWorkbench from "@drone/extensions/obsidian-workbench";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let root, cwd, vault;
beforeEach(async () => {
	vi.stubEnv("PI_SUBAGENT_CHILD", undefined);
	vi.stubEnv("PI_RESEARCH_DESKTOP_CONFIG", undefined);
	vi.stubEnv("PI_OBSIDIAN_MCP_SERVER", undefined);
	root = await mkdtemp(join(tmpdir(), "drone-obsidian-setup-"));
	cwd = join(root, "actual-project");
	vault = join(root, "User Knowledge Vault");
	await mkdir(cwd);
});
afterEach(async () => {
	vi.unstubAllEnvs();
	await rm(root, { recursive: true, force: true });
});

function harness({ input = vault, confirmed = true, hasUI = true } = {}) {
	const tools = new Map(),
		commands = new Map(),
		events = new Map();
	const pi = {
		registerTool: (tool) => tools.set(tool.name, tool),
		registerCommand: (name, command) => commands.set(name, command),
		on: (name, handler) => events.set(name, handler),
		sendUserMessage: vi.fn(),
		sendMessage: vi.fn(),
		getCommands: vi.fn(() => [
			{ name: "skill:research-vault", source: "skill" },
			{ name: "skill:zotero-literature", source: "skill" },
		]),
	};
	const ctx = {
		cwd,
		hasUI,
		ui: {
			input: vi.fn(async () => input),
			select: vi.fn(async () => (confirmed ? "确认应用此方案" : "取消，不做修改")),
			confirm: vi.fn(async () => false),
			notify: vi.fn(),
		},
	};
	obsidianWorkbench(pi);
	return { pi, tools, commands, events, ctx };
}
const setupParams = () => ({
	path: vault,
	project: "actual-research",
	profile: "hybrid",
	deposit_mode: "verified",
	subagent_mcp: "read-local",
});
const execute = (tool, params, ctx, signal) => tool.execute("setup-test", params, signal, undefined, ctx);
const flushSetupHandoff = async () => {
	await new Promise((resolve) => setTimeout(resolve, 0));
	await Promise.resolve();
	await new Promise((resolve) => setTimeout(resolve, 0));
};
async function expectNoSetupWrites() {
	await expect(access(vault)).rejects.toMatchObject({ code: "ENOENT" });
	await expect(access(join(cwd, ".pi/research-workspace.json"))).rejects.toMatchObject({ code: "ENOENT" });
}

describe("read-only project-aware setup discovery", () => {
	it("inspects the actual workspace without reading file contents or creating the Vault", async () => {
		await writeFile(join(cwd, "README.md"), "PRIVATE FILE BODY THAT MUST NOT BE AUTO-READ");
		await mkdir(join(cwd, "data"));
		await writeFile(join(cwd, "data", "samples.tsv"), "a\tb");
		const result = await inspectObsidianSetup({ cwd, vault });
		expect(result.workspace.path).toMatch(/actual-project$/);
		expect(result.workspace.referenceFiles).toContain("README.md");
		expect(result.workspace.entries).toContainEqual({ path: "data/samples.tsv", type: "file" });
		expect(JSON.stringify(result)).not.toContain("PRIVATE FILE BODY");
		expect(result.vault.exists).toBe(false);
		await expectNoSetupWrites();
	});
	it("skips hidden/private files, dependency directories and child symlinks", async () => {
		await mkdir(join(cwd, "node_modules"));
		await writeFile(join(cwd, "node_modules", "private.js"), "secret");
		await writeFile(join(cwd, ".env"), "secret");
		await writeFile(join(cwd, "credentials.json"), "secret");
		await mkdir(join(root, "outside"));
		await writeFile(join(root, "outside", "outside.md"), "secret");
		await symlink(join(root, "outside"), join(cwd, "linked"));
		expect((await inspectSetupDirectory(cwd)).entries).toEqual([]);
	});
	it("bounds the entry count and reports an incomplete inventory", async () => {
		for (let i = 0; i < 8; i++) await writeFile(join(cwd, `${i}.md`), "");
		const result = await inspectSetupDirectory(cwd, { maxEntries: 3 });
		expect(result.entries).toHaveLength(3);
		expect(result.truncated).toBe(true);
	});
	it("does not recursively scan beyond the depth bound", async () => {
		await mkdir(join(cwd, "one", "two"), { recursive: true });
		await writeFile(join(cwd, "one", "two", "deep.txt"), "");
		const result = await inspectSetupDirectory(cwd);
		expect(result.entries.map((x) => x.path)).not.toContain("one/two/deep.txt");
		expect(result.truncated).toBe(true);
	});
	it("expands home paths and rejects ambiguous relative paths", () => {
		expect(resolveSetupVault("~/My Vault", cwd)).toBe(join(homedir(), "My Vault"));
		expect(resolveSetupVault("在我的文档下面创建一个叫test的目录", cwd)).toBe(
			join(homedir(), "Documents", "test"),
		);
		expect(() => resolveSetupVault("My Vault", cwd)).toThrow("absolute");
	});
});

describe("/project knowledge project command", () => {
	it("keeps the workspace project fixed outside the daily space", async () => {
		const h = harness();
		h.pi.appendEntry = vi.fn();
		await h.commands.get("project").handler("other-project", h.ctx);
		expect(h.pi.appendEntry).not.toHaveBeenCalled();
		expect(h.ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("knowledgeProjectId"), "warning");
		await h.commands.get("项目").handler("", h.ctx);
		expect(h.ctx.ui.notify).toHaveBeenLastCalledWith(
			expect.stringMatching(/^知识项目：actual-project-[a-f0-9]{10}/),
			"info",
		);
	});

	it("records a per-session choice in the daily space", async () => {
		vi.stubEnv("HOME", root);
		vi.stubEnv("USERPROFILE", root);
		const daily = join(root, ".drone", "daily");
		await mkdir(daily, { recursive: true });
		const h = harness();
		const entries = [];
		h.pi.appendEntry = vi.fn((customType, data) => entries.push({ type: "custom", customType, data }));
		const ctx = { ...h.ctx, cwd: daily, sessionManager: { getBranch: () => entries } };
		await h.commands.get("project").handler("Gut Microbiome", ctx);
		expect(h.pi.appendEntry).toHaveBeenCalledWith("drone-session-project-v1", { project: "gut-microbiome" });
		expect(ctx.ui.notify).toHaveBeenLastCalledWith(expect.stringContaining("gut-microbiome"), "info");
		await h.commands.get("project").handler("clear", ctx);
		expect(h.pi.appendEntry).toHaveBeenLastCalledWith("drone-session-project-v1", { project: null });
		expect(ctx.ui.notify).toHaveBeenLastCalledWith(expect.not.stringContaining("gut-microbiome"), "info");
		await h.commands.get("project").handler("!!!", ctx);
		expect(ctx.ui.notify).toHaveBeenLastCalledWith(expect.stringContaining("字母或数字"), "error");
	});
});

describe("slash command to current-model handoff", () => {
	it("binds the canonical Obsidian command and compatibility aliases to research-vault", () => {
		const h = harness();
		expect([...h.commands.keys()].sort()).toEqual([
			"discover",
			"obsidian-setup",
			"project",
			"research-setup",
			"setup",
			"task-action",
			"task-status",
			"发现",
			"项目",
		]);
		for (const name of ["obsidian-setup", "research-setup", "setup"]) {
			const command = h.commands.get(name);
			expect(command.description).toContain("Obsidian MCP");
			expect(command.description).toContain("research-vault");
		}
	});
	it("/发现 hands the discovery task to the model after the slash command returns", async () => {
		const h = harness();
		await h.commands.get("发现").handler("蚜虫翅型分化", h.ctx);
		expect(h.pi.sendUserMessage).not.toHaveBeenCalled();
		await flushSetupHandoff();
		expect(h.pi.sendUserMessage).toHaveBeenCalledOnce();
		const [message, options] = h.pi.sendUserMessage.mock.calls[0];
		expect(message).toContain("Discovery task on: 蚜虫翅型分化");
		expect(message).toContain('type "idea"');
		expect(options).toEqual({ deliverAs: "followUp" });
	});
	it("starts a model turn immediately without a preflight path dialog", async () => {
		await writeFile(join(cwd, "README.md"), "not automatically read");
		const h = harness();
		await h.commands.get("setup").handler("保留现有文献分类", h.ctx);
		expect(h.ctx.ui.input).not.toHaveBeenCalled();
		expect(h.pi.sendUserMessage).not.toHaveBeenCalled();
		await flushSetupHandoff();
		expect(h.pi.sendUserMessage).toHaveBeenCalledOnce();
		const [message, options] = h.pi.sendUserMessage.mock.calls[0];
		expect(message).toContain("actual-project");
		expect(message).toContain("保留现有文献分类");
		expect(message).toMatch(/^\/skill:research-vault setup/);
		expect(message).toContain("/obsidian-setup");
		expect(message).toContain("ask_user");
		expect(message).not.toContain("not automatically read");
		expect(options).toEqual({ deliverAs: "followUp", expandPromptTemplates: true });
		expect(h.ctx.ui.confirm).not.toHaveBeenCalled();
		await expectNoSetupWrites();
	});
	it("reuses a desktop-supplied Vault path and still hands off to the model", async () => {
		const h = harness();
		await h.commands.get("setup").handler(JSON.stringify({ vaultPath: vault }), h.ctx);
		expect(h.ctx.ui.input).not.toHaveBeenCalled();
		await flushSetupHandoff();
		expect(h.pi.sendUserMessage).toHaveBeenCalledOnce();
		const [message] = h.pi.sendUserMessage.mock.calls[0];
		expect(message).toContain("User Knowledge Vault");
		expect(message).toContain("Vault 路径已由用户提供");
		await expectNoSetupWrites();
	});
	it("vault-only: /obsidian-setup no longer runs Zotero (includeLiterature ignored)", async () => {
		const h = harness();
		h.ctx.ui.confirm.mockResolvedValue(true);
		await h.commands
			.get("obsidian-setup")
			.handler(JSON.stringify({ vaultPath: vault, includeLiterature: true }), h.ctx);
		expect(h.ctx.ui.input).not.toHaveBeenCalled();
		expect(h.pi.sendUserMessage).not.toHaveBeenCalled();
		await flushSetupHandoff();
		// Only the Vault model turn is handed off; no Zotero bootstrap/confirm/second message.
		expect(h.pi.sendUserMessage).toHaveBeenCalledOnce();
		expect(h.pi.sendUserMessage.mock.calls[0][0]).toMatch(/^\/skill:research-vault setup/);
		expect(h.pi.sendUserMessage.mock.calls[0][0]).toContain("User Knowledge Vault");
		expect(h.ctx.ui.confirm).not.toHaveBeenCalled();
		await expectNoSetupWrites();
	}, 15_000);
	it("discovery tool returns current project context and all three templates without writes", async () => {
		const h = harness();
		const result = await execute(h.tools.get("research_setup_options"), { path: vault }, h.ctx);
		expect(result.details.binding).toMatchObject({
			command: "obsidian-setup",
			skill: "research-vault",
			mcpServer: "research-obsidian",
		});
		expect(result.details.profiles.map((p) => p.id)).toEqual(["project", "literature", "hybrid"]);
		expect(result.details.context.workspace.path).toMatch(/actual-project$/);
		await expectNoSetupWrites();
	});
	it("keeps the actual workspace in future model-turn guidance", async () => {
		const h = harness();
		const result = await h.events.get("before_agent_start")({ systemPrompt: "base" }, h.ctx);
		expect(result.systemPrompt).toContain(`Workspace: ${cwd}`);
	});
	it("does not expose setup tools or commands in subagents", () => {
		vi.stubEnv("PI_SUBAGENT_CHILD", "1");
		const h = harness();
		expect(h.tools.size).toBe(0);
		expect(h.commands.size).toBe(0);
	});
});

describe("interactive write gate", () => {
	it("cancel leaves both Vault and project configuration untouched", async () => {
		const h = harness({ confirmed: false });
		const result = await execute(h.tools.get("research_setup_obsidian"), setupParams(), h.ctx);
		expect(result.details.cancelled).toBe(true);
		expect(h.ctx.ui.select.mock.calls[0][0]).toContain(cwd);
		expect(h.ctx.ui.confirm).not.toHaveBeenCalled();
		await expectNoSetupWrites();
	});
	it("rejects headless writes", async () => {
		const h = harness({ hasUI: false });
		await expect(execute(h.tools.get("research_setup_obsidian"), setupParams(), h.ctx)).rejects.toThrow(
			"interactive confirmation",
		);
		await expectNoSetupWrites();
	});
	it("rejects invalid policy before asking for confirmation", async () => {
		const h = harness();
		await expect(
			execute(h.tools.get("research_setup_obsidian"), { ...setupParams(), subagent_mcp: "write-all" }, h.ctx),
		).rejects.toThrow("Invalid");
		expect(h.ctx.ui.select).not.toHaveBeenCalled();
		await expectNoSetupWrites();
	});
	it("an abort before confirmation cannot initialize the Vault", async () => {
		const h = harness();
		const controller = new AbortController();
		controller.abort();
		await expect(
			execute(h.tools.get("research_setup_obsidian"), setupParams(), h.ctx, controller.signal),
		).rejects.toThrow("aborted");
		await expectNoSetupWrites();
	});
	it("an abort while awaiting confirmation cannot initialize the Vault", async () => {
		const h = harness();
		const controller = new AbortController();
		h.ctx.ui.select.mockImplementation(async () => {
			controller.abort();
			return "确认应用此方案";
		});
		const result = await execute(
			h.tools.get("research_setup_obsidian"),
			setupParams(),
			h.ctx,
			controller.signal,
		);
		expect(result.details.cancelled).toBe(true);
		await expectNoSetupWrites();
	});
	it("approved setup preserves human notes and unrelated MCP configuration", async () => {
		const server = join(root, "fake-server.js");
		await writeFile(server, "// fixture; never executed");
		await mkdir(vault);
		await writeFile(join(vault, "My existing note.md"), "Keep my handwritten research.");
		await writeFile(
			join(cwd, ".mcp.json"),
			JSON.stringify({
				mcpServers: {
					other: { command: "existing-tool", args: [] },
					"research-obsidian": { command: process.execPath, args: [server, vault], disabled: true },
				},
			}),
		);
		const h = harness();
		const result = await execute(h.tools.get("research_setup_obsidian"), setupParams(), h.ctx);
		expect(result.details.state).toBe("ready");
		expect(result.details.connectionVerified).toBe(false);
		expect(result.details.reloadRequired).toBe(true);
		expect(await readFile(join(vault, "My existing note.md"), "utf8")).toBe("Keep my handwritten research.");
		const mcp = JSON.parse(await readFile(join(cwd, ".mcp.json"), "utf8"));
		expect(mcp.mcpServers.other).toEqual({ command: "existing-tool", args: [] });
		expect(mcp.mcpServers["research-obsidian"].disabled).toBe(false);
		expect(mcp.mcpServers["research-obsidian"].includeTools).toContain("read_note");
		expect(mcp.mcpServers["research-obsidian"].includeTools).not.toContain("write_note");
		const config = JSON.parse(await readFile(join(cwd, ".pi/research-workspace.json"), "utf8"));
		expect(config.knowledgeProfile).toBe("hybrid");
		expect(config.subagentMcpPolicy).toBe("read-local");
		expect(await readdir(join(vault, "Projects", "actual-research"))).toContain("Evidence");
	});
});

describe("runtime location is independent of the user project", () => {
	it("reuses an installed runtime launcher without inheriting Vault or credentials", async () => {
		const installationRoot = join(root, "installed-workbench");
		await mkdir(installationRoot);
		await writeFile(join(installationRoot, "server.js"), "// fixture");
		await writeFile(
			join(installationRoot, ".mcp.json"),
			JSON.stringify({
				mcpServers: {
					"research-obsidian": {
						command: "node",
						args: ["server.js", "/other-vault"],
						env: { PRIVATE_TOKEN: "do-not-copy" },
					},
				},
			}),
		);
		const runtime = await resolveObsidianRuntime({ cwd, installationRoot });
		expect(runtime.server).toMatch(/installed-workbench[\\/]server\.js$/);
		expect(runtime.command).toBe("node");
		expect(Object.keys(runtime).sort()).toEqual(["command", "server"]);
		expect(JSON.stringify(runtime)).not.toContain("do-not-copy");
	});
	it("fails clearly when no runtime is installed and performs no setup writes", async () => {
		await expect(resolveObsidianRuntime({ cwd, installationRoot: cwd })).rejects.toThrow(
			"MCPVault runtime was not found",
		);
		await expectNoSetupWrites();
	});
	it("an explicit missing runtime does not silently switch to a fallback", async () => {
		await expect(resolveObsidianRuntime({ cwd, server: "./missing.js" })).rejects.toThrow(
			"MCPVault runtime was not found",
		);
		await expectNoSetupWrites();
	});
});

describe("Obsidian MCP skill binding", () => {
	it("hands off even when the bound skill is not yet in the command catalog", async () => {
		const h = harness();
		h.pi.getCommands.mockReturnValue([]);
		await h.commands.get("setup").handler("", h.ctx);
		expect(h.ctx.ui.input).not.toHaveBeenCalled();
		await flushSetupHandoff();
		expect(h.pi.sendUserMessage).toHaveBeenCalledOnce();
		expect(h.pi.sendUserMessage.mock.calls[0][0]).toMatch(/^\/skill:research-vault setup/);
		await expectNoSetupWrites();
	});
	it.each(["obsidian-setup", "setup", "research-setup"])(
		"%s expands the same skill workflow",
		async (name) => {
			const h = harness();
			await h.commands.get(name).handler("保留已有结构", h.ctx);
			expect(h.ctx.ui.input).not.toHaveBeenCalled();
			expect(h.pi.sendUserMessage).not.toHaveBeenCalled();
			await flushSetupHandoff();
			const [message, options] = h.pi.sendUserMessage.mock.calls[0];
			expect(message).toMatch(/^\/skill:research-vault setup/);
			expect(message).toContain("保留已有结构");
			expect(options.expandPromptTemplates).toBe(true);
			await expectNoSetupWrites();
		},
	);
	it("session hints advertise the canonical name and bound skill", async () => {
		const h = harness();
		await h.events.get("session_start")({}, h.ctx);
		expect(h.pi.sendMessage.mock.calls[0][0].content).toContain("/obsidian-setup");
		expect(h.pi.sendMessage.mock.calls[0][0].content).toContain("research-vault");
	});
});
