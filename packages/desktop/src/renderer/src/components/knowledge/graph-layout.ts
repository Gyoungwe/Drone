import type { KnowledgeGraph as GraphData } from "@drone/shared";

export const GRAPH_WIDTH = 720;
export const GRAPH_HEIGHT = 440;

export interface Point {
	x: number;
	y: number;
	vx: number;
	vy: number;
}

export interface LabelPlacement {
	x: number;
	y: number;
	anchor: "start" | "end";
	width: number;
}

export interface LabelAvoidZone {
	x: number;
	y: number;
	width: number;
	height: number;
}

const FORCE_LAYOUT_NODE_LIMIT = 800;

function boundedGridLayout(data: Pick<GraphData, "nodes">): Map<string, Point> {
	const points = new Map<string, Point>();
	const count = data.nodes.length;
	const columns = Math.max(1, Math.ceil(Math.sqrt((count * GRAPH_WIDTH) / GRAPH_HEIGHT)));
	const rows = Math.ceil(count / columns);
	const margin = 12;
	const xStep = columns === 1 ? 0 : (GRAPH_WIDTH - margin * 2) / (columns - 1);
	const yStep = rows === 1 ? 0 : (GRAPH_HEIGHT - margin * 2) / (rows - 1);
	for (const [index, node] of data.nodes.entries()) {
		const row = Math.floor(index / columns);
		const column = index % columns;
		points.set(node.path, {
			x: columns === 1 ? GRAPH_WIDTH / 2 : margin + column * xStep,
			y: rows === 1 ? GRAPH_HEIGHT / 2 : margin + row * yStep,
			vx: 0,
			vy: 0,
		});
	}
	return points;
}

/** 简单力导向布局：节点互斥 + 边弹簧 + 向心，固定迭代次数（确定性初始位置，结果稳定） */
export function layoutGraph(data: Pick<GraphData, "nodes" | "edges">, iterations = 220): Map<string, Point> {
	// The exact force pass is useful for a small interactive graph, but its
	// pairwise repulsion is quadratic. Large legacy graphs should still open
	// promptly; the server-provided semantic layout is preferred, and this
	// deterministic bounded fallback keeps older payloads usable.
	if (data.nodes.length > FORCE_LAYOUT_NODE_LIMIT) return boundedGridLayout(data);
	const points = new Map<string, Point>();
	const n = data.nodes.length || 1;
	data.nodes.forEach((node, index) => {
		const angle = (2 * Math.PI * index) / n;
		const radius = 40 + (160 * ((index * 7919) % n)) / n;
		points.set(node.path, {
			x: GRAPH_WIDTH / 2 + radius * Math.cos(angle),
			y: GRAPH_HEIGHT / 2 + radius * Math.sin(angle),
			vx: 0,
			vy: 0,
		});
	});
	const list = [...points.values()];
	const ideal = Math.max(28, Math.min(90, Math.sqrt((GRAPH_WIDTH * GRAPH_HEIGHT) / n) * 0.7));
	for (let step = 0; step < iterations; step++) {
		const cooling = 1 - step / iterations;
		for (let i = 0; i < list.length; i++) {
			const a = list[i] as Point;
			for (let j = i + 1; j < list.length; j++) {
				const b = list[j] as Point;
				let dx = a.x - b.x;
				let dy = a.y - b.y;
				let distance2 = dx * dx + dy * dy;
				if (distance2 < 0.01) {
					dx = 0.1;
					dy = 0.1;
					distance2 = 0.02;
				}
				const force = (ideal * ideal) / distance2;
				a.vx += dx * force * 0.05;
				a.vy += dy * force * 0.05;
				b.vx -= dx * force * 0.05;
				b.vy -= dy * force * 0.05;
			}
		}
		for (const edge of data.edges) {
			const a = points.get(edge.source);
			const b = points.get(edge.target);
			if (!a || !b) continue;
			const dx = b.x - a.x;
			const dy = b.y - a.y;
			const distance = Math.sqrt(dx * dx + dy * dy) || 0.1;
			const pull = ((distance - ideal) / distance) * 0.08;
			a.vx += dx * pull;
			a.vy += dy * pull;
			b.vx -= dx * pull;
			b.vy -= dy * pull;
		}
		for (const p of list) {
			p.vx += (GRAPH_WIDTH / 2 - p.x) * 0.004;
			p.vy += (GRAPH_HEIGHT / 2 - p.y) * 0.004;
			const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
			const max = 12 * cooling + 0.5;
			if (speed > max) {
				p.vx = (p.vx / speed) * max;
				p.vy = (p.vy / speed) * max;
			}
			p.x = Math.min(GRAPH_WIDTH - 12, Math.max(12, p.x + p.vx));
			p.y = Math.min(GRAPH_HEIGHT - 12, Math.max(12, p.y + p.vy));
			p.vx *= 0.6;
			p.vy *= 0.6;
		}
	}
	return points;
}

/**
 * 给重要节点计算稳定的标签锚点。候选位置按 8 个方向尝试，优先避免
 * 已放置标签和画布边界；这样密集图中标签会分散到节点周围而不会互相盖住。
 */
