import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fauxProvider } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PiBackend } from "../src/pi-backend";

let root, cwd, agentDir, backend, sid;
beforeEach(async () => {
	root = await realpath(await mkdtemp(join(tmpdir(), "drone-capability-footprint-")));
	cwd = join(root, "project");
	agentDir = join(root, "agent");
	await mkdir(cwd);
	await mkdir(agentDir);
	vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
	vi.stubEnv("DRONE_KNOWLEDGE_DIR", join(root, "knowledge"));
	const runtime = await ModelRuntime.create({
		authPath: join(agentDir, "auth.json"),
		modelsPath: null,
		allowModelNetwork: false,
		refreshOnCreate: false,
	});
	const faux = fauxProvider({ provider: "capability-benchmark" });
	runtime.registerNativeProvider(faux.provider);
	vi.spyOn(runtime, "hasConfiguredAuth").mockReturnValue(true);
	const workbench = resolve(import.meta.dirname, "../../..", ".pi");
	const manifest = JSON.parse(await readFile(join(workbench, "lib/workbench-manifest.json"), "utf8"));
	backend = new PiBackend({
		projectTrust: false,
		permissionGates: false,
		desktopIntegration: {
			appendSystemPrompt: [],
			additionalExtensionPaths: manifest.extensions.map((name) => join(workbench, "extensions", name)),
			additionalSkillPaths: manifest.skills.map((name) => join(workbench, "skills", name, "SKILL.md")),
		},
	});
	backend.modelRuntime = runtime;
	const meta = await backend.createSession({ cwd, provider: faux.provider.id, modelId: faux.getModel().id });
	sid = meta.sessionId;
});
afterEach(async () => {
	backend?.dispose();
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	if (root) await rm(root, { recursive: true, force: true });
});

it("records the real research-workbench lazy schema footprint", async () => {
	const initial = (await backend.getLoadedResources(sid)).capabilities;
	expect(initial).toBeTruthy();
	expect(initial.footprint.allTools).toBeGreaterThan(10);
	expect(initial.footprint.reductionRatio).toBeGreaterThan(0.5);
	await backend.prompt(sid, "请检索转录组文献并核对知识库证据");
	const research = (await backend.getLoadedResources(sid)).capabilities;
	const report = {
		initial: initial.footprint,
		research: research.footprint,
		activeCapabilities: research.activeCapabilities,
	};
	console.log("CAPABILITY_FOOTPRINT=" + JSON.stringify(report));
	expect(research.activeCapabilities).toEqual(expect.arrayContaining(["knowledge", "research"]));
	expect(research.footprint.activeToolSchemaBytes).toBeLessThan(research.footprint.allToolSchemaBytes);
});
