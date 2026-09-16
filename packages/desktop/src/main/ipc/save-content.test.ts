import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { materializeSaveContent } from "./save-content";

let root: string | undefined;
afterEach(async () => {
	if (root) await rm(root, { recursive: true, force: true });
	root = undefined;
});

describe("materializeSaveContent", () => {
	it("reads SDK export paths before writing the chosen destination", async () => {
		root = await mkdtemp(join(tmpdir(), "drone-export-"));
		const source = join(root, "session.jsonl");
		await writeFile(source, '{"role":"user","content":"hello"}\n', "utf8");
		expect(await materializeSaveContent(source)).toContain('"hello"');
		expect(await readFile(source, "utf8")).toContain('"hello"');
	});

	it("keeps inline export text unchanged", async () => {
		expect(await materializeSaveContent('{"content":"hello"}')).toBe('{"content":"hello"}');
	});
});
