import { GRAPH_HEIGHT, GRAPH_WIDTH, graphNodeRadius, type Point } from "./graph-layout";

export interface ModelNode {
	path: string;
	degree: number;
	kind?: string;
	community?: number;
	isInfrastructure?: boolean;
	nodeType?: string;
	warnings?: string[];
	mirrors?: string[];
}
export interface ModelEdge {
	source: string;
	target: string;
	type?: string;
}

/** Incoming direct links per note: "how many other notes cite this one" (Karpathy's hub signal). */
export function inDegrees(nodes: readonly ModelNode[], edges: readonly ModelEdge[]): Map<string, number> {
	const counts = new Map(nodes.map((node) => [node.path, 0]));
	for (const edge of edges) {
		if (edge.type === "directory" || edge.source === edge.target) continue;
		if (counts.has(edge.target)) counts.set(edge.target, (counts.get(edge.target) ?? 0) + 1);
	}
	return counts;
}

/** Radius driven by in-degree, with a small floor from total degree so link-only notes stay visible. */
export function hubRadius(inDegree: number, degree: number): number {
	return graphNodeRadius(Math.max(inDegree * 1.5, degree * 0.5));
}

function adjacency(nodes: readonly ModelNode[], edges: readonly ModelEdge[]) {
	const map = new Map<string, Set<string>>(nodes.map((node) => [node.path, new Set<string>()]));
	for (const edge of edges) {
		if (!map.has(edge.source) || !map.has(edge.target) || edge.source === edge.target) continue;
		map.get(edge.source)?.add(edge.target);
		map.get(edge.target)?.add(edge.source);
	}
	return map;
}

/**
 * Topic clusters. The worker's Louvain communities are used when present; otherwise a
 * deterministic label propagation runs on the visible graph. Cluster ids are renumbered
 * by size (0 = largest) so colours stay stable between refreshes.
 */
export function graphClusters(nodes: readonly ModelNode[], edges: readonly ModelEdge[]): Map<string, number> {
	const raw = new Map<string, number>();
	const fromWorker = nodes.some((node) => typeof node.community === "number" && node.community >= 0);
	if (fromWorker) {
		let next = -1;
		for (const node of nodes)
			raw.set(node.path, node.community !== undefined && node.community >= 0 ? node.community : next--);
	} else {
		const adj = adjacency(nodes, edges);
		const order = [...nodes].map((node) => node.path).sort();
		const label = new Map(order.map((path, index) => [path, index]));
		for (let round = 0; round < 12; round++) {
			let changed = false;
			for (const path of order) {
				const counts = new Map<number, number>();
				for (const other of adj.get(path) ?? []) {
					const value = label.get(other) as number;
					counts.set(value, (counts.get(value) ?? 0) + 1);
				}
				if (counts.size === 0) continue;
				let best = label.get(path) as number;
				let bestCount = counts.get(best) ?? 0;
				for (const [value, count] of counts)
					if (count > bestCount || (count === bestCount && value < best)) {
						best = value;
						bestCount = count;
					}
				if (best !== label.get(path)) {
					label.set(path, best);
					changed = true;
				}
			}
			if (!changed) break;
		}
		for (const [path, value] of label) raw.set(path, value);
	}
	const sizes = new Map<number, number>();
	for (const value of raw.values()) sizes.set(value, (sizes.get(value) ?? 0) + 1);
	const ranked = [...sizes.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([value]) => value);
	const rank = new Map(ranked.map((value, index) => [value, index]));
	return new Map([...raw].map(([path, value]) => [path, rank.get(value) ?? 0]));
}

/** Notes within `hops` links of `center` (inclusive). */
export function localNeighbourhood(
	center: string,
	nodes: readonly ModelNode[],
	edges: readonly ModelEdge[],
	hops = 1,
): Set<string> {
	const adj = adjacency(nodes, edges);
	const seen = new Set<string>(adj.has(center) ? [center] : []);
	let frontier = [...seen];
	for (let step = 0; step < hops; step++) {
		const next: string[] = [];
		for (const path of frontier)
			for (const other of adj.get(path) ?? [])
				if (!seen.has(other)) {
					seen.add(other);
					next.push(other);
				}
		frontier = next;
	}
	return seen;
}

