import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configureObsidian } from "@drone/extensions/internal/obsidian-workbench";
import { readKnowledgeBinding } from "@drone/knowledge/config";
import { closeKnowledgeServices, getKnowledgeService, KnowledgeService } from "@drone/knowledge/service";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let root, vault, cwd, app;
beforeEach(async () => {
	root = await realpath(await mkdtemp(join(tmpdir(), "drone-worker-race-")));
	vault = join(root, "Vault");
	cwd = join(root, "project");
	app = join(root, "app");
	await mkdir(cwd);
	await mkdir(join(vault, "Library/Papers"), { recursive: true });
	vi.stubEnv("DRONE_KNOWLEDGE_DIR", app);
	vi.stubEnv("PI_RESEARCH_DESKTOP_CONFIG", undefined);
});
afterEach(async () => {
	await closeKnowledgeServices();
	vi.unstubAllEnvs();
	await rm(root, { recursive: true, force: true });
});

describe("knowledge workers sharing one index database", () => {
	it("index a new note concurrently without an FTS rowid constraint failure", async () => {
		await configureObsidian({ cwd, vault, project: "project-a" });
		const binding = await readKnowledgeBinding();
		const a = new KnowledgeService(binding, app);
		const b = new KnowledgeService(binding, app);
		try {
			await a.request("reconcile");
			await b.request("reconcile");
			for (let round = 0; round < 5; round++) {
				const path = `Library/Papers/new-${round}.md`;
				await writeFile(join(vault, path), `# New ${round}\nfresh evidence ${round}`);
				const results = await Promise.allSettled([
					a.request("changed", { paths: [path] }),
					b.request("changed", { paths: [path] }),
				]);
				expect(results.filter((r) => r.status === "rejected").map((r) => r.reason.message)).toEqual([]);
			}
			const found = await a
				.request("search", { query: "fresh evidence", project: "project-a", limit: 10 })
				.catch(() => null);
			if (found) expect(JSON.stringify(found)).toContain("new-4");
		} finally {
			await a.close();
			await b.close();
		}
	});

	it("shares one worker per database across binding revisions", async () => {
		await configureObsidian({ cwd, vault, project: "project-a" });
		const binding = await readKnowledgeBinding();
		const first = await getKnowledgeService(binding);
		expect(await getKnowledgeService(binding)).toBe(first);
		const second = await getKnowledgeService({ ...binding, revision: (binding.revision ?? 0) + 1 });
		expect(second).not.toBe(first);
		expect(first.closed).toBe(true);
	});
});
