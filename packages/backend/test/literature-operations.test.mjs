import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { saveWorkspaceConfig } from "../../../.pi/extensions/workspace-config.mjs";
import {
	destinationRecovery,
	reconcileLiteratureOperation,
} from "../../../.pi/lib/literature-operations.mjs";
import { startResearchRun } from "../../../.pi/lib/research-loop.mjs";

let cwd, runDir;
beforeEach(async () => {
	vi.stubEnv("DRONE_KNOWLEDGE_DIR", undefined);
	vi.stubEnv("PI_RESEARCH_DESKTOP_CONFIG", undefined);
	cwd = await mkdtemp(join(tmpdir(), "research-operation-"));
	await mkdir(join(cwd, "Vault"));
	await saveWorkspaceConfig(cwd, { obsidianVault: join(cwd, "Vault") });
	runDir = (await startResearchRun({ cwd, resultSlug: "fixture", query: "test" })).run_dir;
});
afterEach(async () => {
	vi.unstubAllEnvs();
	await rm(cwd, { recursive: true, force: true });
});
const input = () => ({
	cwd,
	runDir,
	doi: "10.1234/paper",
	zoteroKey: "ABCDEFGH",
	notePath: "Library/Papers/paper.md",
});
it("uncertain responses never authorize another import or overwrite", () => {
	const a = destinationRecovery({ zotero: { status: "unavailable" }, obsidian: { status: "verified" } });
	expect(a.completed).toBe(false);
	expect(a.zotero.action).toBe("read-back-before-any-import");
	expect(a.obsidian.action).toBe("preserve-existing-note");
	expect(a.zotero.autoWrite).toBe(false);
});
it("persists partial state and safely reconciles only after fresh readback", async () => {
	const verify = vi
		.fn()
		.mockResolvedValueOnce({ zotero: { status: "verified" }, obsidian: { status: "missing" } })
		.mockResolvedValueOnce({ zotero: { status: "verified" }, obsidian: { status: "verified" } });
	const partial = await reconcileLiteratureOperation(input(), { verify });
	expect(partial.destinations.obsidian.action).toBe("deposit-missing-note-with-authorization");
	const complete = await reconcileLiteratureOperation(input(), { verify });
	expect(complete.operation_id).toBe(partial.operation_id);
	expect(complete.attempts).toBe(2);
	expect(complete.writesToLibraries).toBe(0);
	expect(complete.destinations.completed).toBe(true);
	const log = JSON.parse(await readFile(complete.log_path, "utf8"));
	expect(log.operations[complete.operation_id].history).toHaveLength(2);
	await expect(
		reconcileLiteratureOperation({ ...input(), zoteroKey: "BCDEFGHJ" }, { verify }),
	).rejects.toThrow("identity changed");
});
it("parallel operations retain both records instead of last-writer-wins", async () => {
	const verify = async () => ({ zotero: { status: "verified" }, obsidian: { status: "verified" } });
	const [a, b] = await Promise.all([
		reconcileLiteratureOperation(input(), { verify }),
		reconcileLiteratureOperation({ ...input(), doi: "10.1234/other" }, { verify }),
	]);
	const log = JSON.parse(await readFile(a.log_path, "utf8"));
	expect(Object.keys(log.operations)).toEqual(expect.arrayContaining([a.operation_id, b.operation_id]));
});
it("refuses a log outside the research results root", async () => {
	await expect(reconcileLiteratureOperation({ ...input(), runDir: cwd })).rejects.toThrow(
		"inside a research run",
	);
});
