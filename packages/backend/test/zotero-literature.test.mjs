import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import zoteroLiterature from "../../../.pi/extensions/zotero-literature.mjs";
import { closeKnowledgeServices } from "../../../.pi/lib/knowledge/service.mjs";
import { normalizeSourceLinks } from "../../../.pi/lib/knowledge/source-links.mjs";
import { configureObsidian, depositKnowledge } from "../../../.pi/lib/obsidian-workbench.mjs";
import {
	bootstrapZotero,
	inspectZotero,
	installZoteroMcp,
	readZoteroMcp,
	registerZoteroMcp,
	setupZoteroAgentMessage,
	uvBootstrapCommand,
	zoteroMcpSpec,
} from "../../../.pi/lib/zotero-setup.mjs";
import { detectCapabilities, toolCapabilities } from "../src/capabilities/runtime";

let root, cwd, vault, agentDir;
beforeEach(async () => {
	root = await realpath(await mkdtemp(join(tmpdir(), "drone-zotero-")));
	cwd = join(root, "project");
	vault = join(root, "Vault");
	agentDir = join(root, "agent");
	await mkdir(cwd);
	await mkdir(agentDir);
	vi.stubEnv("DRONE_KNOWLEDGE_DIR", join(root, "app"));
	vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
	await configureObsidian({ cwd, vault, project: "project-a" });
});
afterEach(async () => {
	await closeKnowledgeServices();
	vi.unstubAllEnvs();
	if (root) await rm(root, { recursive: true, force: true });
});

describe("zotero literature identity", () => {
	it("turns zotero item keys into local select links without treating them as Vault evidence", async () => {
		await writeFile(join(vault, "Library/Papers/source.md"), "# Fixture");
		const result = await normalizeSourceLinks(["zotero:ABCD1234", "Library/Papers/source", "zotero:bad"], {
			cwd,
			vault,
			resultsRoot: join(cwd, "results"),
			project: "project-a",
		});
		expect(result.links[0]).toBe("[Zotero ABCD1234](zotero://select/library/items/ABCD1234)");
		expect(result.links[1]).toBe("[[Library/Papers/source]]");
		expect(result.unresolved).toEqual(["zotero:bad"]);
	});

	it("stores Zotero identity on paper notes and rejects it on other types", async () => {
		const result = await depositKnowledge({
			cwd,
			project: "project-a",
			type: "paper",
			title: "Fixture paper",
			markdown: "Question and limits only.",
			zoteroKey: "ABCD1234",
			zoteroCitekey: "smith2024",
			sourceLinks: ["10.1093/example"],
		});
		const body = await readFile(result.note, "utf8");
		expect(body).toContain('zotero_key: "ABCD1234"');
		expect(body).toContain('zotero_citekey: "smith2024"');
		expect(body).toContain("zotero://select/library/items/ABCD1234");
		expect(body).toContain("https://doi.org/10.1093/example");
		expect(result.note.replaceAll("\\", "/")).toContain("Library/Papers/");
		await expect(
			depositKnowledge({
				cwd,
				project: "project-a",
				type: "evidence",
				title: "Not a paper",
				markdown: "Observation",
				sourceLinks: ["Library/Papers/fixture-paper"],
				zoteroKey: "ABCD1234",
			}),
		).rejects.toThrow("paper notes");
	});
});

describe("Windows BOM config compatibility", () => {
	it("reads BOM config without mutating it and preserves fields during registration", async () => {
		const path = join(agentDir, "mcp.json");
		const input =
			"\uFEFF" +
			JSON.stringify({
				mcpServers: {
					other: { command: "keep" },
					zotero: { command: "old", disabled: true, env: { ZOTERO_API_KEY: "fixture-only" } },
				},
			});
		await writeFile(path, input);
		expect((await readZoteroMcp({ agentDirectory: agentDir })).registered).toBe(true);
		expect(await readFile(path, "utf8")).toBe(input);
		await registerZoteroMcp({ agentDirectory: agentDir, command: "new" });
		const value = JSON.parse(await readFile(path, "utf8"));
		expect(value.mcpServers.other.command).toBe("keep");
		expect(value.mcpServers.zotero.env.ZOTERO_API_KEY).toBe("fixture-only");
		expect(value.mcpServers.zotero.disabled).toBe(true);
	});
	it("does not hide invalid JSON behind BOM tolerance", async () => {
		await writeFile(join(agentDir, "mcp.json"), "\uFEFF{invalid");
		await expect(readZoteroMcp({ agentDirectory: agentDir })).rejects.toThrow();
	});
});

