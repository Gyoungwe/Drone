import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configureObsidian } from "@drone/extensions/internal/obsidian-workbench";
import { readReviewMode, saveReviewMode } from "@drone/knowledge";
import { closeKnowledgeServices, getKnowledgeService } from "@drone/knowledge/service";
import {
	autoApplyWikiProposal,
	decideWikiProposal,
	stageWikiProposal,
	undoWikiUpdate,
	wikiHistory,
} from "@drone/knowledge/wiki-review";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

let root, cwd, vault, service, prep;
const source = "Library/Papers/source.md",
	path = "Wiki/automatic.md";
vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 });
beforeEach(async () => {
	root = await realpath(await mkdtemp(join(tmpdir(), "automatic-review-")));
	cwd = join(root, "project");
	vault = join(root, "Vault");
	await mkdir(cwd);
	vi.stubEnv("DRONE_KNOWLEDGE_DIR", join(root, "app"));
	vi.stubEnv("DRONE_REVIEW_MODE", "automatic");
	vi.stubEnv("PI_RESEARCH_DESKTOP_CONFIG", undefined);
	vi.stubEnv("PI_SUBAGENT_CHILD", undefined);
	await configureObsidian({ cwd, vault, project: "test" });
	await writeFile(join(vault, source), "# Source\nA bounded observation.\n");
	service = await getKnowledgeService();
	prep = await service.prepare({ cwd, project: "test" });
	await service.request("reconcile");
	await service.read(prep.ticket, cwd, { path: source });
});
afterEach(async () => {
	await closeKnowledgeServices();
	vi.unstubAllEnvs();
	await rm(root, { recursive: true, force: true });
});
const stage = () =>
	stageWikiProposal(service, prep.ticket, cwd, {
		path,
		title: "Automatic",
		markdown: "Bounded observation. [[Library/Papers/source]]",
		rationale: "Organize evidence",
		source_paths: [source],
	});
const accept = (candidate) =>
	decideWikiProposal(service, candidate.id, "test", candidate.proposalHash, "apply", { actor: "human" });
it("queues a new AI page for human review, archives exact history and supports safe undo", async () => {
	const candidate = await stage();
	expect(candidate.status).toBe("pending");
	const saved = await accept(candidate);
	expect(saved.status).toBe("applied");
	expect(saved.humanReviewed).toBe(true);
	expect(saved.reviewMethod).toBe("human");
	expect(saved.scientificallyVerified).toBe(false);
	const history = await wikiHistory(service, "test");
	expect(history).toHaveLength(1);
	expect(await readFile(join(vault, path), "utf8")).toContain("Bounded observation");
	await undoWikiUpdate(service, "test", saved.id, history[0].afterHash);
	await expect(readFile(join(vault, path))).rejects.toMatchObject({ code: "ENOENT" });
});
it("strict mode stages without touching live Wiki", async () => {
	await saveReviewMode("strict");
	expect(readReviewMode()).toBe("strict");
	expect((await stage()).status).toBe("pending");
	await expect(readFile(join(vault, path))).rejects.toMatchObject({ code: "ENOENT" });
});
it("does not overwrite human edits, and undo refuses an intervening human change", async () => {
	const saved = await accept(await stage()),
		history = await wikiHistory(service, "test");
	await writeFile(join(vault, path), "# Human-authored revision\nKeep this.\n");
	await service.read(prep.ticket, cwd, { path });
	expect((await stage()).status).toBe("pending");
	await expect(undoWikiUpdate(service, "test", saved.id, history[0].afterHash)).rejects.toThrow(
		"overwrite edits",
	);
	expect(await readFile(join(vault, path), "utf8")).toContain("Keep this");
});
it("updates an unchanged AI-owned page and restores its previous version on undo", async () => {
	await accept(await stage());
	const before = await readFile(join(vault, path), "utf8");
	await service.read(prep.ticket, cwd, { path });
	const candidate = await stageWikiProposal(service, prep.ticket, cwd, {
		path,
		title: "Automatic",
		markdown: "Updated bounded observation. [[Library/Papers/source]]",
		rationale: "Refine",
		source_paths: [source],
	});
	const updated = await accept(candidate);
	expect(updated.status).toBe("applied");
	const item = (await wikiHistory(service, "test")).find((p) => p.id === updated.id);
	await undoWikiUpdate(service, "test", updated.id, item.afterHash);
	expect(await readFile(join(vault, path), "utf8")).toBe(before);
});

const auto = (candidate) => autoApplyWikiProposal(service, candidate.id, "test", candidate.proposalHash);
it("automatic mode writes a new page straight into the Vault without human review", async () => {
	const applied = await auto(await stage());
	expect(applied.status).toBe("applied");
	expect(applied.reviewMethod).toBe("automatic");
	expect(applied.humanReviewed).toBe(false);
	expect(await readFile(join(vault, path), "utf8")).toContain("Bounded observation");
	expect(await wikiHistory(service, "test")).toHaveLength(1);
});
it("automatic mode keeps a human-edited page pending for review", async () => {
	await auto(await stage());
	await writeFile(join(vault, path), "# Human-authored revision\nKeep this.\n");
	await service.read(prep.ticket, cwd, { path });
	const result = await auto(await stage());
	expect(result.status).toBe("pending");
	expect(result.reason).toContain("requires confirmation");
	expect(await readFile(join(vault, path), "utf8")).toContain("Keep this");
});
it("strict mode never auto-applies", async () => {
	await saveReviewMode("strict");
	const result = await auto(await stage());
	expect(result).toMatchObject({ status: "pending", reason: "strict-review" });
	await expect(readFile(join(vault, path))).rejects.toMatchObject({ code: "ENOENT" });
});
