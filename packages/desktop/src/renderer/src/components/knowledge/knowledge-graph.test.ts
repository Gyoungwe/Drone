import { describe, expect, it } from "vitest";
import { GRAPH_HEIGHT, GRAPH_WIDTH, layoutGraph, placeGraphLabels } from "./graph-layout";

describe("knowledge graph layout", () => {
	it("is deterministic, keeps nodes inside the canvas and pulls linked nodes closer", () => {
		const data = {
			nodes: ["a", "b", "c", "d"].map((path) => ({ path, title: path, kind: "note", degree: 1 })),
			edges: [{ source: "a", target: "b" }],
		};
		const first = layoutGraph(data);
		const second = layoutGraph(data);
		expect([...first.values()].map((p) => [p.x, p.y])).toEqual([...second.values()].map((p) => [p.x, p.y]));
		for (const p of first.values()) {
			expect(p.x).toBeGreaterThanOrEqual(12);
			expect(p.y).toBeGreaterThanOrEqual(12);
		}
		const distance = (x: string, y: string) => {
			const a = first.get(x);
			const b = first.get(y);
			if (!a || !b) throw new Error("missing");
			return Math.hypot(a.x - b.x, a.y - b.y);
		};
		expect(distance("a", "b")).toBeLessThan(distance("c", "d"));
	});

	it("places labels without overlapping earlier labels or leaving the canvas", () => {
		const data = {
			nodes: [
				{ path: "a", title: "A very important research topic", kind: "note", degree: 5 },
				{ path: "b", title: "Another important research topic", kind: "note", degree: 4 },
				{ path: "c", title: "Third topic", kind: "note", degree: 3 },
			],
		};
		const points = new Map([
			["a", { x: GRAPH_WIDTH / 2, y: GRAPH_HEIGHT / 2, vx: 0, vy: 0 }],
			["b", { x: GRAPH_WIDTH / 2 + 4, y: GRAPH_HEIGHT / 2 + 4, vx: 0, vy: 0 }],
			["c", { x: 20, y: 20, vx: 0, vy: 0 }],
		]);
		const first = placeGraphLabels(data, points, new Set(data.nodes.map((node) => node.path)));
		const second = placeGraphLabels(data, points, new Set(data.nodes.map((node) => node.path)));
		expect(first).toEqual(second);
		for (const placement of first.values()) {
			expect(placement.x).toBeGreaterThanOrEqual(0);
			expect(placement.x).toBeLessThanOrEqual(GRAPH_WIDTH);
			expect(placement.y).toBeGreaterThanOrEqual(0);
			expect(placement.y).toBeLessThanOrEqual(GRAPH_HEIGHT);
		}
	});

	it.each([1000, 2000, 5000, 10000])("keeps a large fallback graph bounded (%i nodes)", (count) => {
		const data = {
			nodes: Array.from({ length: count }, (_, index) => ({
				path: `node-${index}.md`,
				title: `Node ${index}`,
				kind: "note",
				degree: 0,
			})),
			edges: [],
		};
		const points = layoutGraph(data);
		expect(points.size).toBe(count);
		for (const point of points.values()) {
			expect(point.x).toBeGreaterThanOrEqual(12);
			expect(point.x).toBeLessThanOrEqual(GRAPH_WIDTH - 12);
			expect(point.y).toBeGreaterThanOrEqual(12);
			expect(point.y).toBeLessThanOrEqual(GRAPH_HEIGHT - 12);
		}
	});
});