describe("optional Zotero MCP registration", () => {
	it("registers a disabled local server and preserves existing secrets", async () => {
		await writeFile(
			join(agentDir, "mcp.json"),
			JSON.stringify({
				mcpServers: {
					zotero: {
						command: "old-zotero-mcp",
						env: { ZOTERO_API_KEY: "secret", ZOTERO_LOCAL: "true" },
					},
				},
			}),
		);
		const result = await registerZoteroMcp({
			agentDirectory: agentDir,
			command: "C:\\\\tools\\\\zotero-mcp.exe",
			enable: false,
		});
		expect(result.registered).toBe(true);
		expect(result.disabled).toBe(false);
		expect(result.command).toBe("old-zotero-mcp");
		const raw = JSON.parse(await readFile(join(agentDir, "mcp.json"), "utf8"));
		expect(raw.mcpServers.zotero.env.ZOTERO_API_KEY).toBe("secret");
		expect(JSON.stringify(zoteroMcpSpec("zotero-mcp"))).not.toContain("secret");
	});

	it("writes a new disabled zotero server for a missing config", async () => {
		const result = await registerZoteroMcp({
			agentDirectory: agentDir,
			command: "/usr/bin/zotero-mcp",
		});
		expect(result.registered).toBe(true);
		expect(result.disabled).toBe(true);
		expect(result.command).toBe("/usr/bin/zotero-mcp");
		expect(
			JSON.parse(await readFile(join(agentDir, "mcp.json"), "utf8")).mcpServers.zotero.env.ZOTERO_LOCAL,
		).toBe("true");
	});

	it("reports unreachable local API without claiming the library is empty", async () => {
		const status = await inspectZotero({
			agentDirectory: agentDir,
			homeDir: join(root, "empty-home"),
			whichImpl: async () => null,
			execFileImpl: async () => {
				throw new Error("no python");
			},
			fetchImpl: async () => {
				throw Object.assign(new Error("ECONNREFUSED"), { name: "TypeError" });
			},
		});
		expect(status.localApi.reachable).toBe(false);
		expect(status.boundary).toContain("not a publication receipt");
		expect(status.remaining.map((step) => step.id)).toContain("install-cli");
		expect(setupZoteroAgentMessage({ status })).toContain("/skill:zotero-literature setup");
	});
});