/**
 * Force layout grouped by cluster: every cluster gets an anchor on a ring sized by its
 * share of notes, notes start near their anchor and are pulled towards it while links
 * and repulsion arrange them. Deterministic, no randomness, O(n²) per step (n ≤ 400).
 */
export function clusterLayout(
	nodes: readonly ModelNode[],
	edges: readonly ModelEdge[],
	clusters: Map<string, number>,
	radii: Map<string, number>,
	iterations = 200,
): Map<string, Point> {
	const points = new Map<string, Point>();
	if (nodes.length === 0) return points;
	const cx = GRAPH_WIDTH / 2;
	const cy = GRAPH_HEIGHT / 2;
	const members = new Map<number, string[]>();
	for (const node of nodes) {
		const id = clusters.get(node.path) ?? 0;
		if (!members.has(id)) members.set(id, []);
		members.get(id)?.push(node.path);
	}
	const ids = [...members.keys()].sort((a, b) => a - b);
	// Singletons (orphans) are parked on an outer ring instead of each claiming an anchor.
	const big = ids.filter((id) => (members.get(id)?.length ?? 0) > 1);
	const anchors = new Map<number, { x: number; y: number }>();
	big.forEach((id, index) => {
		if (big.length === 1) {
			anchors.set(id, { x: cx, y: cy });
			return;
		}
		const angle = (2 * Math.PI * index) / big.length - Math.PI / 2;
		const ring = index === 0 && big.length > 2 ? 0 : 1;
		anchors.set(id, {
			x: cx + Math.cos(angle) * GRAPH_WIDTH * 0.28 * ring,
			y: cy + Math.sin(angle) * GRAPH_HEIGHT * 0.28 * ring,
		});
	});
	const singles = ids.filter((id) => (members.get(id)?.length ?? 0) <= 1);
	singles.forEach((id, index) => {
		const angle = (2 * Math.PI * index) / Math.max(1, singles.length);
		anchors.set(id, {
			x: cx + Math.cos(angle) * GRAPH_WIDTH * 0.44,
			y: cy + Math.sin(angle) * GRAPH_HEIGHT * 0.42,
		});
	});
	for (const id of ids) {
		const list = members.get(id) ?? [];
		const anchor = anchors.get(id) ?? { x: cx, y: cy };
		list.forEach((path, index) => {
			const angle = index * 2.399963;
			const r = 6 + 5 * Math.sqrt(index);
			points.set(path, {
				x: anchor.x + Math.cos(angle) * r,
				y: anchor.y + Math.sin(angle) * r,
				vx: 0,
				vy: 0,
			});
		});
	}
	const list = nodes.map((node) => ({ path: node.path, p: points.get(node.path) as Point }));
	const ideal = Math.max(18, Math.min(60, Math.sqrt((GRAPH_WIDTH * GRAPH_HEIGHT) / nodes.length) * 0.55));
	for (let step = 0; step < iterations; step++) {
		const cooling = 1 - step / iterations;
		for (let i = 0; i < list.length; i++) {
			const a = list[i] as (typeof list)[number];
			for (let j = i + 1; j < list.length; j++) {
				const b = list[j] as (typeof list)[number];
				let dx = a.p.x - b.p.x;
				let dy = a.p.y - b.p.y;
				let d2 = dx * dx + dy * dy;
				if (d2 < 0.01) {
					dx = 0.1 * ((i % 3) - 1 || 1);
					dy = 0.1;
					d2 = 0.02;
				}
				const same = clusters.get(a.path) === clusters.get(b.path);
				const force = ((same ? 0.5 : 1) * ideal * ideal) / d2;
				a.p.vx += dx * force * 0.04;
				a.p.vy += dy * force * 0.04;
				b.p.vx -= dx * force * 0.04;
				b.p.vy -= dy * force * 0.04;
			}
		}
		for (const edge of edges) {
			const a = points.get(edge.source);
			const b = points.get(edge.target);
			if (!a || !b) continue;
			const dx = b.x - a.x;
			const dy = b.y - a.y;
			const distance = Math.hypot(dx, dy) || 0.1;
			const pull = ((distance - ideal) / distance) * (edge.type === "directory" ? 0.02 : 0.06);
			a.vx += dx * pull;
			a.vy += dy * pull;
			b.vx -= dx * pull;
			b.vy -= dy * pull;
		}
		for (const { path, p } of list) {
			const anchor = anchors.get(clusters.get(path) ?? 0) ?? { x: cx, y: cy };
			p.vx += (anchor.x - p.x) * 0.02;
			p.vy += (anchor.y - p.y) * 0.02;
			const speed = Math.hypot(p.vx, p.vy);
			const max = 10 * cooling + 0.4;
			if (speed > max) {
				p.vx = (p.vx / speed) * max;
				p.vy = (p.vy / speed) * max;
			}
			const r = (radii.get(path) ?? 6) + 4;
			p.x = Math.min(GRAPH_WIDTH - r, Math.max(r, p.x + p.vx));
			p.y = Math.min(GRAPH_HEIGHT - r, Math.max(r, p.y + p.vy));
			p.vx *= 0.6;
			p.vy *= 0.6;
		}
	}
	for (const point of points.values()) {
		point.vx = 0;
		point.vy = 0;
	}
	return points;
}

