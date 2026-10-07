import { describe, expect, it } from "vitest";
import {
	backlinkContext,
	centralityBoost,
	expandWithGraph,
	type GraphNeighbor,
} from "../src/graph-retrieval";

const n = (
	from: string,
	path: string,
	degree = 1,
	direction: "outgoing" | "backlink" = "outgoing",
): GraphNeighbor => ({
	from,
	path,
	title: path,
	kind: "note",
	direction,
	degree,
});

describe("graph-augmented retrieval", () => {
	it("adds 1-hop neighbors of top hits with decayed scores", () => {
		const hits = [
			{ path: "A.md", fusionScore: 0.03 },
			{ path: "B.md", fusionScore: 0.02 },
		];
		const out = expandWithGraph(hits, [n("A.md", "C.md", 2)], { limit: 5 });
		expect(out.map((h) => h.path)).toEqual(["A.md", "B.md", "C.md"]);
		const c = out.find((h) => h.path === "C.md") as unknown as {
			retrieval: string;
			graph: { from: string[] };
		};
		expect(c.retrieval).toBe("graph");
		expect(c.graph.from).toEqual(["A.md"]);
	});
	it("keeps the limit and never lets a hub outrank its seed", () => {
		const hits = [{ path: "A.md", fusionScore: 0.03 }];
		const out = expandWithGraph(hits, [n("A.md", "Hub.md", 500)], { limit: 1 });
		expect(out.map((h) => h.path)).toEqual(["A.md"]);
		expect(centralityBoost(10_000, 0.002, 0.004)).toBe(0.004);
	});
	it("only expands from the first seeds and caps neighbors per seed", () => {
		const hits = ["A", "B", "C", "D"].map((p, i) => ({ path: `${p}.md`, fusionScore: 0.04 - i * 0.005 }));
		const many = Array.from({ length: 10 }, (_, i) => n("A.md", `N${i}.md`));
		const out = expandWithGraph(hits, [...many, n("D.md", "X.md")], { limit: 12 });
		expect(out.filter((h) => h.retrieval === "graph")).toHaveLength(4);
		expect(out.some((h) => h.path === "X.md")).toBe(false);
	});
	it("corroborates a direct hit that is also linked, without duplicating it", () => {
		const hits = [
			{ path: "A.md", fusionScore: 0.03 },
			{ path: "B.md", fusionScore: 0.01 },
		];
		const out = expandWithGraph(hits, [n("A.md", "B.md")], { limit: 5 });
		expect(out).toHaveLength(2);
		expect((out[1]?.fusionScore as number) > 0.01).toBe(true);
		expect(out[1]?.retrieval).toBeUndefined();
	});
	it("is deterministic", () => {
		const hits = [{ path: "A.md", fusionScore: 0.03 }];
		const ns = [n("A.md", "Z.md"), n("A.md", "Y.md")];
		expect(expandWithGraph(hits, ns, { limit: 5 })).toEqual(
			expandWithGraph(hits, [...ns].reverse(), { limit: 5 }),
		);
	});
	it("extracts Obsidian-style backlink context (alias, heading, embed, bare name)", () => {
		const body = "intro\nSee ![[Library/Papers/DHX16#Results|DHX16 结果]] for domains\nmore";
		expect(backlinkContext(body, "Library/Papers/DHX16.md")).toContain("for domains");
		expect(backlinkContext("x [[dhx16]] y", "Library/Papers/DHX16.md")).toBe("x [[dhx16]] y");
		expect(backlinkContext("no links", "A.md")).toBeUndefined();
	});
});
