import { afterEach, describe, expect, it } from "vitest";
import { MemoryStore, searchGrams } from "./store";

let store: MemoryStore;
afterEach(() => store?.close());

const obs = (over: Partial<Parameters<MemoryStore["add"]>[0]> = {}) => ({
	projectId: "p1",
	sessionId: "s1",
	sourceKey: "call-1",
	kind: "change" as const,
	title: "修改 analysis/deseq2.R",
	body: "",
	...over,
});

describe("memory store", () => {
	it("splits CJK into bigrams and keeps latin words", () => {
		expect(searchGrams("差异分析 DESeq2 a")).toEqual(["差异", "异分", "分析", "deseq2"]);
	});

	it("finds Chinese observations by a partial phrase, scoped to the project", () => {
		store = new MemoryStore(":memory:");
		store.add(obs({ title: "差异表达分析用 apeglm 收缩" }));
		store.add(obs({ sourceKey: "call-2", title: "画火山图" }));
		store.add(obs({ projectId: "p2", sourceKey: "call-3", title: "差异表达（别的项目）" }));
		const hits = store.search("p1", "再做一次差异表达", { excludeSession: "s9" });
		expect(hits[0]?.title).toBe("差异表达分析用 apeglm 收缩");
		expect(hits.every((h) => !h.title.includes("别的项目"))).toBe(true);
	});

	it("dedups by unique source key and skips the current session", () => {
		store = new MemoryStore(":memory:");
		expect(store.add(obs())).toBe(true);
		expect(store.add(obs())).toBe(false);
		expect(store.status("p1").count).toBe(1);
		expect(store.search("p1", "deseq2", { excludeSession: "s1" })).toEqual([]);
	});

	it("falls back to recent observations when nothing matches", () => {
		store = new MemoryStore(":memory:");
		store.add(obs(), 1);
		store.add(obs({ sourceKey: "call-2", title: "later" }), 2);
		expect(store.search("p1", "完全无关", { excludeSession: "x" }).map((h) => h.title)).toEqual([
			"later",
			"修改 analysis/deseq2.R",
		]);
	});

	it("per-project toggle stops capture and clear empties only that project", () => {
		store = new MemoryStore(":memory:");
		store.add(obs({ projectId: "p2" }));
		store.setEnabled("p1", false);
		expect(store.add(obs())).toBe(false);
		store.setEnabled("p1", true);
		store.add(obs());
		store.markLoaded("p1", 3);
		store.clear("p1");
		expect(store.status("p1")).toEqual({ enabled: true, count: 0, lastLoaded: 0 });
		expect(store.status("p2").count).toBe(1);
		expect(store.search("p1", "deseq2")).toEqual([]);
	});

	it("get returns only this project's items by id", () => {
		store = new MemoryStore(":memory:");
		store.add(obs({ projectId: "p2", sourceKey: "x" }));
		store.add(obs());
		const [mine] = store.search("p1", "deseq2");
		const other = store.search("p2", "deseq2")[0]!;
		expect(store.get("p1", [mine!.id, other.id]).map((h) => h.id)).toEqual([mine!.id]);
		expect(store.get("p1", [])).toEqual([]);
	});
});
