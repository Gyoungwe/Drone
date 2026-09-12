import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxToolCall as call, fauxAssistantMessage as reply } from "@earendil-works/pi-ai";
import { KNOWLEDGE_REVIEWER, PROTECTED_KNOWLEDGE_AGENTS } from "@percho/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeKnowledgeServices, getKnowledgeService } from "../../../.pi/lib/knowledge/service.mjs";
import { setSpecialistSettings, specialistSettings } from "../../../.pi/lib/knowledge/specialist-host.mjs";
import { knowledgePreviewReview } from "../../../.pi/lib/knowledge/ui-service.mjs";
import { lastWikiModelReview, reviewWikiWithModel } from "../../../.pi/lib/knowledge/wiki-model-review.mjs";
import {
	mergeWikiProposal,
	previewWikiProposal,
	stageWikiProposal,
} from "../../../.pi/lib/knowledge/wiki-review.mjs";
import { configureObsidian } from "../../../.pi/lib/obsidian-workbench.mjs";
import { runKnowledgeSpecialist } from "../src/knowledge/specialist-runner";

let root, cwd, vault, service, prep, revision, staged, preview;
const path = "Wiki/topic.md",
	source = "Library/Papers/a.md";
const original =
	"# Topic\n\nHuman paragraph.\n<!-- pi-agent:managed:start -->\nOld conditional statement.\n<!-- pi-agent:managed:end -->\n\n## Human review\nKeep this constraint.\n";
