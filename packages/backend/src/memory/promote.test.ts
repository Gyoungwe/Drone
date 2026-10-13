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

it("distills into the knowledge base once, with provenance, and stops injecting", async () => {
	const { promoteToKnowledge } = await import("./promote");
	store = new MemoryStore(":memory:");
	store.add({
		projectId: "p1",
		sessionId: "s1",
		sourceKey: "c1",
		kind: "change",
		title: "修改 deseq2.R",
		body: "",
	});
	store.add({
		projectId: "p1",
		sessionId: "s1",
		sourceKey: "c2",
		kind: "command",
		title: "Rscript deseq2.R",
		body: "ok",
	});
	const cmd = store.list("p1").find((h) => h.kind === "command")!;
	const calls: unknown[] = [];
	const knowledge = {
		saveMemory: async (_cwd: string, memory: unknown) => {
			calls.push(memory);
			return { path: "Projects/p1/Memory/x-m2.md" };
		},
	};
	await expect(promoteToKnowledge(store, knowledge, "/w", "p1", cmd.id)).resolves.toEqual({
		path: "Projects/p1/Memory/x-m2.md",
	});
	expect(calls[0]).toMatchObject({ sessionId: "s1", files: ["deseq2.R"], title: "Rscript deseq2.R" });
	expect(store.find("p1", cmd.id)?.promotedTo).toBe("Projects/p1/Memory/x-m2.md");
	expect(store.search("p1", "Rscript").map((h) => h.id)).not.toContain(cmd.id);
	await promoteToKnowledge(store, knowledge, "/w", "p1", cmd.id);
	expect(calls).toHaveLength(1);
});
