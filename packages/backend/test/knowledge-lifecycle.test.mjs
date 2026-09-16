import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { KnowledgeService } from "../../../.pi/lib/knowledge/service.mjs";

let root, vault, service;
beforeEach(async () => {
	// Production bindings canonicalize the Vault; Windows CI TEMP may use an 8.3 alias.
	root = await realpath(await mkdtemp(join(tmpdir(), "knowledge-lifecycle-")));
	vault = join(root, "Vault");
	await mkdir(vault);
	await Promise.all(
		Array.from({ length: 80 }, (_, i) =>
			writeFile(join(vault, `note-${i}.md`), `# Evidence ${i}\nLifecycle regression.\n`),
		),
	);
	service = new KnowledgeService({ vault, vaultId: "fixture", revision: 1 }, join(root, "state"));
});
afterEach(async () => {
	await service.close();
	await rm(root, { recursive: true, force: true });
});

it("concurrent close waits for the same worker exit and releases SQLite files", async () => {
	await service.request("warm");
	const pending = service.request("reconcile");
	const first = service.close();
	expect(service.close()).toBe(first);
	await expect(service.request("status")).rejects.toThrow("closed");
	await pending;
	await first;
	expect(service.worker.threadId).toBe(-1);
	expect(service.pending.size).toBe(0);
	// No retry or sleep: completion must mean handles are actually released on Windows.
	await rm(join(root, "state"), { recursive: true });
});

it("reconcile waits for pending directory scans before reporting ready", async () => {
	await service.request("warm");
	await mkdir(join(vault, "new-notes"));
	await writeFile(join(vault, "new-notes", "new.md"), "# New evidence\n");
	const status = await service.request("reconcile");
	expect(status.problems).toEqual([]);
	expect(status.coverage).toBe("ready");
	expect(status.noteCount).toBe(81);
});
