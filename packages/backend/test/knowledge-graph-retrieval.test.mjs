import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configureObsidian } from "@drone/extensions/internal/obsidian-workbench";
import { closeKnowledgeServices, getKnowledgeService } from "@drone/knowledge/service";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

let root, cwd, vault, app;
beforeEach(async () => {
	vi.stubEnv("DRONE_REVIEW_MODE", "automatic");
	root = await realpath(await mkdtemp(join(tmpdir(), "drone-graph-retrieval-")));
	cwd = join(root, "project-a");
	vault = join(root, "Vault");
	app = join(root, "app-state");
	await mkdir(cwd);
	vi.stubEnv("DRONE_KNOWLEDGE_DIR", app);
	vi.stubEnv("PI_RESEARCH_DESKTOP_CONFIG", undefined);
	vi.stubEnv("PI_SUBAGENT_CHILD", undefined);
});
afterEach(async () => {
	await closeKnowledgeServices();
	vi.unstubAllEnvs();
	await rm(root, { recursive: true, force: true });
});
async function note(path, text) {
	await mkdir(join(vault, path, ".."), { recursive: true });
	await writeFile(join(vault, path), text);
}

describe("graph-augmented knowledge search", () => {
	it("expands top hits by one hop over links and backlinks, with backlink context", async () => {
		await configureObsidian({ cwd, vault, project: "project-a" });
		await note(
			"Library/Papers/dhx16.md",
			"# DHX16 helicase zetaquery\n\nDomain notes. [[Library/Papers/recA|RecA]]\n",
		);
		await note("Library/Papers/recA.md", "# RecA-like fold\n\nStructural background only.\n");
		await note("Notes/review.md", "# Review\n\nCompare with ![[dhx16#Domains|DHX16]] across species.\n");
		await note("Notes/unrelated.md", "# Unrelated\n\nNothing linked.\n");
		const service = await getKnowledgeService();
		const prep = await service.prepare({ cwd, project: "project-a", query: "zetaquery" });
		await service.request("reconcile");
		const result = await service.search(prep.ticket, cwd, { query: "zetaquery", limit: 5 });
		const paths = result.hits.map((hit) => hit.path);
		expect(paths[0]).toBe("Library/Papers/dhx16.md");
		expect(paths).toContain("Library/Papers/recA.md");
		expect(paths).toContain("Notes/review.md");
		expect(paths).not.toContain("Notes/unrelated.md");
		const back = result.hits.find((hit) => hit.path === "Notes/review.md");
		expect(back.retrieval).toBe("graph");
		expect(back.graph.direction).toBe("backlink");
		expect(back.graph.context).toContain("across species");
		expect(result.retrievalMetrics.graphAccepted).toBe(2);
	});
});