describe("from-zero zotero-mcp-server install", () => {
	const none = async () => null;
	it("uses a fixed uv argv and does not spawn a shell string", async () => {
		const homeDir = join(root, "home-uv");
		const bin = join(homeDir, ".local", "bin");
		await mkdir(bin, { recursive: true });
		const recorded = [];
		const whichImpl = async (name) => {
			if (name === "uv") return "/opt/uv";
			if (name === "zotero-mcp" || name === "zotero-cli") return join(bin, name);
			return null;
		};
		const result = await installZoteroMcp({
			homeDir,
			whichImpl,
			installer: { name: "uv", file: "/opt/uv", args: ["tool", "install", "zotero-mcp-server"] },
			execFileImpl: async (file, args) => {
				recorded.push({ file, args });
				if (args.includes("install")) {
					await writeFile(join(bin, "zotero-mcp"), "");
					await writeFile(join(bin, "zotero-cli"), "");
				}
				if (args[0] === "tool" && args[1] === "dir") return { stdout: `${bin}\n`, stderr: "" };
				return { stdout: "ok", stderr: "" };
			},
		});
		expect(recorded[0]).toEqual({
			file: "/opt/uv",
			args: ["tool", "install", "zotero-mcp-server"],
		});
		expect(JSON.stringify(recorded)).not.toContain("claude_desktop");
		expect(result.commands.zoteroMcp).toContain("zotero-mcp");
	});

	it("bootstrap confirms, installs, then registers a disabled MCP server", async () => {
		const homeDir = join(root, "home-boot");
		const bin = join(homeDir, ".local", "bin");
		await mkdir(bin, { recursive: true });
		const confirm = vi.fn(async () => true);
		const whichImpl = async (name) => {
			if (name === "uv") return "/opt/uv";
			if ((name === "zotero-mcp" || name === "zotero-cli") && existsSync(join(bin, name)))
				return join(bin, name);
			return null;
		};
		const result = await bootstrapZotero({
			agentDirectory: agentDir,
			homeDir,
			confirm,
			whichImpl,
			fetchImpl: async () => {
				throw Object.assign(new Error("ECONNREFUSED"), { name: "TypeError" });
			},
			execFileImpl: async (file, args) => {
				if (file !== "/opt/uv") throw new Error(`unexpected ${file}`);
				if (args.includes("install")) {
					await writeFile(join(bin, "zotero-mcp"), "");
					await writeFile(join(bin, "zotero-cli"), "");
				}
				if (args[0] === "tool" && args[1] === "dir") return { stdout: `${bin}\n`, stderr: "" };
				return { stdout: "ok", stderr: "" };
			},
		});
		expect(confirm).toHaveBeenCalledOnce();
		expect(confirm.mock.calls[0][0]).toContain("zotero-mcp-server");
		expect(result.cancelled).toBeNull();
		expect(result.steps.map((step) => step.action)).toEqual(["install", "register-mcp"]);
		expect(result.status.mcp.registered).toBe(true);
		expect(result.status.mcp.disabled).toBe(true);
	});

	it("does not install when the user cancels", async () => {
		const execFileImpl = vi.fn();
		const result = await bootstrapZotero({
			agentDirectory: agentDir,
			homeDir: join(root, "home-cancel"),
			confirm: async () => false,
			whichImpl: none,
			execFileImpl,
			fetchImpl: async () => {
				throw Object.assign(new Error("ECONNREFUSED"), { name: "TypeError" });
			},
		});
		expect(result.cancelled).toBe("install-uv");
		expect(execFileImpl).not.toHaveBeenCalled();
	});

	it("keeps the official uv bootstrap URL in a constant argv", () => {
		const command = uvBootstrapCommand();
		expect(command.args.join(" ")).toContain("https://astral.sh/uv/install");
		expect(command.args.join(" ")).not.toContain("claude");
	});
});

describe("capability routing", () => {
	it("loads research plus external for Zotero requests without treating CLI as knowledge evidence", () => {
		// 能力来自扩展 registerTool 的 drone.capabilities 声明（挂钩 1）
		zoteroLiterature({
			registerTool: () => {},
			registerCommand: () => {},
			getCommands: () => [],
			events: { on: () => {}, emit: async () => {} },
		});
		expect(detectCapabilities("在 zotero 里找这篇论文")).toEqual(
			expect.arrayContaining(["research", "external"]),
		);
		expect(toolCapabilities("research_zotero_status")).toEqual(["research", "external"]);
		expect(toolCapabilities("research_setup_zotero")).toEqual(["research", "external"]);
		// 未声明能力的 research_* 工具退回核心启发式
		expect(toolCapabilities("research_undeclared_probe")).toEqual(["research"]);
	});
});

it("slash command is labeled as from-zero install", () => {
	const commands = new Map();
	zoteroLiterature({
		registerTool: () => {},
		registerCommand: (name, command) => commands.set(name, command),
		getCommands: () => [],
	});
	expect(commands.get("zotero-setup").description).toContain("从零安装");
});

it("ships a parseable zotero-literature skill", async () => {
	const text = await readFile(
		new URL("../../../.pi/skills/zotero-literature/SKILL.md", import.meta.url),
		"utf8",
	);
	const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	expect(frontmatter).not.toBeNull();
	const metadata = parse(frontmatter[1]);
	expect(metadata.name).toBe("zotero-literature");
	// 挂钩 5：常驻声明写在 SKILL.md，核心不再硬编码技能名
	expect(metadata.alwaysWith).toBe("research");
	expect(text).toContain("/zotero-setup");
	expect(text).toContain("zotero-cli");
	expect(text).toContain("not a receipt");
});
