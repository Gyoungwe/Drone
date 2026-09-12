import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { expect, it, vi } from "vitest";
import { AskGate } from "../src/session/ask-gate";
import { makeUiContext } from "../src/session/ui-context";
import { slashCommandsForSession } from "../src/slash-commands";
import { makeAskUserTool } from "../src/tools/ask-user";

// Real SDK + AskGate; model output is simulated and no provider is contacted.
it("Obsidian command expands its skill, bridges questions and gates fixture Vault writes", async () => {
	const root = await mkdtemp(join(tmpdir(), "percho-obsidian-skill-sdk-"));
	const cwd = join(root, "actual-project"),
		vault = join(root, "Knowledge Vault");
	const agentDir = join(root, "agent");
	const requests = [],
		errors = [];
	const askGate = new AskGate((request) => {
		requests.push(request);
		return true;
	});
	let session;
	vi.stubEnv("PI_SUBAGENT_CHILD", undefined);
	vi.stubEnv("PI_RESEARCH_DESKTOP_CONFIG", undefined);
	vi.stubEnv("PI_OBSIDIAN_MCP_SERVER", undefined);
	try {
		await Promise.all([mkdir(cwd), mkdir(vault), mkdir(agentDir)]);
		await writeFile(join(cwd, "README.md"), "Fixture project: literature evidence extraction.");
		await writeFile(join(vault, "Human note.md"), "Keep this human-authored note.");
		const server = join(root, "fixture-server.js");
		await writeFile(server, "// Fixture launcher; never executed.");
		await writeFile(
			join(cwd, ".mcp.json"),
			JSON.stringify({
				mcpServers: {
					"research-obsidian": { command: process.execPath, args: [server, vault] },
				},
			}),
		);
		const settingsManager = SettingsManager.create(cwd, agentDir);
		const resourceLoader = new DefaultResourceLoader({
			cwd,
			agentDir,
			settingsManager,
			additionalExtensionPaths: [resolve("../../.pi/extensions/obsidian-workbench.mjs")],
			additionalSkillPaths: [resolve("../../.pi/skills/research-vault/SKILL.md")],
		});
		await resourceLoader.reload();
		expect(resourceLoader.getExtensions().errors).toEqual([]);
		const runtime = await ModelRuntime.create({
			authPath: join(agentDir, "auth.json"),
			modelsPath: null,
			modelsStorePath: join(agentDir, "models-cache.json"),
			allowModelNetwork: false,
			refreshOnCreate: false,
		});
		vi.spyOn(runtime, "hasConfiguredAuth").mockReturnValue(true);
		const noNetwork = vi.spyOn(runtime, "streamSimple").mockImplementation(() => {
			throw new Error("Unexpected provider request");
		});
		({ session } = await createAgentSession({
			cwd,
			agentDir,
			resourceLoader,
			settingsManager,
			sessionManager: SessionManager.inMemory(cwd),
			modelRuntime: runtime,
			model: {
				id: "fixture",
				provider: "fixture",
				name: "fixture",
				api: "openai-completions",
				baseUrl: "https://example.invalid",
				input: ["text"],
				reasoning: false,
				contextWindow: 128000,
				maxTokens: 8192,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			},
			customTools: [makeAskUserTool({ ask: (request, signal) => askGate.ask(request, signal) })],
		}));
		askGate.bindSession(session.sessionId);
		await session.bindExtensions({
			mode: "tui",
			onError: (error) => errors.push(error),
			uiContext: makeUiContext({ confirm: vi.fn(async () => false) }, askGate),
		});
		const commands = slashCommandsForSession(session);
		expect(commands.filter((command) => command.name === "obsidian-setup")).toHaveLength(1);
		expect(commands.filter((command) => command.name === "skill:research-vault")).toHaveLength(1);
		const modelPrompt = vi.spyOn(session.agent, "prompt").mockResolvedValue(undefined);
		const kickoff = session.prompt("/obsidian-setup 保留已有文献分类");
		await vi.waitFor(() => expect(requests).toHaveLength(1));
		expect(requests[0].questions[0].type).toBe("text");
		askGate.respond(requests[0].id, { kind: "answer", answers: { value: { customText: vault } } });
		await kickoff;
		await vi.waitFor(() => expect(modelPrompt).toHaveBeenCalledOnce());
		const expanded = JSON.stringify(modelPrompt.mock.calls[0][0]);
		expect(expanded).toContain('<skill name=\\"research-vault\\"');
		expect(expanded).toContain("## Setup");
		expect(expanded).toContain("ask_user");
		expect(expanded).toContain("保留已有文献分类");
		expect(expanded).toContain("actual-project");
		expect(expanded).not.toContain("Fixture project: literature evidence extraction.");
		const workspaceFile = join(cwd, ".pi/research-workspace.json");
		await expect(access(workspaceFile)).rejects.toMatchObject({ code: "ENOENT" });
		const tool = (name) => session.agent.state.tools.find((item) => item.name === name);
		const discovery = await tool("research_setup_options").execute("discover", { path: vault });
		expect(discovery.details.context.workspace.path).toMatch(/actual-project$/);
		expect(discovery.details.binding.skill).toBe("research-vault");
		// Simulate the model's questionnaire after it receives the skill/context.
		const choices = { profile: "hybrid", deposit_mode: "verified", subagent_mcp: "read-local" };
		const questions = Object.entries(choices).map(([id, value]) => ({
			id,
			prompt: `Confirm ${id}`,
			type: "single",
			required: true,
			options: [{ value, label: value }],
		}));
		const interview = tool("ask_user").execute("interview", {
			title: "Obsidian MCP · 项目知识结构",
			questions,
		});
		await vi.waitFor(() => expect(requests).toHaveLength(2));
		expect(requests[1].questions).toHaveLength(3);
		askGate.respond(requests[1].id, {
			kind: "answer",
			answers: Object.fromEntries(Object.entries(choices).map(([id, value]) => [id, { values: [value] }])),
		});
		expect((await interview).details.answers.profile.values).toEqual(["hybrid"]);
		const applying = tool("research_setup_obsidian").execute("apply", {
			path: vault,
			project: "fixture-research",
			...choices,
		});
		await vi.waitFor(() => expect(requests).toHaveLength(3));
		expect(requests[2].questions[0].prompt).toContain(cwd);
		await expect(access(workspaceFile)).rejects.toMatchObject({ code: "ENOENT" });
		askGate.respond(requests[2].id, { kind: "answer", answers: { value: { values: ["确认应用此方案"] } } });
		const result = await applying;
		expect(result.details.state).toBe("ready");
		expect(result.details.connectionVerified).toBe(false);
		expect(await readFile(join(vault, "Human note.md"), "utf8")).toBe("Keep this human-authored note.");
		expect(JSON.parse(await readFile(workspaceFile, "utf8")).knowledgeProfile).toBe("hybrid");
		expect(errors).toEqual([]);
		expect(noNetwork).not.toHaveBeenCalled();
	} finally {
		askGate.dispose();
		session?.dispose();
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
		await rm(root, { recursive: true, force: true });
	}
});