export function placeGraphLabels(
	data: Pick<GraphData, "nodes">,
	points: Map<string, Point>,
	labelled: Set<string>,
	selected?: string | null,
	options: { uniformOrientation?: boolean; avoidZones?: readonly LabelAvoidZone[] } = {},
): Map<string, LabelPlacement> {
	const placed: Array<{ x: number; y: number; width: number; height: number }> = [];
	const result = new Map<string, LabelPlacement>();
	const avoidZones = options.avoidZones ?? [];
	const nodes = [...data.nodes]
		.filter((node) => labelled.has(node.path) || node.path === selected)
		.sort((a, b) =>
			a.path === selected
				? -1
				: b.path === selected
					? 1
					: b.degree - a.degree || a.path.localeCompare(b.path),
		);
	const overlap = (a: { x: number; y: number; width: number; height: number }, b: (typeof placed)[number]) =>
		a.x < b.x + b.width + 4 &&
		a.x + a.width + 4 > b.x &&
		a.y < b.y + b.height + 4 &&
		a.y + a.height + 4 > b.y;
	for (const node of nodes) {
		const point = points.get(node.path);
		if (!point) continue;
		const text = node.title.length > 18 ? `${node.title.slice(0, 17)}…` : node.title;
		const width = Math.min(156, Math.max(42, text.length * 6.4));
		const radius = 10;
		const candidates = options.uniformOrientation
			? [
					{ x: point.x + radius, y: point.y - 15, anchor: "start" as const },
					{ x: point.x + radius, y: point.y + 5, anchor: "start" as const },
					{ x: point.x + radius + 8, y: point.y - 27, anchor: "start" as const },
					{ x: point.x + radius + 8, y: point.y + 17, anchor: "start" as const },
				]
			: [
					{ x: point.x + radius, y: point.y - 15, anchor: "start" as const },
					{ x: point.x + radius, y: point.y + 5, anchor: "start" as const },
					{ x: point.x + radius, y: point.y - 42, anchor: "start" as const },
					{ x: point.x + radius, y: point.y + 30, anchor: "start" as const },
					{ x: point.x + radius, y: point.y - 80, anchor: "start" as const },
					{ x: point.x + radius, y: point.y + 60, anchor: "start" as const },
					{ x: point.x - radius - width, y: point.y - 15, anchor: "end" as const },
					{ x: point.x - radius - width, y: point.y + 5, anchor: "end" as const },
					{ x: point.x - radius - width, y: point.y - 42, anchor: "end" as const },
					{ x: point.x - radius - width, y: point.y + 30, anchor: "end" as const },
					{ x: point.x - radius - width, y: point.y - 80, anchor: "end" as const },
					{ x: point.x - radius - width, y: point.y + 60, anchor: "end" as const },
					{ x: point.x - width / 2, y: point.y - 24, anchor: "start" as const },
					{ x: point.x - width / 2, y: point.y + 14, anchor: "start" as const },
				];
		let best = candidates[0] as (typeof candidates)[number];
		let bestScore = Number.POSITIVE_INFINITY;
		for (const candidate of candidates) {
			const box = {
				x: candidate.anchor === "end" ? candidate.x - width : candidate.x,
				y: candidate.y - 10,
				width,
				height: 14,
			};
			const collisions = placed.reduce((count, other) => count + (overlap(box, other) ? 1 : 0), 0);
			const overlayCollisions = avoidZones.reduce((count, zone) => count + (overlap(box, zone) ? 1 : 0), 0);
			const edgePenalty =
				Math.max(0, -box.x) +
				Math.max(0, box.x + width - GRAPH_WIDTH) +
				Math.max(0, -box.y) +
				Math.max(0, box.y + box.height - GRAPH_HEIGHT);
			const score =
				collisions * 1000 +
				overlayCollisions * 2500 +
				edgePenalty * 10 +
				Math.hypot(candidate.x - point.x, candidate.y - point.y);
			if (score < bestScore) {
				best = candidate;
				bestScore = score;
			}
		}
		const finalX =
			best.anchor === "end"
				? Math.min(GRAPH_WIDTH, Math.max(width, best.x))
				: Math.min(GRAPH_WIDTH - width, Math.max(0, best.x));
		const finalY = Math.min(GRAPH_HEIGHT - 4, Math.max(12, best.y));
		const finalBox = {
			x: best.anchor === "end" ? finalX - width : finalX,
			y: finalY - 10,
			width,
			height: 14,
		};
		placed.push(finalBox);
		result.set(node.path, { x: finalX, y: finalY, anchor: best.anchor, width });
	}
	return result;
}

/**
 * Live refresh keeps the picture still: nodes that were already on screen keep their
 * previous position, new nodes start at the centroid of their already-placed neighbours
 * (falling back to the fresh base layout), and only the new nodes are relaxed away from
 * overlaps. Without a previous layout the base layout is returned unchanged.
 */
