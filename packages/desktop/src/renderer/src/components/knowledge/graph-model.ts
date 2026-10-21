import { GRAPH_HEIGHT, GRAPH_WIDTH, graphNodeRadius, type Point } from "./graph-layout";

export interface ModelNode {
	path: string;
	title?: string;
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

interface Placed {
	path: string;
	x: number;
	y: number;
	vx: number;
	vy: number;
}

/** Force layout of one cluster around (0,0); returns positions and the enclosing radius. */
function layoutCluster(
	paths: string[],
	edges: readonly ModelEdge[],
	radii: Map<string, number>,
	iterations: number,
): { points: Placed[]; radius: number } {
	const points = paths.map((path, index) => {
		const angle = index * 2.399963;
		const r = 8 * Math.sqrt(index);
		return { path, x: Math.cos(angle) * r, y: Math.sin(angle) * r, vx: 0, vy: 0 };
	});
	if (points.length > 1) {
		const byPath = new Map(points.map((point) => [point.path, point]));
		const local = edges.filter((edge) => byPath.has(edge.source) && byPath.has(edge.target));
		const ideal = 26;
		for (let step = 0; step < iterations; step++) {
			const cooling = 1 - step / iterations;
			for (let i = 0; i < points.length; i++) {
				const a = points[i] as Placed;
				for (let j = i + 1; j < points.length; j++) {
					const b = points[j] as Placed;
					let dx = a.x - b.x;
					let dy = a.y - b.y;
					let d2 = dx * dx + dy * dy;
					if (d2 < 0.01) {
						dx = 0.1 * (((i + j) % 3) - 1 || 1);
						dy = 0.1;
						d2 = 0.02;
					}
					const force = Math.min(4, (ideal * ideal) / d2) * 0.05;
					a.vx += dx * force;
					a.vy += dy * force;
					b.vx -= dx * force;
					b.vy -= dy * force;
				}
			}
			for (const edge of local) {
				const a = byPath.get(edge.source) as Placed;
				const b = byPath.get(edge.target) as Placed;
				const dx = b.x - a.x;
				const dy = b.y - a.y;
				const distance = Math.hypot(dx, dy) || 0.1;
				const pull = ((distance - ideal) / distance) * (edge.type === "directory" ? 0.03 : 0.08);
				a.vx += dx * pull;
				a.vy += dy * pull;
				b.vx -= dx * pull;
				b.vy -= dy * pull;
			}
			for (const p of points) {
				p.vx -= p.x * 0.01;
				p.vy -= p.y * 0.01;
				const speed = Math.hypot(p.vx, p.vy);
				const max = 8 * cooling + 0.3;
				if (speed > max) {
					p.vx = (p.vx / speed) * max;
					p.vy = (p.vy / speed) * max;
				}
				p.x += p.vx;
				p.y += p.vy;
				p.vx *= 0.6;
				p.vy *= 0.6;
			}
		}
		const cx = points.reduce((sum, p) => sum + p.x, 0) / points.length;
		const cy = points.reduce((sum, p) => sum + p.y, 0) / points.length;
		for (const p of points) {
			p.x -= cx;
			p.y -= cy;
		}
	}
	const radius = Math.max(
		...points.map((p) => Math.hypot(p.x, p.y) + (radii.get(p.path) ?? 6)),
		radii.get(points[0]?.path ?? "") ?? 6,
	);
	return { points, radius };
}

/**
 * Cluster-first layout: each topic cluster is laid out on its own, then the clusters
 * are packed as discs from the centre outwards (largest first) and the result is
 * fitted to the canvas. There is no repulsion between clusters, so small groups no
 * longer get pushed against the canvas edges. Deterministic.
 */
export function clusterLayout(
	nodes: readonly ModelNode[],
	edges: readonly ModelEdge[],
	clusters: Map<string, number>,
	radii: Map<string, number>,
	iterations = 160,
): Map<string, Point> {
	const result = new Map<string, Point>();
	if (nodes.length === 0) return result;
	const members = new Map<number, string[]>();
	for (const node of nodes) {
		const id = clusters.get(node.path) ?? 0;
		if (!members.has(id)) members.set(id, []);
		members.get(id)?.push(node.path);
	}
	const groups = [...members.entries()]
		.map(([id, paths]) => ({ id, ...layoutCluster(paths, edges, radii, iterations) }))
		.sort((a, b) => b.points.length - a.points.length || a.id - b.id);
	// Pack discs on widening elliptical rings that follow the canvas aspect ratio.
	const aspect = GRAPH_WIDTH / GRAPH_HEIGHT;
	const gap = 10;
	const placed: { x: number; y: number; r: number }[] = [];
	const centres = new Map<number, { x: number; y: number }>();
	for (const group of groups) {
		let spot = { x: 0, y: 0 };
		if (placed.length > 0) {
			search: for (let ring = 1; ring < 400; ring++) {
				const step = ring * 6;
				const count = Math.max(12, Math.round(ring * 3));
				for (let k = 0; k < count; k++) {
					const angle = (2 * Math.PI * k) / count + ring * 0.37;
					const x = Math.cos(angle) * step * Math.sqrt(aspect);
					const y = (Math.sin(angle) * step) / Math.sqrt(aspect);
					if (placed.every((other) => Math.hypot(other.x - x, other.y - y) >= other.r + group.radius + gap)) {
						spot = { x, y };
						break search;
					}
				}
			}
		}
		placed.push({ ...spot, r: group.radius });
		centres.set(group.id, spot);
	}
	const minX = Math.min(...placed.map((d) => d.x - d.r));
	const maxX = Math.max(...placed.map((d) => d.x + d.r));
	const minY = Math.min(...placed.map((d) => d.y - d.r));
	const maxY = Math.max(...placed.map((d) => d.y + d.r));
	const margin = 18;
	const scale = Math.min(
		1.6,
		(GRAPH_WIDTH - margin * 2) / Math.max(1, maxX - minX),
		(GRAPH_HEIGHT - margin * 2) / Math.max(1, maxY - minY),
	);
	const offsetX = GRAPH_WIDTH / 2 - ((minX + maxX) / 2) * scale;
	const offsetY = GRAPH_HEIGHT / 2 - ((minY + maxY) / 2) * scale;
	for (const group of groups) {
		const centre = centres.get(group.id) ?? { x: 0, y: 0 };
		for (const p of group.points) {
			const r = (radii.get(p.path) ?? 6) + 2;
			result.set(p.path, {
				x: Math.min(GRAPH_WIDTH - r, Math.max(r, offsetX + (centre.x + p.x) * scale)),
				y: Math.min(GRAPH_HEIGHT - r, Math.max(r, offsetY + (centre.y + p.y) * scale)),
				vx: 0,
				vy: 0,
			});
		}
	}
	// Keep the caller's node order.
	return new Map(nodes.map((node) => [node.path, result.get(node.path) as Point]));
}

export type HealthKind = "orphan" | "uncited" | "untitled" | "warning";

/** Same rule as the knowledge worker: a file name ("PMC7022188.1.pdf") is not a topic. */
export function looksLikeFileName(title: string): boolean {
	const value = String(title || "").trim();
	if (!value) return true;
	if (/\.(?:pdf|html?|md|txt|docx?|xlsx?|csv|json|zip|tar|gz)$/i.test(value)) return true;
	if (/^(?:PMC|PMID)?\d[\d.]*$/i.test(value)) return true;
	return /^[a-z0-9]+(?:[-_][a-z0-9]+){2,}$/.test(value) && /\d{4,}|[a-f0-9]{12,}/.test(value);
}
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
		if (node.title !== undefined && looksLikeFileName(node.title))
			findings.push({ path: node.path, kind: "untitled" });
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
