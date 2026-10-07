import dagre from "@dagrejs/dagre";
import { Background, type Edge, type Node, Position, ReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useMemo } from "react";
import { ROADMAP_TONE, type RoadmapNode } from "./Roadmap";

const HEX = {
	ok: "#16a34a",
	active: "#7c3aed",
	warn: "#d97706",
	blocked: "#dc2626",
	skip: "#9ca3af",
} as const;
const W = 132;
const H = 40;

/** 用 dagre 给路线节点排版（默认从左到右，可切换为自上而下），节点只放极简标签 */
export function layoutMindMap(nodes: RoadmapNode[], direction: "LR" | "TB" = "LR") {
	const g = new dagre.graphlib.Graph();
	g.setGraph({ rankdir: direction, nodesep: 18, ranksep: 36 });
	g.setDefaultEdgeLabel(() => ({}));
	for (const node of nodes) g.setNode(node.key, { width: W, height: H });
	for (let i = 1; i < nodes.length; i++) g.setEdge(nodes[i - 1]?.key ?? "", nodes[i]?.key ?? "");
	dagre.layout(g);
	const flowNodes: Node[] = nodes.map((node) => {
		const p = g.node(node.key);
		return {
			id: node.key,
			position: { x: p.x - W / 2, y: p.y - H / 2 },
			data: { label: node.value ? `${node.label} · ${node.value}` : node.label },
			className: `rounded-lg border !text-[11px] ${ROADMAP_TONE[node.status]}`,
			style: {
				width: W,
				padding: 6,
				color: HEX[node.status],
				borderColor: HEX[node.status],
				background: "transparent",
			},
			draggable: false,
			sourcePosition: direction === "LR" ? Position.Right : Position.Bottom,
			targetPosition: direction === "LR" ? Position.Left : Position.Top,
		};
	});
	const flowEdges: Edge[] = nodes.slice(1).map((node, i) => ({
		id: `${nodes[i]?.key}-${node.key}`,
		source: nodes[i]?.key ?? "",
		target: node.key,
		type: "smoothstep",
		animated: node.status === "active",
	}));
	return { nodes: flowNodes, edges: flowEdges };
}

export default function RouteMindMap({ nodes, height = 180 }: { nodes: RoadmapNode[]; height?: number }) {
	const flow = useMemo(() => layoutMindMap(nodes), [nodes]);
	return (
		<div data-testid="route-mindmap" style={{ height }} className="rounded-lg border border-border">
			<ReactFlow
				nodes={flow.nodes}
				edges={flow.edges}
				fitView
				nodesConnectable={false}
				elementsSelectable={false}
			>
				<Background gap={16} size={1} />
			</ReactFlow>
		</div>
	);
}
