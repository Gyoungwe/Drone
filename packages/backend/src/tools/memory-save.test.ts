import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type MemorySaveDetails, makeMemorySaveTool } from "./memory-save";

const run = async (cwd: string, trusted: boolean, params: Record<string, unknown>) =>
	makeMemorySaveTool().execute("t", params as any, undefined, undefined, {
		cwd,
		isProjectTrusted: () => trusted,
	} as any) as Promise<{ content: unknown[]; details: MemorySaveDetails }>;

describe("H2 memory_save", () => {
	it("saves feedback, indexes it, and can forget", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "mem-"));
		const r = await run(cwd, true, { type: "feedback", name: "引用格式", body: "参考文献用 GB/T 7714" });
		expect((r.content[0] as { text: string }).text).toMatch(/^已记住：引用格式/);
		const file = r.details.file;
		expect(readFileSync(join(cwd, ".pi/memory/MEMORY.md"), "utf8")).toContain(file);
		const f = await run(cwd, true, { action: "forget", file });
		expect(f.details.removed).toBe(true);
		expect(readFileSync(join(cwd, ".pi/memory/MEMORY.md"), "utf8")).not.toContain(file);
	});
	it("rejects untrusted projects and other types", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "mem-"));
		await expect(run(cwd, false, { type: "user", name: "a", body: "b" })).rejects.toThrow(/trusted/);
		await expect(run(cwd, true, { type: "project", name: "a", body: "b" })).rejects.toThrow(/type/);
		const f = await run(cwd, true, { action: "forget", file: "../x.md" });
		expect(f.details.removed).toBe(false);
	});
});
