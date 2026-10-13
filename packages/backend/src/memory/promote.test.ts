import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { listMemories } from "../project/memory";
import { promoteObservation } from "./promote";
import { MemoryStore } from "./store";

let store: MemoryStore;
let dir: string;
afterEach(() => {
	store?.close();
	if (dir) rmSync(dir, { recursive: true, force: true });
});

const add = (projectId: string, sourceKey: string, title: string) =>
	store.add({ projectId, sessionId: "s1", sourceKey, kind: "command", title, body: "Error: 样本数不足" });

it("promotes an observation into .pi/memory and removes it from observations", () => {
	store = new MemoryStore(":memory:");
	dir = mkdtempSync(join(tmpdir(), "mem-promote-"));
	add("p1", "c1", "Rscript deseq2.R");
	const [hit] = store.list("p1");
	const file = promoteObservation(store, dir, "p1", hit!.id);
	const [entry] = listMemories(dir);
	expect(entry).toMatchObject({ type: "project", description: "Rscript deseq2.R", file });
	expect(entry!.body).toContain("样本数不足");
	expect(readFileSync(join(dir, ".pi", "memory", "MEMORY.md"), "utf8")).toContain(file);
	expect(store.list("p1")).toEqual([]);
	expect(store.search("p1", "deseq2")).toEqual([]);
});

it("refuses ids from another project and remove only touches this project", () => {
	store = new MemoryStore(":memory:");
	dir = mkdtempSync(join(tmpdir(), "mem-promote-"));
	add("p2", "c1", "other");
	const other = store.list("p2")[0]!;
	expect(() => promoteObservation(store, dir, "p1", other.id)).toThrow();
	expect(store.remove("p1", other.id)).toBe(false);
	expect(store.remove("p2", other.id)).toBe(true);
	expect(store.status("p2").count).toBe(0);
});
