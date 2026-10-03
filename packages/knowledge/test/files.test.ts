import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	allowedSegment,
	canRead,
	fileVersion,
	inspectNote,
	MAX_NOTE_BYTES,
	noteScope,
	readNoteFile,
	safeNotePath,
	snippet,
	validateNote,
} from "../src/files";

let vault: string;

beforeEach(async () => {
	vault = await realpath(await mkdtemp(join(tmpdir(), "drone-knowledge-files-")));
	await mkdir(join(vault, "Projects", "alpha"), { recursive: true });
});

afterEach(async () => {
	await rm(vault, { recursive: true, force: true });
});

describe("knowledge file boundaries", () => {
	it("filters hidden, secret and generated path segments", () => {
		expect(allowedSegment("Notes")).toBe(true);
		expect(allowedSegment(".obsidian")).toBe(false);
		expect(allowedSegment("secrets.json")).toBe(false);
		expect(allowedSegment("Attachments")).toBe(false);
	});

	it("accepts canonical markdown paths and rejects traversal or casing drift", () => {
		expect(() => validateNote("Projects/alpha/Context.md")).not.toThrow();
		expect(() => validateNote("../outside.md")).toThrow("allowed Vault-relative");
		expect(() => validateNote("projects/alpha/Context.md")).toThrow("canonical casing");
		expect(() => validateNote("Projects/alpha/Context.txt")).toThrow("allowed Vault-relative");
	});

	it("scopes project notes separately from shared notes", () => {
		expect(noteScope("Projects/alpha/Context.md")).toBe("alpha");
		expect(noteScope("Wiki/Index.md")).toBe("shared");
		expect(canRead("Projects/alpha/Context.md", "alpha")).toBe(true);
		expect(canRead("Projects/alpha/Context.md", "beta")).toBe(false);
	});

	it("reads a stable bounded note and reports its hash and signature", async () => {
		const path = "Projects/alpha/Context.md";
		await writeFile(join(vault, path), "# Alpha\nsecond line\n", "utf8");
		const result = await readNoteFile(vault, path);
		expect(result).toMatchObject({
			path,
			text: "# Alpha\nsecond line\n",
			bytes: Buffer.byteLength("# Alpha\nsecond line\n"),
		});
		expect(result.hash).toMatch(/^[a-f0-9]{64}$/);
		expect(result.signature).toBe(fileVersion((await inspectNote(vault, path)).stat));
		expect(relative(vault, await safeNotePath(vault, path)).replaceAll("\\", "/")).toBe(path);
	});

	it("rejects symlinked notes and oversized notes", async () => {
		await writeFile(join(vault, "outside.md"), "outside", "utf8");
		await symlink(join(vault, "outside.md"), join(vault, "Projects", "alpha", "Linked.md"));
		await expect(readNoteFile(vault, "Projects/alpha/Linked.md")).rejects.toThrow("symlinks");
		await writeFile(join(vault, "Projects", "alpha", "Large.md"), Buffer.alloc(MAX_NOTE_BYTES + 1));
		await expect(readNoteFile(vault, "Projects/alpha/Large.md")).rejects.toThrow("1 MiB");
	});
});

describe("snippet", () => {
	it("returns bounded lines with source coordinates", () => {
		expect(snippet("one\ntwo\nthree", { startLine: 2, maxChars: 4 })).toEqual({
			text: "two",
			startLine: 2,
			endLine: 2,
			totalLines: 3,
			truncated: true,
		});
	});
});
