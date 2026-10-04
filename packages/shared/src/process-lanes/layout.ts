import type { ProcessLaneState, ProcessNodeId } from "./types";

export interface ProcessRect {
	id: ProcessNodeId;
	x: number;
	y: number;
	width: number;
	height: number;
}
export interface ProcessLayout {
	width: number;
	height: number;
	rects: ProcessRect[];
	overlaps: string[];
	overflow: boolean;
}
export function estimateProcessLayout(state: ProcessLaneState, panelWidth: 372 | 744): ProcessLayout {
	const cardWidth = panelWidth === 372 ? 130 : 176;
	const columns = panelWidth === 372 ? 2 : 3;
	const gap = panelWidth === 372 ? 10 : 20;
	const labelWidth = panelWidth === 372 ? 34 : 46;
	const rows = new Map<string, ProcessRect[]>();
	let y = 6;
	for (const lane of state.lanes) {
		const nodes = state.nodes.filter((node) => node.lane === lane.id);
		const laneRows: ProcessRect[][] = [];
		for (let i = 0; i < nodes.length; i += columns)
			laneRows.push(
				nodes
					.slice(i, i + columns)
					.map((node, column) => ({
						id: node.id,
						x: labelWidth + column * (cardWidth + gap),
						y: 0,
						width: cardWidth,
						height: 96,
					})),
			);
		const laneHeight = laneRows.length
			? laneRows.length * 96 + Math.max(0, laneRows.length - 1) * 14 + 30
			: 40;
		for (const row of laneRows) {
			for (const rect of row) rect.y = y + 16 + laneRows.indexOf(row) * 110;
			rows.set(lane.id, [...(rows.get(lane.id) ?? []), ...row]);
		}
		y += laneHeight;
	}
	const rects = [...rows.values()].flat();
	const overlaps: string[] = [];
	for (let i = 0; i < rects.length; i++)
		for (let j = i + 1; j < rects.length; j++) {
			const a = rects[i],
				b = rects[j];
			if (
				a &&
				b &&
				Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x) &&
				Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y)
			)
				overlaps.push(`${a.id}~${b.id}`);
		}
	return {
		width: labelWidth + columns * cardWidth + (columns - 1) * gap,
		height: y + 8,
		rects,
		overlaps,
		overflow: labelWidth + columns * cardWidth + (columns - 1) * gap > panelWidth - 24,
	};
}
