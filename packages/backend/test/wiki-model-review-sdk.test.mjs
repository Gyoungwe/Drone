import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fauxToolCall as call, fauxProvider, fauxAssistantMessage as reply } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { closeKnowledgeServices, getKnowledgeService } from "../../../.pi/lib/knowledge/service.mjs";
import { stageWikiProposal } from "../../../.pi/lib/knowledge/wiki-review.mjs";
import { configureObsidian } from "../../../.pi/lib/obsidian-workbench.mjs";
import { PiBackend } from "../src/pi-backend";

let root, cwd, vault, backend, session, sid, faux, preview;
beforeEach(async () => {
	root = await realpath(await mkdtemp(join(tmpdir(), "percho-review-sdk-")));
	cwd = join(root, "project");
	vault = join(root, "Vault");
	const agentDir = join(root, "agent");
	await mkdir(cwd);
	await mkdir(agentDir);
	vi.stubEnv("PERCHO_KNOWLEDGE_DIR", join(root, "app"));
	vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
	vi.stubEnv("PI_RESEARCH_DESKTOP_CONFIG", undefined);
	const bound = await configureObsidian({ cwd, vault, project: "a" });
	await writeFile(join(vault, "Wiki/Index.md"), "# Index");
	await writeFile(join(vault, "Library/Papers/a.md"), "# Source\nAn observation under condition A only.");
	const service = await getKnowledgeService(),
		prep = await service.prepare({ cwd, project: "a" });
	await service.request("reconcile");
	await service.read(prep.ticket, cwd, { path: "Library/Papers/a.md" });
	const p = await stageWikiProposal(service, prep.ticket, cwd, {
		path: "Wiki/topic.md",
		title: "Topic",
		markdown: "Observation under condition A only.",
		rationale: "Source-scoped summary.",
		source_paths: ["Library/Papers/a.md"],
	});
	const runtime = await ModelRuntime.create({
		authPath: join(agentDir, "auth.json"),
		modelsPath: null,
		modelsStorePath: join(agentDir, "models-cache.json"),
		allowModelNetwork: false,
		refreshOnCreate: false,
	});
	faux = fauxProvider({ provider: "review-fixture" });
	runtime.registerNativeProvider(faux.provider);
	vi.spyOn(runtime, "hasConfiguredAuth").mockReturnValue(true);
	backend = new PiBackend({
		projectTrust: true,
		subagentPreferBuiltin: false,
		webFetch: false,
		desktopIntegration: {
			appendSystemPrompt: [],
			additionalExtensionPaths: [resolve("../../.pi/extensions/obsidian-workbench.mjs")],
			additionalSkillPaths: [],
		},
	});
	backend.modelRuntime = runtime;
	const meta = await backend.createSession({ cwd, provider: faux.provider.id, modelId: faux.getModel().id });
	sid = meta.sessionId;
	session = backend.registry.get(sid).session;
	preview = await backend.knowledge.preview({ cwd, id: p.id, revision: bound.bindingRevision });
});
afterEach(async () => {
	backend?.dispose();
	await closeKnowledgeServices();
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	await rm(root, { recursive: true, force: true });
});
const input = (autoApply) => ({
	cwd,
	sessionId: sid,
	requestId: randomUUID(),
	token: preview.reviewToken,
	acknowledged: true,
	autoApply,
});
it("desktop model-review host calls one isolated SDK request, preserves chat context and records optional application", async () => {
	let captured;
	session.agent.state.messages = [
		{ role: "user", content: [{ type: "text", text: "PARENT_PRIVATE_HISTORY" }], timestamp: 1 },
	];
	const before = JSON.stringify(session.messages);
	faux.setResponses([
		(context) => {
			captured = context;
			return reply(
				[
					call("knowledge_submit", {
						summary: "Limited scope supported.",
						source_paths: ["Library/Papers/a.md"],
						cautions: [],
						verdict: "approve",
						checks: {
							evidenceSupportsChanges: true,
							scopeAndUncertaintyPreserved: true,
							noUnresolvedContradictions: true,
							humanContentPreserved: true,
							noInstructionInjection: true,
						},
					}),
				],
				{ stopReason: "toolUse" },
			);
		},
	]);
	const result = await backend.reviewKnowledgeWithModel(input(true));
	expect(result.applied).toBe(true);
	expect(result.humanReviewed).toBe(false);
	expect(faux.state.callCount).toBe(1);
	expect(JSON.stringify(captured)).not.toContain("PARENT_PRIVATE_HISTORY");
	expect(captured.tools.map((t) => t.name)).toEqual(["knowledge_submit"]);
	expect(JSON.stringify(session.messages)).toBe(before);
	expect(await readFile(join(vault, "Wiki/topic.md"), "utf8")).toContain("condition A only");
});
it("a request from another project cannot borrow the current model review authority", async () => {
	await expect(
		backend.reviewKnowledgeWithModel({ ...input(false), cwd: join(root, "another") }),
	).rejects.toThrow("originating");
	expect(faux.state.callCount).toBe(0);
});
it("untrusted projects cannot invoke a model review", async () => {
	vi.spyOn(session.settingsManager, "isProjectTrusted").mockReturnValue(false);
	await expect(backend.reviewKnowledgeWithModel(input(false))).rejects.toThrow("trusted");
	expect(faux.state.callCount).toBe(0);
});
