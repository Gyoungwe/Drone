import type { KnowledgeGraph as GraphData } from "@drone/shared";
import Graph from "graphology";
import louvain from "graphology-communities-louvain";

/** 星云配色：深色背景上的高亮色，按社区（主题簇）轮换 */
export const NEBULA_PALETTE = [
	"#7aa2ff",
	"#ff7ab6",
	"#5ee6c8",
	"#ffc86b",
	"#b18cff",
	"#6bd4ff",
	"#ff9a6b",
	"#9be36b",
	"#ff6b8a",
	"#e0e6ff",
] as const;
export const NEBULA_ISOLATED = "#5b6478";

export interface NebulaNodeAttributes {
	label: string;
	kind: string;
	degree: number;
	community: number;
	x: number;
	y: number;
	size: number;
	color: string;
}

/** 每个节点的大小只随连接数缓慢增长，防止枢纽节点盖住整张图 */
export function nebulaNodeSize(degree: number): number {
	return 2.5 + Math.min(12, Math.sqrt(Math.max(0, degree)) * 2.2);
}

/** 确定性伪随机，保证同一份数据每次初始布局一致 */
function hash(text: string): number {
	let h = 2166136261;
	for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
	return (h >>> 0) / 4294967295;
}

/**
 * 把后端知识网络转成 graphology 图：Louvain 分主题簇并着色，大小按连接数，
 * 初始位置按簇分布在圆环上（ForceAtlas2 再从这里收敛，簇会自然聚成“星团”）。
 */
export function buildNebulaGraph(data: Pick<GraphData, "nodes" | "edges">): Graph<NebulaNodeAttributes> {
	const graph = new Graph<NebulaNodeAttributes>({ type: "undirected", multi: false, allowSelfLoops: false });
	for (const node of data.nodes)
		if (!graph.hasNode(node.path))
			graph.addNode(node.path, {
				label: node.title,
				kind: node.kind,
				degree: node.degree,
				community: -1,
				x: 0,
				y: 0,
				size: nebulaNodeSize(node.degree),
				color: NEBULA_ISOLATED,
			});
	for (const edge of data.edges)
		if (
			edge.source !== edge.target &&
			graph.hasNode(edge.source) &&
			graph.hasNode(edge.target) &&
			!graph.hasEdge(edge.source, edge.target)
		)
			graph.addEdge(edge.source, edge.target);
	const communities: Record<string, number> = graph.size > 0 ? louvain(graph, { rng: seeded(42) }) : {};
	// 按簇大小重新编号，最大的簇拿第一种颜色，结果稳定
	const counts = new Map<number, number>();
	for (const c of Object.values(communities)) counts.set(c, (counts.get(c) || 0) + 1);
	const order = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([c]) => c);
	const rank = new Map(order.map((c, i) => [c, i]));
	const clusters = Math.max(1, order.length);
	graph.forEachNode((path, attrs) => {
		const isolated = graph.degree(path) === 0;
		const community = isolated ? -1 : (rank.get(communities[path] ?? -1) ?? -1);
		const angle = community >= 0 ? (2 * Math.PI * community) / clusters : 2 * Math.PI * hash(path);
		const radius = community >= 0 ? 10 + 4 * hash(`${path}r`) : 18 + 4 * hash(`${path}r`);
		const jitter = 2 * Math.PI * hash(`${path}a`);
		graph.mergeNodeAttributes(path, {
			community,
			color: community >= 0 ? NEBULA_PALETTE[community % NEBULA_PALETTE.length] : NEBULA_ISOLATED,
			x: radius * Math.cos(angle) + 3 * Math.cos(jitter),
			y: radius * Math.sin(angle) + 3 * Math.sin(jitter),
			size: nebulaNodeSize(attrs.degree || graph.degree(path)),
		});
	});
	return graph;
}

function seeded(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
		return s / 4294967296;
	};
}

/** 悬停某节点时需要保持高亮的集合：它自己加一跳邻居 */
export function neighbourhood(graph: Graph, node: string | null): Set<string> | null {
	if (!node || !graph.hasNode(node)) return null;
	return new Set([node, ...graph.neighbors(node)]);
}

/** 只给最重要的节点常驻标签，其余悬停或放大后才显示 */
export function labelledNodes(data: Pick<GraphData, "nodes">, count = 24): Set<string> {
	return new Set(
		[...data.nodes]
			.sort((a, b) => b.degree - a.degree || a.path.localeCompare(b.path))
			.slice(0, count)
			.map((node) => node.path),
	);
}
