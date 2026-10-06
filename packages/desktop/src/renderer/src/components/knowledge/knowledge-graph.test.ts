import { describe, expect, it } from "vitest";
import { layoutGraph } from "./graph-layout";

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
});
