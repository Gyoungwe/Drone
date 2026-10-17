import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fauxAssistantMessage, fauxProvider, getCurrentSystemPrompt } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PiBackend } from "../src/pi-backend";

const repoRoot = resolve(import.meta.dirname, "../../..");
const firstPartySkill = join(repoRoot, ".pi/skills/research-workflow/SKILL.md");
const evidencePath = "/private/tmp/drone-skill-01-evidence.json";
const disabledEvidencePath = "/private/tmp/drone-skill-01-disabled-evidence.json";

const sessions = [];
const backends = [];
const roots = [];

afterEach(async () => {
	for (const session of sessions.splice(0)) await session?.abort().catch(() => {});
	for (const backend of backends.splice(0)) backend?.dispose();
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function makeSession(skillPath) {
	const root = await realpath(await mkdtemp(join("/tmp", "drone-skill-01-")));
	roots.push(root);
	const cwd = join(root, "project");
	const agentDir = join(root, "agent");
	await Promise.all([mkdir(cwd), mkdir(agentDir)]);
	vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
	vi.stubEnv("DRONE_KNOWLEDGE_DIR", join(root, "knowledge"));
	const modelRuntime = await ModelRuntime.create({
		authPath: join(agentDir, "auth.json"),
		modelsPath: null,
		modelsStorePath: join(agentDir, "models.json"),
		allowModelNetwork: false,
		refreshOnCreate: false,
	});
	const faux = fauxProvider({ provider: `skill-01-${roots.length}` });
	modelRuntime.registerNativeProvider(faux.provider);
	vi.spyOn(modelRuntime, "hasConfiguredAuth").mockReturnValue(true);
	const backend = new PiBackend({
		projectTrust: false,
		permissionGates: false,
		desktopIntegration: {
			appendSystemPrompt: [],
			additionalSkillPaths: [skillPath],
		},
	});
	backend.modelRuntime = modelRuntime;
	const created = await backend.createSession({
		cwd,
		provider: faux.provider.id,
		modelId: faux.getModel().id,
	});
	const session = backend.registry.get(created.sessionId).session;
	sessions.push(session);
	backends.push(backend);
	return { backend, cwd, faux, session, sessionId: created.sessionId, skillPath };
}

async function runPrompt(fixture, text) {
	let systemPrompt = "";
	fixture.faux.setResponses([
		(context) => {
			systemPrompt = getCurrentSystemPrompt(context.messages);
			return fauxAssistantMessage("DRONE-SKILL-01-OK");
		},
	]);
	await fixture.backend.prompt(fixture.sessionId, text);
	await fixture.session.waitForIdle();
	return { systemPrompt, resources: await fixture.backend.getLoadedResources(fixture.sessionId) };
}

const hasSkillInvocation = (session, name) =>
	session.messages.filter(
		(message) =>
			message.role === "user" &&
			Array.isArray(message.content) &&
			message.content.some((part) => part.type === "text" && part.text.startsWith(`<skill name="${name}"`)),
	).length;

// This is a real Pi SDK AgentSession through Drone's PiBackend, with the network disabled and a faux provider.
describe("SKILL-01 real invocation and disabled counter-evidence", () => {
	it("invokes the shipped research-workflow skill and records visible metadata plus invocation evidence", async () => {
		expect(existsSync(firstPartySkill)).toBe(true);
		const fixture = await makeSession(firstPartySkill);
		const result = await runPrompt(fixture, "/skill:research-workflow summarize the evidence boundary");
		const invocationCount = hasSkillInvocation(fixture.session, "research-workflow");
		const lastInvocation = fixture.session.messages
			.filter((message) => message.role === "user" && Array.isArray(message.content))
			.findLast((message) =>
				message.content.some(
					(part) => part.type === "text" && part.text.startsWith('<skill name="research-workflow"'),
				),
			);
		const skill = result.resources.skills.find((item) => item.name === "research-workflow");
		expect(skill).toMatchObject({ name: "research-workflow", disableModelInvocation: false });
		expect(result.resources.capabilities.visibleSkills).toContain("research-workflow");
		expect(result.systemPrompt).toContain("research-workflow");
		expect(invocationCount).toBe(1);
		expect(lastInvocation).toBeDefined();
		expect(JSON.stringify(lastInvocation)).toContain("evidence boundary");
		expect(fixture.faux.state.callCount).toBe(1);
		await writeFile(
			evidencePath,
			JSON.stringify(
				{
					gate: "SKILL-01",
					status: "PASS",
					mode: "real-pi-sdk-faux-provider",
					skill: {
						name: skill.name,
						// Keep evidence portable and free of local absolute paths.
						path: skill.path ? skill.path.replaceAll("\\", "/").split("/").slice(-2).join("/") : null,
						disableModelInvocation: skill.disableModelInvocation,
						visible: result.resources.capabilities.visibleSkills.includes("research-workflow"),
					},
					invocation: {
						command: "/skill:research-workflow summarize the evidence boundary",
						count: invocationCount,
						lastUserMessage: {
							role: lastInvocation.role,
							args: "summarize the evidence boundary",
							lastUsedAt: lastInvocation.timestamp,
							canonical: true,
						},
						providerCalls: fixture.faux.state.callCount,
						modelReply: "DRONE-SKILL-01-OK",
					},
				},
				null,
				2,
			),
		);
	});

	it("proves a disabled skill is absent from automatic selection while preserving explicit manual-only semantics", async () => {
		const root = await realpath(await mkdtemp(join("/tmp", "drone-skill-01-disabled-")));
		roots.push(root);
		const disabledSkill = join(root, "research-workflow", "SKILL.md");
		const original = await readFile(firstPartySkill, "utf8");
		await mkdir(join(root, "research-workflow"), { recursive: true });
		await writeFile(
			disabledSkill,
			original.replace("alwaysWith: research", "alwaysWith: research\ndisable-model-invocation: true"),
		);
		const fixture = await makeSession(disabledSkill);
		const result = await runPrompt(fixture, "请做一次科研证据检索并说明研究流程");
		const skill = result.resources.skills.find((item) => item.name === "research-workflow");
		expect(skill).toMatchObject({ name: "research-workflow", disableModelInvocation: true });
		expect(result.resources.capabilities.visibleSkills).not.toContain("research-workflow");
		expect(result.systemPrompt).not.toContain("<name>research-workflow</name>");
		expect(hasSkillInvocation(fixture.session, "research-workflow")).toBe(0);
		expect(fixture.faux.state.callCount).toBe(1);

		// Pi's documented contract keeps an explicitly typed /skill command available for a
		// manual-only skill; disabling model invocation only removes automatic discovery.
		const manual = await runPrompt(fixture, "/skill:research-workflow manual check");
		expect(manual.resources.capabilities.visibleSkills).toContain("research-workflow");
		expect(hasSkillInvocation(fixture.session, "research-workflow")).toBe(1);
		expect(fixture.faux.state.callCount).toBe(2);
		await writeFile(
			disabledEvidencePath,
			JSON.stringify(
				{
					gate: "SKILL-01",
					status: "PASS",
					mode: "real-pi-sdk-faux-provider",
					skill: { name: "research-workflow", disableModelInvocation: true },
					automatic: { visible: false, invocationCount: 0, lastUsedAt: null, providerCalls: 1 },
					manual: {
						command: "/skill:research-workflow manual check",
						visible: true,
						invocationCount: 1,
						lastUsedAt: Date.now(),
						providerCalls: 2,
					},
					contract:
						"disable-model-invocation removes automatic discovery; explicit /skill remains available by Pi design",
				},
				null,
				2,
			),
		);
	});
});
