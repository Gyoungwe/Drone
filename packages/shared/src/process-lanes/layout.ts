import type { ProcessLaneState, ProcessNodeId } from "./types";

function nodeHeight(node: ProcessLaneState["nodes"][number]): number {
	return node.id === "doing" && node.receipts?.length ? 116 : 96;
}

export interface ProcessRect {
	id: ProcessNodeId;
	x: number;
	y: number;
	width: number;
	height: number;
}
/** Route cross-lane wires through the free right gutter, outside node bodies. */
export function processWirePath(from: ProcessRect, to: ProcessRect, gutter: number): string {
	if (from.y === to.y) {
		const y = from.y + Math.min(from.height, to.height) / 2;
		return `M ${from.x + from.width} ${y} L ${to.x} ${y}`;
	}
	const x1 = from.x + from.width / 2;
	const y1 = from.y + from.height;
	const x2 = to.x + to.width / 2;
	const y2 = to.y > from.y ? to.y : to.y + to.height;
	const approach = y2 + (to.y > from.y ? -7 : 7);
	return `M ${x1} ${y1} L ${x1} ${y1 + 7} L ${gutter} ${y1 + 7} L ${gutter} ${approach} L ${x2} ${approach} L ${x2} ${y2}`;
}
export interface ProcessLayout {
	width: number;
	height: number;
	rects: ProcessRect[];
	lanes: { id: ProcessLaneState["lanes"][number]["id"]; top: number; height: number }[];
	overlaps: string[];
	overflow: boolean;
}
export function estimateProcessLayout(
	state: ProcessLaneState,
	panelWidth: number,
	measuredHeights: Partial<Record<ProcessNodeId, number>> = {},
): ProcessLayout {
	const columns = panelWidth < 600 ? 2 : 3;
	const gap = panelWidth < 600 ? 10 : 20;
	const labelWidth = panelWidth < 600 ? 34 : 46;
	const cardWidth = Math.min(
		panelWidth < 600 ? 130 : 176,
		(panelWidth - 24 - labelWidth - (columns - 1) * gap) / columns,
	);
	const rows = new Map<string, ProcessRect[]>();
	const lanes: ProcessLayout["lanes"] = [];
	let y = 6;
	for (const lane of state.lanes) {
		const nodes = state.nodes.filter((node) => node.lane === lane.id);
		const laneRows: ProcessRect[][] = [];
		for (let i = 0; i < nodes.length; i += columns)
			laneRows.push(
				nodes.slice(i, i + columns).map((node, column) => ({
					id: node.id,
					x: labelWidth + column * (cardWidth + gap),
					y: 0,
					width: cardWidth,
					height: Math.max(nodeHeight(node), measuredHeights[node.id] ?? 0),
				})),
			);
		const rowHeights = laneRows.map((row) => Math.max(...row.map((rect) => rect.height)));
		const laneHeight = laneRows.length
			? rowHeights.reduce((sum, height) => sum + height, 0) + Math.max(0, laneRows.length - 1) * 14 + 30
			: 40;
		let rowY = y + 16;
		for (const [rowIndex, row] of laneRows.entries()) {
			for (const rect of row) rect.y = rowY;
			rows.set(lane.id, [...(rows.get(lane.id) ?? []), ...row]);
			rowY += (rowHeights[rowIndex] ?? 96) + 14;
		}
		y += laneHeight;
		lanes.push({ id: lane.id, top: y - laneHeight, height: laneHeight });
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
		lanes,
		overlaps,
		overflow: labelWidth + columns * cardWidth + (columns - 1) * gap > panelWidth - 24,
	};
}
