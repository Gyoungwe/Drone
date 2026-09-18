import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fauxProvider } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { researchSkillPackPaths } from "../../desktop/src/main/research-skill-packs";
import { PiBackend } from "../src/pi-backend";

const packs = resolve(import.meta.dirname, "../../desktop/resources/research-skills");
const installed = existsSync(join(packs, "academic/.drone-pack.json"));
let root, backend, modelRuntime, cwd, faux, paths, session;
describe.skipIf(!installed)("ARS through the real PiBackend / SDK session (offline faux provider)", () => {
	beforeEach(async () => {
		root = await realpath(await mkdtemp(join(tmpdir(), "drone-ars-sdk-")));
		cwd = join(root, "project");
		const agentDir = join(root, "agent");
		await mkdir(cwd);
		await mkdir(agentDir);
		vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
		vi.stubEnv("DRONE_KNOWLEDGE_DIR", join(root, "knowledge"));
		modelRuntime = await ModelRuntime.create({
			authPath: join(agentDir, "auth.json"),
			modelsPath: null,
			allowModelNetwork: false,
			refreshOnCreate: false,
		});
		faux = fauxProvider({ provider: "ars-offline-smoke" });
		modelRuntime.registerNativeProvider(faux.provider);
		vi.spyOn(modelRuntime, "hasConfiguredAuth").mockReturnValue(true);
		paths = researchSkillPackPaths(packs, { includeAcademic: true });
		expect(paths.warnings).toEqual([]);
		expect(paths.paths).toHaveLength(172);
		expect(paths.promptPaths).toHaveLength(16);
	});
	afterEach(async () => {
		await session?.abort();
		session = undefined;
		backend?.dispose();
		backend = undefined;
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
		if (root) await rm(root, { recursive: true, force: true });
	});
	function makeBackend(extraExtensions = []) {
		const value = new PiBackend({
			projectTrust: false,
			desktopIntegration: {
				appendSystemPrompt: [],
				additionalSkillPaths: paths.paths,
				additionalPromptTemplatePaths: paths.promptPaths,
				academicPiRoot: paths.academicPiRoot,
				additionalExtensionPaths: extraExtensions,
			},
		});
		value.modelRuntime = modelRuntime;
		return value;
	}
	it("registers Pi commands and applies one consistent visibility policy to real SDK prompts", async () => {
		backend = makeBackend();
		const { sessionId: sid } = await backend.createSession({
			cwd,
			provider: faux.provider.id,
			modelId: faux.getModel().id,
		});
		const commands = await backend.listSlashCommands(sid);
		expect(commands.some((c) => c.name === "ars-plan")).toBe(true);
		expect(commands.some((c) => c.name === "ars-pi-start")).toBe(true);
		session = backend.registry.get(sid).session;
		const send = async (text) => {
			await backend.prompt(sid, text);
			await session.waitForIdle();
		};
		await send("/ars-full");
		const selected = (await backend.getLoadedResources(sid)).capabilities.visibleSkills;
		expect(
			selected.filter((n) =>
				["academic-pipeline", "academic-paper", "academic-paper-reviewer", "deep-research"].includes(n),
			),
		).toEqual(["academic-pipeline"]);
		expect(session.agent.state.systemPrompt).toContain("Academic Research Skills compatibility for Pi");
		const message = session.messages.find(
			(m) =>
				m.role === "user" &&
				Array.isArray(m.content) &&
				m.content.some((c) => c.type === "text" && c.text.startsWith('<skill name="academic-pipeline"')),
		);
		expect(message).toBeTruthy();
		await send("你好");
		expect(session.agent.state.systemPrompt).not.toContain("Academic Research Skills compatibility for Pi");
		expect((await backend.getLoadedResources(sid)).capabilities.visibleSkills).toEqual([]);
		await send("/ars-plan topic");
		await send("/ars-pi-stop");
		await send("继续");
		expect((await backend.getLoadedResources(sid)).capabilities.visibleSkills).not.toContain(
			"academic-paper",
		);
		expect(session.agent.state.systemPrompt).not.toContain("Academic Research Skills compatibility for Pi");
	}, 30000);
	it("rejects installing the vanilla wrapper and host bridge together", async () => {
		backend = makeBackend([join(paths.academicPiRoot, "pi/wrapper.js")]);
		await expect(
			backend.createSession({ cwd, provider: faux.provider.id, modelId: faux.getModel().id }),
		).rejects.toThrow(/Do not run the standalone wrapper/);
	}, 30000);
});