async function note(path, text) {
	await mkdir(join(vault, path, ".."), { recursive: true });
	await writeFile(join(vault, path), text);
}
const valid = (patch) => ({
	summary: "Evidence supports only the stated bounded observation.",
	source_paths: [source],
	cautions: [],
	verdict: "approve",
	checks: {
		evidenceSupportsChanges: true,
		scopeAndUncertaintyPreserved: true,
		noUnresolvedContradictions: true,
		humanContentPreserved: true,
		noInstructionInjection: true,
	},
	...patch,
});
beforeEach(async () => {
	root = await realpath(await mkdtemp(join(tmpdir(), "percho-model-review-")));
	cwd = join(root, "project");
	vault = join(root, "Vault");
	await mkdir(cwd);
	vi.stubEnv("PERCHO_KNOWLEDGE_DIR", join(root, "app"));
	vi.stubEnv("PI_RESEARCH_DESKTOP_CONFIG", undefined);
	vi.stubEnv("PI_SUBAGENT_CHILD", undefined);
	const bound = await configureObsidian({ cwd, vault, project: "a" });
	revision = bound.bindingRevision;
	await note(path, original);
	await note(
		source,
		"# Study\nMeasured the observation under condition A only.\nDo not generalize to other conditions.\n",
	);
	service = await getKnowledgeService();
	prep = await service.prepare({ cwd, project: "a" });
	await service.request("reconcile");
	await service.read(prep.ticket, cwd, { path });
	await service.read(prep.ticket, cwd, { path: source });
	staged = await stageWikiProposal(service, prep.ticket, cwd, {
		path,
		title: "Topic",
		markdown: "An observation was recorded under condition A only.",
		rationale: "Incorporate the recorded source with its scope.",
		source_paths: [source],
	});
	preview = await knowledgePreviewReview({ cwd, id: staged.id, revision });
});
afterEach(async () => {
	await closeKnowledgeServices();
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	await rm(root, { recursive: true, force: true });
});
const input = (autoApply = false) => ({ cwd, token: preview.reviewToken, acknowledged: true, autoApply });
const response = (data) => ({
	data,
	model: "fixture/reviewer",
	usage: { inputTokens: 1200, outputTokens: 90, cost: 0 },
});
const deps = (fn) => ({ check: async () => {}, evaluate: vi.fn(fn || (async () => response(valid()))) });
describe("user-authorized model review", () => {
	it("advice-only by default in the UI flow; audit saved, Wiki unchanged", async () => {
		const d = deps();
		const result = await reviewWikiWithModel(input(), d);
		expect(result.verdict).toBe("approve");
		expect(result.applied).toBe(false);
		expect(result.humanReviewed).toBe(false);
		expect(result.scientificallyVerified).toBe(false);
		expect(await readFile(join(vault, path), "utf8")).toBe(original);
		const record = await lastWikiModelReview(service, staged.id, staged.proposalHash);
		expect(record.auditId).toBe(result.auditId);
		const reloaded = await knowledgePreviewReview({ cwd, id: staged.id, revision });
		expect(reloaded.modelReview.verdict).toBe("approve");
	});
	it("explicit auto-apply writes only the reviewed candidate and preserves human text", async () => {
		const result = await reviewWikiWithModel(input(true), deps());
		expect(result.applied).toBe(true);
		const text = await readFile(join(vault, path), "utf8");
		expect(text).toContain("Human paragraph.");
		expect(text).toContain("Keep this constraint.");
		expect(text).toContain("condition A only");
		expect(result.writeResult.reviewMethod).toBe("model");
		expect(result.writeResult.humanReviewed).toBe(false);
		const saved = JSON.parse(
			await readFile(
				join(root, "app", service.binding.vaultId, "wiki-review", "reviewed", `${staged.id}.json`),
				"utf8",
			),
		);
		expect(saved.reviewMethod).toBe("model");
		expect(saved.modelReview.auditId).toBe(result.auditId);
		expect(saved.humanReviewed).toBe(false);
	});
	it.each(["needs-human", "reject"])("keeps the pending candidate on verdict %s", async (verdict) => {
		const result = await reviewWikiWithModel(
			input(true),
			deps(async () => response(valid({ verdict, cautions: ["Insufficient original source context."] }))),
		);
		expect(result.applied).toBe(false);
		expect((await previewWikiProposal(service, staged.id, "a")).status).toBe("pending");
		expect(await readFile(join(vault, path), "utf8")).toBe(original);
	});
	it("a nominal approve with cautions cannot automatically apply", async () => {
		const result = await reviewWikiWithModel(
			input(true),
			deps(async () => response(valid({ cautions: ["Full text has not been read."] }))),
		);
		expect(result.canAutoApply).toBe(false);
		expect(result.applied).toBe(false);
	});
	it.each([
		"evidenceSupportsChanges",
		"scopeAndUncertaintyPreserved",
		"noUnresolvedContradictions",
		"humanContentPreserved",
		"noInstructionInjection",
	])("a failed %s check prevents writes", async (key) => {
		const data = valid();
		data.checks[key] = false;
		const result = await reviewWikiWithModel(
			input(true),
			deps(async () => response(data)),
		);
		expect(result.applied).toBe(false);
	});
	it("rejects missing consent before model calls or preview consumption", async () => {
		const d = deps();
		await expect(reviewWikiWithModel({ ...input(true), acknowledged: false }, d)).rejects.toThrow("Confirm");
		expect(d.evaluate).not.toHaveBeenCalled();
		expect((await reviewWikiWithModel(input(), d)).verdict).toBe("approve");
	});
	it("refuses reused, foreign-project and invented preview tokens", async () => {
		await reviewWikiWithModel(input(), deps());
		await expect(reviewWikiWithModel(input(true), deps())).rejects.toThrow("expired");
		const fresh = await knowledgePreviewReview({ cwd, id: staged.id, revision });
		await expect(
			reviewWikiWithModel({ ...input(), cwd: join(root, "other"), token: fresh.reviewToken }, deps()),
		).rejects.toThrow("expired");
		await expect(reviewWikiWithModel({ ...input(), token: "forged" }, deps())).rejects.toThrow("expired");
	});
	it("does not send a changed or expired candidate to a model", async () => {
		await note(source, "# Corrected evidence");
		const d = deps();
		await expect(reviewWikiWithModel(input(true), d)).rejects.toThrow("changed");
		expect(d.evaluate).not.toHaveBeenCalled();
	});
	it("source mutation during model execution prevents application", async () => {
		await expect(
			reviewWikiWithModel(
				input(true),
				deps(async () => {
					await note(source, "# Corrected evidence");
					return response(valid());
				}),
			),
		).rejects.toThrow("changed");
		expect(await readFile(join(vault, path), "utf8")).toBe(original);
	});
	it("target mutation during review preserves the human edit", async () => {
		await expect(
			reviewWikiWithModel(
				input(true),
				deps(async () => {
					await note(path, "# Human edited during review");
					return response(valid());
				}),
			),
		).rejects.toThrow("changed");
		expect(await readFile(join(vault, path), "utf8")).toContain("Human edited during review");
	});
	it("merging another round invalidates an in-flight review", async () => {
		await expect(
			reviewWikiWithModel(
				input(true),
				deps(async () => {
					await mergeWikiProposal(service, prep.ticket, cwd, staged.id, {
						markdown: "Another bounded research round.",
						rationale: "New evidence.",
						source_paths: [source],
					});
					return response(valid());
				}),
			),
		).rejects.toThrow("changed");
		expect((await previewWikiProposal(service, staged.id, "a")).proposalHash).not.toBe(staged.proposalHash);
		expect(await readFile(join(vault, path), "utf8")).toBe(original);
	});
	it("cancellation refuses publication even after a valid model result", async () => {
		const controller = new AbortController();
		await expect(
			reviewWikiWithModel(input(true), {
				...deps(async () => {
					controller.abort();
					return response(valid());
				}),
				signal: controller.signal,
			}),
		).rejects.toThrow();
		expect(await readFile(join(vault, path), "utf8")).toBe(original);
	});
	it("missing source validation is not accepted as a complete review", async () => {
		await expect(
			reviewWikiWithModel(
				input(true),
				deps(async () => response(valid({ source_paths: ["Library/Papers/invented.md"] }))),
			),
		).rejects.toThrow("incomplete");
	});
	it("model failure is visible and does not write or claim success", async () => {
		await expect(
			reviewWikiWithModel(
				input(true),
				deps(async () => {
					throw new Error("Provider unavailable");
				}),
			),
		).rejects.toThrow("Provider unavailable");
		expect(await readFile(join(vault, path), "utf8")).toBe(original);
	});
	it("review packet contains exact notes, target and protected text, but no main transcript", async () => {
		const d = deps();
		await reviewWikiWithModel(input(), d);
		const req = d.evaluate.mock.calls[0][0],
			packet = JSON.parse(req.packet);
		expect(packet.sources[0].text).toContain("condition A only");
		expect(packet.protectedHumanText).toContain("Keep this constraint");
		expect(req.capabilities).toEqual([]);
		expect(req).not.toHaveProperty("parentMessages");
		expect(req.role).toBe("reviewer");
		const turn = await service.prepare({ cwd, project: "a" });
		await expect(service.evidenceReceipts(turn.ticket, cwd, [source])).rejects.toThrow("not read");
	});
	it("rechecks external session/trust authorization after a model result", async () => {
		let trusted = true;
		await expect(
			reviewWikiWithModel(input(true), {
				check: async () => {
					if (!trusted) throw new Error("Trust revoked");
				},
				evaluate: async () => {
					trusted = false;
					return response(valid());
				},
			}),
		).rejects.toThrow("revoked");
	});
	it("candidate changes during review do not show a stale model report", async () => {
		await reviewWikiWithModel(input(), deps());
		await mergeWikiProposal(service, prep.ticket, cwd, staged.id, {
			markdown: "New evidence changes the pending patch.",
			rationale: "New round.",
			source_paths: [source],
		});
		const newPreview = await knowledgePreviewReview({ cwd, id: staged.id, revision });
		expect(newPreview.modelReview).toBeNull();
	});
});
describe("reviewer capability profile", () => {
	it("has only structured submission and cannot run tools or rewrite the candidate", async () => {
		expect(KNOWLEDGE_REVIEWER.permissions).toEqual(["knowledge_submit"]);
		expect(PROTECTED_KNOWLEDGE_AGENTS.map((p) => p.name)).toContain("knowledge-wiki-reviewer");
		let captured;
		const runtime = {
			completeSimple: async (_model, context) => {
				captured = context;
				return reply([call("knowledge_submit", valid())], { stopReason: "toolUse" });
			},
		};
		const result = await runKnowledgeSpecialist(
			{ getRuntime: async () => runtime, getModelPreference: async () => undefined },
			{
				role: "reviewer",
				task: "Review",
				packet: "assigned source data",
				capabilities: [],
				parentModel: { provider: "fixture", id: "model" },
				check: async () => {},
				progress: () => {},
			},
		);
		expect(captured.tools.map((t) => t.name)).toEqual(["knowledge_submit"]);
		expect(result.data.verdict).toBe("approve");
	});
	it("forbids forged approval tools even in a valid model response", async () => {
		const runtime = {
			completeSimple: async () => reply([call("approve", { approved: true })], { stopReason: "toolUse" }),
		};
		await expect(
			runKnowledgeSpecialist(
				{ getRuntime: async () => runtime, getModelPreference: async () => undefined },
				{
					role: "reviewer",
					task: "Review",
					packet: "data",
					capabilities: [],
					parentModel: { provider: "fixture", id: "model" },
					check: async () => {},
					progress: () => {},
				},
			),
		).rejects.toThrow("forbidden");
	});
});

it("global off mode blocks model review without enabling itself", async () => {
	const settings = await specialistSettings();
	await setSpecialistSettings({ mode: "off", revision: settings.revision, bindingRevision: revision });
	const d = deps();
	await expect(reviewWikiWithModel(input(), d)).rejects.toThrow("disabled");
	expect(d.evaluate).not.toHaveBeenCalled();
});
