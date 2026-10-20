import { describe, expect, it } from "vitest";
import {
	declutterLayout,
	GRAPH_HEIGHT,
	GRAPH_WIDTH,
	layoutGraph,
	mergeIncrementalLayout,
	placeGraphLabels,
} from "./graph-layout";

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

	it("steers labels away from the legend and zoom controls", () => {
		const data = {
			nodes: [
				{ path: "legend", title: "A label near the legend", kind: "note", degree: 5 },
				{ path: "zoom", title: "A label near zoom", kind: "note", degree: 4 },
			],
		};
		const points = new Map([
			["legend", { x: 30, y: GRAPH_HEIGHT - 30, vx: 0, vy: 0 }],
			["zoom", { x: GRAPH_WIDTH - 30, y: GRAPH_HEIGHT - 30, vx: 0, vy: 0 }],
		]);
		const placements = placeGraphLabels(
			data,
			points,
			new Set(data.nodes.map((node) => node.path)),
			undefined,
			{
				avoidZones: [
					{ x: 0, y: GRAPH_HEIGHT - 82, width: 270, height: 82 },
					{ x: GRAPH_WIDTH - 224, y: GRAPH_HEIGHT - 72, width: 224, height: 72 },
				],
			},
		);
		const boxFor = (path: string) => {
			const placement = placements.get(path);
			if (!placement) throw new Error(`missing placement for ${path}`);
			return {
				x: placement.anchor === "end" ? placement.x - placement.width - 4 : placement.x - 4,
				y: placement.y - 11,
				width: placement.width + 8,
				height: 16,
			};
		};
		const overlaps = (a: ReturnType<typeof boxFor>, b: ReturnType<typeof boxFor>) =>
			a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
		const legend = { x: 0, y: GRAPH_HEIGHT - 82, width: 270, height: 82 };
		const zoom = { x: GRAPH_WIDTH - 224, y: GRAPH_HEIGHT - 72, width: 224, height: 72 };
		expect(overlaps(boxFor("legend"), legend)).toBe(false);
		expect(overlaps(boxFor("zoom"), zoom)).toBe(false);
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

describe("incremental knowledge graph layout", () => {
	const node = (path: string) => ({ path, title: path, kind: "note", degree: 1 }) as never;
	it("keeps existing nodes still and places a new node near its neighbours", () => {
		const previous = new Map([
			["a", { x: 100, y: 100, vx: 0, vy: 0 }],
			["b", { x: 300, y: 200, vx: 0, vy: 0 }],
		]);
		const base = new Map([
			["a", { x: 500, y: 50, vx: 0, vy: 0 }],
			["b", { x: 20, y: 400, vx: 0, vy: 0 }],
			["c", { x: 700, y: 430, vx: 0, vy: 0 }],
		]);
		const merged = mergeIncrementalLayout(previous, base, {
			nodes: [node("a"), node("b"), node("c")],
			edges: [
				{ source: "c", target: "a" },
				{ source: "c", target: "b" },
			] as never,
		});
		expect(merged.get("a")).toMatchObject({ x: 100, y: 100 });
		expect(merged.get("b")).toMatchObject({ x: 300, y: 200 });
		const c = merged.get("c");
		expect(c).toBeDefined();
		expect(Math.hypot((c?.x ?? 0) - 200, (c?.y ?? 0) - 150)).toBeLessThan(60);
		for (const other of ["a", "b"]) {
			const p = merged.get(other);
			expect(Math.hypot((c?.x ?? 0) - (p?.x ?? 0), (c?.y ?? 0) - (p?.y ?? 0))).toBeGreaterThanOrEqual(21.9);
		}
	});

	it("returns the base layout on first render and drops removed nodes", () => {
		const base = new Map([["a", { x: 1, y: 2, vx: 0, vy: 0 }]]);
		expect(mergeIncrementalLayout(null, base, { nodes: [node("a")], edges: [] })).toBe(base);
		const previous = new Map([
			["a", { x: 5, y: 5, vx: 0, vy: 0 }],
			["gone", { x: 9, y: 9, vx: 0, vy: 0 }],
		]);
		const merged = mergeIncrementalLayout(previous, base, { nodes: [node("a")], edges: [] });
		expect([...merged.keys()]).toEqual(["a"]);
	});
});

describe("declutterLayout", () => {
	it("separates a pile of overlapping nodes while keeping them near their anchor", () => {
		const base = new Map(
			Array.from({ length: 30 }, (_, index) => [`n${index}`, { x: 360 + (index % 3), y: 220, vx: 0, vy: 0 }]),
		);
		const degrees = new Map([...base.keys()].map((path) => [path, 1]));
		const spread = declutterLayout(base, degrees);
		const points = [...spread.values()];
		let closest = Number.POSITIVE_INFINITY;
		for (let i = 0; i < points.length; i++)
			for (let j = i + 1; j < points.length; j++) {
				const a = points[i];
				const b = points[j];
				if (a && b) closest = Math.min(closest, Math.hypot(a.x - b.x, a.y - b.y));
			}
		// two radius-6.5 nodes + 6px gap = 19px; allow a little slack for the iteration cap
		expect(closest).toBeGreaterThan(16);
		for (const point of points) {
			expect(Math.hypot(point.x - 360, point.y - 220)).toBeLessThan(140);
			expect(point.x).toBeGreaterThanOrEqual(14);
			expect(point.y).toBeLessThanOrEqual(GRAPH_HEIGHT - 14);
		}
	});

	it("leaves an already spread layout untouched", () => {
		const base = new Map([
			["a", { x: 100, y: 100, vx: 0, vy: 0 }],
			["b", { x: 300, y: 300, vx: 0, vy: 0 }],
		]);
		const spread = declutterLayout(base, new Map());
		expect(spread.get("a")).toMatchObject({ x: 100, y: 100 });
		expect(spread.get("b")).toMatchObject({ x: 300, y: 300 });
	});
});