export type HealthKind = "orphan" | "uncited" | "warning";
export interface HealthFinding {
	path: string;
	kind: HealthKind;
}

/**
 * Karpathy-style lint layer on the graph: orphans (no links at all), Wiki pages nothing
 * links to (written but never reused), and notes the worker flagged (mirrors, missing
 * identifiers…). Infrastructure pages such as Index/Home are never findings.
 */
export function graphHealth(
	nodes: readonly ModelNode[],
	edges: readonly ModelEdge[],
	incoming: Map<string, number> = inDegrees(nodes, edges),
): HealthFinding[] {
	const findings: HealthFinding[] = [];
	const linked = new Set<string>();
	for (const edge of edges)
		if (edge.type !== "directory") {
			linked.add(edge.source);
			linked.add(edge.target);
		}
	for (const node of nodes) {
		if (node.isInfrastructure || node.nodeType === "infrastructure" || node.nodeType === "navigation")
			continue;
		if (!linked.has(node.path) && node.degree === 0) findings.push({ path: node.path, kind: "orphan" });
		else if ((node.kind === "wiki" || node.nodeType === "wiki") && (incoming.get(node.path) ?? 0) === 0)
			findings.push({ path: node.path, kind: "uncited" });
		if (node.warnings?.length) findings.push({ path: node.path, kind: "warning" });
	}
	return findings;
}

export type NodeShape = "circle" | "square" | "diamond";
/** Type as shape so colour can carry the cluster: sources round, Wiki square, claims/evidence diamond. */
export function shapeFor(category: string): NodeShape {
	if (category === "wiki" || category === "concept" || category === "method" || category === "software")
		return "square";
	if (category === "claim" || category === "evidence" || category === "decision" || category === "question")
		return "diamond";
	return "circle";
}

const CLUSTER_PALETTE = [
	"#3b6fd8",
	"#1f8a7a",
	"#c9822b",
	"#8a63d2",
	"#d0567a",
	"#4f9d3a",
	"#2a9fc2",
	"#b5651d",
	"#6c7bd8",
	"#a3a33a",
];
export function clusterColor(cluster: number, size: number): string {
	if (size <= 1) return "#9aa4b8";
	return CLUSTER_PALETTE[cluster % CLUSTER_PALETTE.length] as string;
}
