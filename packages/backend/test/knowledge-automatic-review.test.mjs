import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readReviewMode, saveReviewMode } from "../../../.pi/lib/knowledge/review-policy.mjs";
import { closeKnowledgeServices, getKnowledgeService } from "../../../.pi/lib/knowledge/service.mjs";
import { stageWikiProposal, undoWikiUpdate, wikiHistory } from "../../../.pi/lib/knowledge/wiki-review.mjs";
import { configureObsidian } from "../../../.pi/lib/obsidian-workbench.mjs";

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
it("automatically saves a new AI page, archives exact history and supports safe undo", async () => {
	const saved = await stage();
	expect(saved.status).toBe("applied");
	expect(saved.humanReviewed).toBe(false);
	expect(saved.reviewMethod).toBe("automatic");
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
	const saved = await stage(),
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
	await stage();
	const before = await readFile(join(vault, path), "utf8");
	await service.read(prep.ticket, cwd, { path });
	const updated = await stageWikiProposal(service, prep.ticket, cwd, {
		path,
		title: "Automatic",
		markdown: "Updated bounded observation. [[Library/Papers/source]]",
		rationale: "Refine",
		source_paths: [source],
	});
	expect(updated.status).toBe("applied");
	const item = (await wikiHistory(service, "test")).find((p) => p.id === updated.id);
	await undoWikiUpdate(service, "test", updated.id, item.afterHash);
	expect(await readFile(join(vault, path), "utf8")).toBe(before);
});
