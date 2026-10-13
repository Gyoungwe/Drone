import { describe, expect, it } from "vitest";
import { createRevisionCache } from "../src/graph-cache";

describe("revision-scoped graph cache", () => {
	it("reuses snapshots within a revision and drops them after an index change", () => {
		const cache = createRevisionCache<{ nodes: number }>();
		const snapshot = { nodes: 3 };

		cache.set(4, "semantic:200:true", snapshot);
		expect(cache.get(4, "semantic:200:true")).toBe(snapshot);
		expect(cache.get(4, "all:200:true")).toBeUndefined();

		expect(cache.get(5, "semantic:200:true")).toBeUndefined();
		cache.set(5, "semantic:200:true", { nodes: 4 });
		expect(cache.get(5, "semantic:200:true")?.nodes).toBe(4);
	});

	it("clears all view variants explicitly", () => {
		const cache = createRevisionCache<number>();
		cache.set(1, "semantic", 1);
		cache.set(1, "all", 2);
		cache.clear();
		expect(cache.get(1, "semantic")).toBeUndefined();
		expect(cache.get(1, "all")).toBeUndefined();
	});
});
