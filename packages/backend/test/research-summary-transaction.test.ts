import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { createSummaryWriteTransaction } from "../../extensions/src/internal/summary-write-transaction";

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function workspace() {
	const root = await mkdtemp(join(tmpdir(), "drone-summary-rollback-"));
	roots.push(root);
	return root;
}

it("restores original bytes and removes only this delivery's newly written files", async () => {
	const root = await workspace(),
		original = join(root, "SUMMARY.md"),
		added = join(root, "history.md");
	await writeFile(original, "existing summary");
	const transaction = createSummaryWriteTransaction();
	await transaction.write(original, "reviewed summary");
	await transaction.write(added, "reviewed summary");
	await transaction.rollback();
	expect(await readFile(original, "utf8")).toBe("existing summary");
	await expect(readFile(added)).rejects.toMatchObject({ code: "ENOENT" });
});

it("retains concurrent human edits and reports partial rollback while restoring other owned writes", async () => {
	const root = await workspace(),
		edited = join(root, "human.md"),
		other = join(root, "SUMMARY.md");
	await writeFile(other, "prior summary");
	const transaction = createSummaryWriteTransaction();
	await transaction.write(other, "reviewed summary");
	await transaction.write(edited, "generated block");
	await writeFile(edited, "human changed this file");
	await expect(transaction.rollback()).rejects.toThrow("Partial summary delivery");
	expect(await readFile(edited, "utf8")).toBe("human changed this file");
	expect(await readFile(other, "utf8")).toBe("prior summary");
});

it("refuses a stale Vault preimage before overwriting a changed managed block", async () => {
	const path = join(await workspace(), "note.md");
	await writeFile(path, "human edited after the adapter read");
	const transaction = createSummaryWriteTransaction();
	await expect(transaction.write(path, "generated replacement", Buffer.from("old note"))).rejects.toThrow(
		"changed before writing",
	);
	expect(await readFile(path, "utf8")).toBe("human edited after the adapter read");
});
