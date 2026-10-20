import { describe, expect, it } from "vitest";
import { GRAPH_HEIGHT, GRAPH_WIDTH } from "./graph-layout";
import {
	clusterLayout,
	graphClusters,
	graphHealth,
	hubRadius,
	inDegrees,
	localNeighbourhood,
	shapeFor,
} from "./graph-model";

const node = (path: string, degree = 1, extra: Record<string, unknown> = {}) => ({
	path,
	degree,
	kind: "note",
	...extra,
});

describe("knowledge graph model", () => {
	const nodes = ["a1", "a2", "a3", "b1", "b2", "b3", "lonely"].map((path) =>
		node(path, path === "lonely" ? 0 : 2),
	);
	const edges = [
		{ source: "a1", target: "a2", type: "link" },
		{ source: "a2", target: "a3", type: "link" },
		{ source: "a3", target: "a1", type: "link" },
		{ source: "b1", target: "b2", type: "link" },
		{ source: "b2", target: "b3", type: "link" },
		{ source: "b3", target: "b1", type: "link" },
		{ source: "a1", target: "b1", type: "directory" },
	];

	it("counts incoming direct links only and sizes hubs by them", () => {
		const incoming = inDegrees(nodes, [...edges, { source: "a2", target: "a1", type: "link" }]);
		expect(incoming.get("a1")).toBe(2);
		expect(incoming.get("b1")).toBe(1); // the directory edge is not a citation
		expect(hubRadius(4, 4)).toBeGreaterThan(hubRadius(0, 4));
	});

	it("finds the two triangles as clusters and ranks the orphan last", () => {
		const clusters = graphClusters(nodes, edges.slice(0, 6));
		expect(clusters.get("a1")).toBe(clusters.get("a3"));
		expect(clusters.get("b1")).toBe(clusters.get("b2"));
		expect(clusters.get("a1")).not.toBe(clusters.get("b1"));
		expect(clusters.get("lonely")).toBe(2);
	});

	it("prefers worker communities when present", () => {
		const clusters = graphClusters(
			[node("x", 1, { community: 5 }), node("y", 1, { community: 5 }), node("z", 1, { community: 9 })],
			[],
		);
		expect(clusters.get("x")).toBe(0);
		expect(clusters.get("z")).toBe(1);
	});

	it("returns 1 and 2 hop neighbourhoods", () => {
		const chain = [node("p"), node("q"), node("r"), node("s")];
		const links = [
			{ source: "p", target: "q" },
			{ source: "q", target: "r" },
			{ source: "r", target: "s" },
		];
		expect([...localNeighbourhood("p", chain, links, 1)].sort()).toEqual(["p", "q"]);
		expect([...localNeighbourhood("p", chain, links, 2)].sort()).toEqual(["p", "q", "r"]);
		expect(localNeighbourhood("missing", chain, links, 2).size).toBe(0);
	});

	it("lays clusters apart, deterministically and inside the canvas", () => {
		const clusters = graphClusters(nodes, edges.slice(0, 6));
		const radii = new Map(nodes.map((n) => [n.path, 6]));
		const first = clusterLayout(nodes, edges, clusters, radii);
		const second = clusterLayout(nodes, edges, clusters, radii);
		expect([...first.values()].map((p) => [p.x, p.y])).toEqual([...second.values()].map((p) => [p.x, p.y]));
		for (const p of first.values()) {
			expect(p.x).toBeGreaterThanOrEqual(0);
			expect(p.x).toBeLessThanOrEqual(GRAPH_WIDTH);
			expect(p.y).toBeGreaterThanOrEqual(0);
			expect(p.y).toBeLessThanOrEqual(GRAPH_HEIGHT);
		}
		const d = (x: string, y: string) => {
			const a = first.get(x);
			const b = first.get(y);
			if (!a || !b) throw new Error("missing");
			return Math.hypot(a.x - b.x, a.y - b.y);
		};
		expect(d("a1", "a2")).toBeLessThan(d("a1", "b2"));
	});

	it("reports orphans, uncited Wiki pages and flagged notes, never infrastructure", () => {
		const findings = graphHealth(
			[
				node("Wiki/lora.md", 1, { kind: "wiki" }),
				node("Papers/p.md", 1),
				node("Inbox/loose.md", 0),
				node("Wiki/Index.md", 0, { isInfrastructure: true }),
				node("Papers/m.md", 1, { warnings: ["mirror"] }),
			],
			[
				{ source: "Wiki/lora.md", target: "Papers/p.md", type: "link" },
				{ source: "Papers/m.md", target: "Papers/p.md", type: "link" },
			],
		);
		expect(findings).toEqual([
			{ path: "Wiki/lora.md", kind: "uncited" },
			{ path: "Inbox/loose.md", kind: "orphan" },
			{ path: "Papers/m.md", kind: "warning" },
		]);
	});

	it("maps types to shapes", () => {
		expect(shapeFor("paper")).toBe("circle");
		expect(shapeFor("wiki")).toBe("square");
		expect(shapeFor("claim")).toBe("diamond");
	});
});
