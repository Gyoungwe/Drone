import { describe, expect, it } from "vitest";
import { parsePins, pinKey, type SearchItem, searchPalette } from "./search-palette";

const items: SearchItem[] = [
	{ kind: "task", id: "1", title: "RNA-seq 差异分析", pinned: false, lastActive: 3 },
	{ kind: "task", id: "2", title: "写综述 related work", pinned: true, lastActive: 1 },
	{ kind: "project", id: "/p/rna", title: "rna", pinned: false, lastActive: 2 },
	{ kind: "project", id: "/p/survey", title: "survey", pinned: true, lastActive: 5 },
];

describe("search palette", () => {
	it("filters by kind and pinned", () => {
		expect(searchPalette(items, "", "task").map((i) => i.id)).toEqual(["2", "1"]);
		expect(searchPalette(items, "", "project").map((i) => i.id)).toEqual(["/p/survey", "/p/rna"]);
		expect(searchPalette(items, "", "pinned").every((i) => i.pinned)).toBe(true);
		expect(searchPalette(items, "", "all")).toHaveLength(4);
	});
	it("ranks prefix over contains and is case-insensitive", () => {
		expect(searchPalette(items, "RNA", "all").map((i) => i.id)).toEqual(["/p/rna", "1"]);
		expect(searchPalette(items, "related", "all").map((i) => i.id)).toEqual(["2"]);
		expect(searchPalette(items, "zzz", "all")).toEqual([]);
	});
	it("persists pins safely", () => {
		expect(parsePins(JSON.stringify([pinKey("task", "1"), "bogus", 3, pinKey("task", "1")]))).toEqual([
			"task:1",
		]);
		expect(parsePins("{oops")).toEqual([]);
		expect(parsePins(null)).toEqual([]);
	});
});
