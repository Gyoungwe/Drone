import type { KnowledgeGraph as GraphData } from "@drone/shared";

export const GRAPH_WIDTH = 720;
export const GRAPH_HEIGHT = 440;

export interface Point {
	x: number;
	y: number;
	vx: number;
	vy: number;
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
