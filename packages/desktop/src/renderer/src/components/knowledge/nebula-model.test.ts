import { describe, expect, it } from "vitest";
import {
	buildNebulaGraph,
	labelledNodes,
	NEBULA_ISOLATED,
	nebulaNodeSize,
	neighbourhood,
} from "./nebula-model";

const node = (path: string, degree = 1) => ({ path, title: path, kind: "note", degree });
const twoClusters = {
	nodes: ["a1", "a2", "a3", "b1", "b2", "b3", "lonely"].map((p) => node(p, p === "lonely" ? 0 : 2)),
	edges: [
		{ source: "a1", target: "a2" },
		{ source: "a2", target: "a3" },
		{ source: "a3", target: "a1" },
		{ source: "b1", target: "b2" },
		{ source: "b2", target: "b3" },
		{ source: "b3", target: "b1" },
		{ source: "a1", target: "b1" },
		{ source: "a1", target: "a1" },
	],
};

describe("knowledge nebula model", () => {
	it("colours Louvain topic clusters and greys out isolated notes", () => {
		const g = buildNebulaGraph(twoClusters);
		expect(g.order).toBe(7);
		expect(g.size).toBe(7);
		const ca = g.getNodeAttribute("a2", "community");
		const cb = g.getNodeAttribute("b2", "community");
		expect(ca).not.toBe(cb);
		expect(g.getNodeAttribute("a3", "community")).toBe(ca);
		expect(g.getNodeAttribute("a2", "color")).not.toBe(g.getNodeAttribute("b2", "color"));
		expect(g.getNodeAttribute("lonely", "community")).toBe(-1);
		expect(g.getNodeAttribute("lonely", "color")).toBe(NEBULA_ISOLATED);
	});
	it("is deterministic and sizes nodes by degree with a cap", () => {
		const a = buildNebulaGraph(twoClusters);
		const b = buildNebulaGraph(twoClusters);
		a.forEachNode((key, attrs) => {
			expect([attrs.x, attrs.y, attrs.color]).toEqual([
				b.getNodeAttribute(key, "x"),
				b.getNodeAttribute(key, "y"),
				b.getNodeAttribute(key, "color"),
			]);
		});
		expect(nebulaNodeSize(9)).toBeGreaterThan(nebulaNodeSize(1));
		expect(nebulaNodeSize(10_000)).toBe(nebulaNodeSize(1_000_000));
	});
	it("highlights a node with its direct neighbours only", () => {
		const g = buildNebulaGraph(twoClusters);
		expect([...(neighbourhood(g, "a2") ?? [])].sort()).toEqual(["a1", "a2", "a3"]);
		expect(neighbourhood(g, null)).toBeNull();
		expect(neighbourhood(g, "missing")).toBeNull();
	});
	it("labels only the most connected notes", () => {
		expect(labelledNodes({ nodes: [node("x", 5), node("y", 1), node("z", 3)] }, 2)).toEqual(
			new Set(["x", "z"]),
		);
	});
});