export function mergeIncrementalLayout(
	previous: Map<string, Point> | null,
	base: Map<string, Point>,
	data: Pick<GraphData, "nodes" | "edges">,
	minDistance = 22,
): Map<string, Point> {
	if (!previous || previous.size === 0) return base;
	const merged = new Map<string, Point>();
	const fresh: string[] = [];
	for (const node of data.nodes) {
		const old = previous.get(node.path);
		if (old) merged.set(node.path, { ...old, vx: 0, vy: 0 });
		else fresh.push(node.path);
	}
	if (fresh.length === 0) return merged;
	const neighbours = new Map<string, string[]>();
	for (const edge of data.edges) {
		if (!neighbours.has(edge.source)) neighbours.set(edge.source, []);
		if (!neighbours.has(edge.target)) neighbours.set(edge.target, []);
		neighbours.get(edge.source)?.push(edge.target);
		neighbours.get(edge.target)?.push(edge.source);
	}
	for (const [index, path] of fresh.entries()) {
		const anchors = (neighbours.get(path) ?? [])
			.map((other) => merged.get(other))
			.filter((point): point is Point => Boolean(point));
		const fallback = base.get(path) ?? { x: GRAPH_WIDTH / 2, y: GRAPH_HEIGHT / 2, vx: 0, vy: 0 };
		const angle = (index + 1) * 2.399963; // golden angle keeps siblings apart deterministically
		const point =
			anchors.length > 0
				? {
						x: anchors.reduce((sum, p) => sum + p.x, 0) / anchors.length + Math.cos(angle) * minDistance,
						y: anchors.reduce((sum, p) => sum + p.y, 0) / anchors.length + Math.sin(angle) * minDistance,
					}
				: { x: fallback.x, y: fallback.y };
		merged.set(path, { x: point.x, y: point.y, vx: 0, vy: 0 });
	}
	// Local relaxation: only fresh nodes move, existing nodes act as fixed obstacles.
	for (let step = 0; step < 40; step++) {
		for (const path of fresh) {
			const point = merged.get(path);
			if (!point) continue;
			for (const [other, obstacle] of merged) {
				if (other === path) continue;
				const dx = point.x - obstacle.x;
				const dy = point.y - obstacle.y;
				const distance = Math.hypot(dx, dy) || 0.01;
				if (distance >= minDistance) continue;
				const push = (minDistance - distance) / 2;
				point.x += (dx / distance) * push;
				point.y += (dy / distance) * push;
			}
			point.x = Math.min(GRAPH_WIDTH - 12, Math.max(12, point.x));
			point.y = Math.min(GRAPH_HEIGHT - 12, Math.max(12, point.y));
		}
	}
	return merged;
}

/** Node radius used by the knowledge network renderer (diameter = 10 + min(links, 7) × 3). */
export function graphNodeRadius(degree: number): number {
	return (10 + Math.min(Math.max(degree, 0), 7) * 3) / 2;
}

/**
 * Collision pass on top of a base layout: keeps every node near where the base layout put it (so topic
 * clusters stay recognisable) but pushes overlapping nodes apart until each pair is at least
 * r1 + r2 + gap apart. The worker's sector layout fans same-category notes out from one anchor, which
 * piles a paper-heavy Vault into a single blob; this spreads that blob without reshuffling the graph.
 */
export function declutterLayout(
	base: Map<string, Point>,
	degrees: Map<string, number>,
	{ gap = 6, iterations = 120 }: { gap?: number; iterations?: number } = {},
): Map<string, Point> {
	const entries = [...base.entries()].map(([path, point]) => ({
		path,
		x: point.x,
		y: point.y,
		r: graphNodeRadius(degrees.get(path) ?? 0),
	}));
	const margin = 14;
	for (let step = 0; step < iterations; step++) {
		let moved = false;
		for (let i = 0; i < entries.length; i++) {
			const a = entries[i];
			if (!a) continue;
			for (let j = i + 1; j < entries.length; j++) {
				const b = entries[j];
				if (!b) continue;
				let dx = b.x - a.x;
				let dy = b.y - a.y;
				let distance = Math.hypot(dx, dy);
				const min = a.r + b.r + gap;
				if (distance >= min) continue;
				if (distance < 0.01) {
					// Deterministic nudge for exactly overlapping nodes.
					const angle = ((i * 7919 + j * 104729) % 360) * (Math.PI / 180);
					dx = Math.cos(angle);
					dy = Math.sin(angle);
					distance = 1;
				}
				const push = (min - distance) / 2;
				const ux = dx / distance;
				const uy = dy / distance;
				a.x -= ux * push;
				a.y -= uy * push;
				b.x += ux * push;
				b.y += uy * push;
				moved = true;
			}
		}
		for (const entry of entries) {
			entry.x = Math.min(GRAPH_WIDTH - margin, Math.max(margin, entry.x));
			entry.y = Math.min(GRAPH_HEIGHT - margin, Math.max(margin, entry.y));
		}
		if (!moved) break;
	}
	return new Map(entries.map((entry) => [entry.path, { x: entry.x, y: entry.y, vx: 0, vy: 0 }]));
}
