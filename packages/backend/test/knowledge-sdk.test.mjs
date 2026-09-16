import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
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
import { closeKnowledgeServices } from "../../../.pi/lib/knowledge/service.mjs";
import { configureObsidian } from "../../../.pi/lib/obsidian-workbench.mjs";

it("real SDK delivers global navigation before model invocation in an unrelated project", async () => {
	const root = await realpath(await mkdtemp(join(tmpdir(), "percho-knowledge-sdk-")));
	const a = join(root, "A"),
		b = join(root, "B"),
		agentDir = join(root, "agent");
	let session;
	vi.stubEnv("PERCHO_KNOWLEDGE_DIR", join(root, "app"));
	vi.stubEnv("PI_RESEARCH_DESKTOP_CONFIG", undefined);
	vi.stubEnv("PI_SUBAGENT_CHILD", undefined);
	try {
		await Promise.all([mkdir(a), mkdir(b), mkdir(agentDir)]);
		const bound = await configureObsidian({ cwd: a, vault: join(root, "Vault"), project: "project-a" });
		const settingsManager = SettingsManager.create(b, agentDir);
		const resourceLoader = new DefaultResourceLoader({
			cwd: b,
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
			throw new Error("Network not allowed");
		});
		({ session } = await createAgentSession({
			cwd: b,
			agentDir,
			settingsManager,
			resourceLoader,
			modelRuntime: runtime,
			sessionManager: SessionManager.inMemory(b),
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
		}));
		const errors = [];
		await session.bindExtensions({ onError: (error) => errors.push(error) });
		const model = vi.spyOn(session.agent, "prompt").mockResolvedValue(undefined);
		await session.prompt("请先了解当前知识库，再解释研究流程。", { expandPromptTemplates: false });
		expect(model).toHaveBeenCalledOnce();
		const payload = JSON.stringify(model.mock.calls[0][0]);
		expect(payload).toContain("percho-knowledge-navigation");
		expect(payload).toContain("Wiki/Index.md");
		// Navigation embeds JSON inside a custom message; decode it before comparing paths.
		const navigation = model.mock.calls[0][0].find(
			(message) => message.customType === "percho-knowledge-navigation",
		);
		expect(navigation).toBeDefined();
		const content = navigation.content;
		expect(JSON.parse(content.slice(content.indexOf("\n") + 1)).binding.vault).toBe(bound.vault);
		expect(payload).not.toContain('"ticket"');
		expect(session.getActiveToolNames()).toContain("research_search_knowledge");
		expect(errors).toEqual([]);
		expect(noNetwork).not.toHaveBeenCalled();
	} finally {
		session?.dispose();
		await closeKnowledgeServices();
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
		await rm(root, { recursive: true, force: true });
	}
});
