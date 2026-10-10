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

/** 简单力导向布局：节点互斥 + 边弹簧 + 向心，固定迭代次数（确定性初始位置，结果稳定） */
export function layoutGraph(data: Pick<GraphData, "nodes" | "edges">, iterations = 220): Map<string, Point> {
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
): Map<string, LabelPlacement> {
	const placed: Array<{ x: number; y: number; width: number; height: number }> = [];
	const result = new Map<string, LabelPlacement>();
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
		const text = node.title.length > 24 ? `${node.title.slice(0, 23)}…` : node.title;
		const width = Math.min(156, Math.max(42, text.length * 6.4));
		const radius = 10;
		const candidates = [
			{ x: point.x + radius, y: point.y - 15, anchor: "start" as const },
			{ x: point.x + radius, y: point.y + 5, anchor: "start" as const },
			{ x: point.x - radius - width, y: point.y - 15, anchor: "end" as const },
			{ x: point.x - radius - width, y: point.y + 5, anchor: "end" as const },
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
			const edgePenalty =
				Math.max(0, -box.x) +
				Math.max(0, box.x + width - GRAPH_WIDTH) +
				Math.max(0, -box.y) +
				Math.max(0, box.y + box.height - GRAPH_HEIGHT);
			const score =
				collisions * 1000 + edgePenalty * 10 + Math.hypot(candidate.x - point.x, candidate.y - point.y);
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
