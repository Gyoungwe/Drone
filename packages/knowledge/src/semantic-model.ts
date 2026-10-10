/** Pure semantic projection for the knowledge network.
 *
 * The input deliberately accepts the old graph shape.  All fields added by
 * this module are optional at the transport boundary, so an older worker can
 * still be rendered by a newer desktop.
 */

export type SemanticView = "semantic" | "all";
export type RelationType = "link" | "directory" | "duplicate";

export interface SemanticNodeInput {
	path: string;
	title: string;
	kind: string;
	degree?: number;
	scope?: string;
	/** Stable bibliographic identity (DOI, PMID, arXiv, or a producer key). */
	identity?: string | null;
	/** Frontmatter type used to build the fixed research-sector layout. */
	contentType?: string | null;
}

export interface SemanticEdgeInput {
	source: string;
	target: string;
	type?: RelationType;
}

export interface SemanticNode {
	path: string;
	title: string;
	kind: string;
	degree: number;
	nodeType: "note" | "wiki" | "navigation" | "mirror" | "infrastructure";
	isInfrastructure: boolean;
	community: number;
	x: number;
	y: number;
	mirrors?: string[];
	warnings?: string[];
	/** Normalized content category (paper, method, software, …). */
	contentType?: string;
	/** Research question/topic nodes anchor the surrounding category sectors. */
	isMain?: boolean;
	/** Main nodes this item bridges; shared items are placed between their anchors. */
	sharedWith?: string[];
}

export interface SemanticRelation {
	source: string;
	target: string;
	type: RelationType;
}

export interface SemanticGraph {
	nodes: SemanticNode[];
	edges: { source: string; target: string }[];
	relations: SemanticRelation[];
	duplicates: { canonical: string; duplicate: string }[];
	communities: Record<string, number>;
	layout: Record<string, { x: number; y: number }>;
}

const WIDTH = 720;
const HEIGHT = 440;
const INFRASTRUCTURE = /(?:^|\/)(?:Index|Context|Home|Template|Templates)\.md$/i;
const MAIN_TYPES = new Set(["question", "concept", "claim", "decision"]);
const CATEGORY_BY_PATH: Array<[RegExp, string]> = [
	[/\/Papers\//i, "paper"],
	[/\/Methods?\//i, "method"],
	[/\/Software\//i, "software"],
	[/\/Datasets?\//i, "dataset"],
	[/\/(?:Wiki|Wikis)\//i, "wiki"],
	[/\/(?:Questions?|Research)\//i, "question"],
];

/** Keep category colors and sectors stable even for older notes without typed frontmatter. */
export function contentCategory(node: Pick<SemanticNodeInput, "path" | "kind" | "contentType">): string {
	const explicit = node.contentType?.trim().toLowerCase();
	if (explicit) return explicit;
	for (const [pattern, category] of CATEGORY_BY_PATH) if (pattern.test(node.path)) return category;
	if (node.kind === "wiki") return "wiki";
	return "other";
}

function isMainNode(node: Pick<SemanticNodeInput, "path" | "title" | "contentType">, category: string): boolean {
	if (MAIN_TYPES.has(category)) return true;
	return /(?:^|\/)(?:Questions?|Research[-_ ]?Questions?)\/|(?:研究问题|研究主题|research question)/i.test(
		`${node.path} ${node.title}`,
	);
}

const SECTOR_ANGLES: Record<string, number> = {
	// SVG y grows downwards: 7 o'clock is 120° and 8 o'clock is 150°.
	paper: (2 * Math.PI) / 3,
	software: (5 * Math.PI) / 6,
	method: Math.PI,
	dataset: (7 * Math.PI) / 6,
	evidence: (4 * Math.PI) / 3,
	claim: (3 * Math.PI) / 2,
	concept: (11 * Math.PI) / 6,
	entity: 0,
	idea: Math.PI / 6,
	decision: Math.PI / 3,
	question: Math.PI / 2,
	wiki: (3 * Math.PI) / 4,
	other: (11 * Math.PI) / 6,
};

function sectorLayout(
	nodes: Map<string, SemanticNodeInput>,
	relations: SemanticRelation[],
	seed: number,
): { layout: Record<string, { x: number; y: number }>; mains: Set<string>; sharedWith: Map<string, string[]> } {
	const paths = [...nodes.keys()].sort(comparePath);
	const adjacency = new Map<string, Set<string>>(paths.map((path) => [path, new Set()]));
	for (const relation of relations) {
		if (relation.type !== "link") continue;
		adjacency.get(relation.source)?.add(relation.target);
		adjacency.get(relation.target)?.add(relation.source);
	}
	const categories = new Map(paths.map((path) => [path, contentCategory(nodes.get(path) as SemanticNodeInput)]));
	const mains = new Set(paths.filter((path) => isMainNode(nodes.get(path) as SemanticNodeInput, categories.get(path) ?? "other")));
	if (!mains.size) {
		paths
			.slice()
			.sort((a, b) => (adjacency.get(b)?.size ?? 0) - (adjacency.get(a)?.size ?? 0) || comparePath(a, b))
			.slice(0, Math.min(3, paths.length))
			.forEach((path) => {
				mains.add(path);
			});
	}
	const sharedWith = new Map<string, string[]>();
	for (const path of paths) {
		if (mains.has(path)) continue;
		const connected = [...(adjacency.get(path) ?? [])].filter((candidate) => mains.has(candidate)).sort(comparePath);
		if (connected.length > 1) sharedWith.set(path, connected);
	}
	const mainPaths = [...mains].sort(comparePath);
	const centers = new Map<string, { x: number; y: number }>();
	const centerY = HEIGHT * 0.48;
	const spacing = Math.min(270, Math.max(170, (WIDTH - 190) / Math.max(1, mainPaths.length - 1)));
	const startX = WIDTH / 2 - ((mainPaths.length - 1) * spacing) / 2;
	mainPaths.forEach((path, index) => {
		centers.set(path, { x: startX + index * spacing, y: centerY });
	});
	const layout: Record<string, { x: number; y: number }> = {};
	for (const path of mainPaths) layout[path] = centers.get(path) as { x: number; y: number };
	for (const path of paths) {
		if (mains.has(path)) continue;
		const bridges = sharedWith.get(path);
		if (bridges?.length) {
			const average = bridges.reduce(
				(point, main) => ({ x: point.x + (centers.get(main)?.x ?? WIDTH / 2), y: point.y + (centers.get(main)?.y ?? centerY) }),
				{ x: 0, y: 0 },
			);
			const jitter = (hash(`${path}:bridge`, seed) - 0.5) * 30;
			layout[path] = { x: average.x / bridges.length, y: average.y / bridges.length - 36 + jitter };
			continue;
		}
		const connectedMain = [...(adjacency.get(path) ?? [])].find((candidate) => mains.has(candidate));
		const anchor = connectedMain ? centers.get(connectedMain) : { x: WIDTH / 2, y: centerY };
		const category = categories.get(path) ?? "other";
		const angle = SECTOR_ANGLES[category] ?? SECTOR_ANGLES.other ?? 0;
		const siblings = paths.filter(
			(candidate) => !mains.has(candidate) && !sharedWith.has(candidate) && categories.get(candidate) === category && [...(adjacency.get(candidate) ?? [])].includes(connectedMain ?? ""),
		);
		const index = Math.max(0, siblings.indexOf(path));
		const spread = Math.min(0.22, 0.08 + siblings.length * 0.012);
		const offset = (index - (siblings.length - 1) / 2) * spread;
		const radius = 92 + Math.floor(index / 3) * 26 + hash(`${path}:radius`, seed) * 10;
		const jitter = (hash(`${path}:angle`, seed) - 0.5) * 0.06;
		layout[path] = { x: (anchor?.x ?? WIDTH / 2) + radius * Math.cos(angle + offset + jitter), y: (anchor?.y ?? centerY) + radius * Math.sin(angle + offset + jitter) };
	}
	for (const path of paths) {
		if (layout[path]) continue;
		const angle = 2 * Math.PI * hash(`${path}:outer`, seed);
		layout[path] = { x: WIDTH / 2 + 175 * Math.cos(angle), y: centerY + 145 * Math.sin(angle) };
	}
	return { layout, mains, sharedWith };
}

export function isInfrastructureNode(node: Pick<SemanticNodeInput, "path" | "kind">): boolean {
	return node.kind === "navigation" || INFRASTRUCTURE.test(node.path);
}

export function nodeType(node: Pick<SemanticNodeInput, "path" | "kind">): SemanticNode["nodeType"] {
	if (isInfrastructureNode(node)) return "infrastructure";
	if (node.kind === "wiki") return "wiki";
	return "note";
}

/** Classify an edge without changing the meaning of legacy `edges`. */
export function classifyRelation(
	source: Pick<SemanticNodeInput, "path">,
	target: Pick<SemanticNodeInput, "path">,
	type?: RelationType,
): RelationType {
	if (type) return type;
	const sourceDir = source.path.slice(0, source.path.lastIndexOf("/"));
	const targetDir = target.path.slice(0, target.path.lastIndexOf("/"));
	return sourceDir && sourceDir === targetDir ? "directory" : "link";
}

function normalizeIdentity(value: string | null | undefined): string | null {
	if (!value) return null;
	const normalized = value.trim().toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\//, "");
	if (/^doi:\s*/.test(normalized) || /^10\.\d{4,9}\//.test(normalized)) return `doi:${normalized.replace(/^doi:\s*/, "")}`;
	if (/^pmid:\s*\d+$/.test(normalized) || /^\d{1,9}$/.test(normalized)) return `pmid:${normalized.replace(/^pmid:\s*/, "")}`;
	if (/^arxiv:\s*/.test(normalized) || /^\d{4}\.\d{4,5}(?:v\d+)?$/.test(normalized)) return `arxiv:${normalized.replace(/^arxiv:\s*/, "")}`;
	return normalized || null;
}

function fallbackIdentity(node: SemanticNodeInput): string | null {
	if (node.identity) return normalizeIdentity(node.identity);
	return null;
}

function canonicalRank(path: string): [number, string] {
	return [path.startsWith("Library/") ? 0 : path.startsWith("Projects/") ? 1 : 2, path];
}

function comparePath(a: string, b: string): number {
	return a.localeCompare(b);
}

function hash(value: string, seed = 42): number {
	let h = (2166136261 ^ seed) >>> 0;
	for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 16777619);
	return (h >>> 0) / 4294967296;
}

/** A deterministic local-moving modularity pass. It is intentionally small,
 * dependency-free, and uses sorted keys for stable results across input order. */
export function assignCommunities(paths: string[], edges: SemanticRelation[], seed = 42): Record<string, number> {
	const ordered = [...new Set(paths)].sort(comparePath);
	const adjacency = new Map<string, Set<string>>(ordered.map((path) => [path, new Set()]));
	for (const edge of edges) {
		if (edge.type !== "link" || !adjacency.has(edge.source) || !adjacency.has(edge.target)) continue;
		adjacency.get(edge.source)?.add(edge.target);
		adjacency.get(edge.target)?.add(edge.source);
	}
	const labels = new Map(ordered.map((path, index) => [path, index]));
	const degree = new Map(ordered.map((path) => [path, adjacency.get(path)?.size ?? 0]));
	const total = [...degree.values()].reduce((sum, value) => sum + value, 0) || 1;
	for (let round = 0; round < 12; round++) {
		let changed = false;
		for (const path of ordered) {
			const neighbours = [...(adjacency.get(path) ?? [])].sort(comparePath);
			if (!neighbours.length) continue;
			const scores = new Map<number, number>();
			for (const neighbour of neighbours) {
				const label = labels.get(neighbour) ?? 0;
				scores.set(label, (scores.get(label) ?? 0) + 1 - (degree.get(path) ?? 0) * (degree.get(neighbour) ?? 0) / total);
			}
			const current = labels.get(path) ?? 0;
			const best = [...scores.entries()].sort((a, b) => b[1] - a[1] || hash(`${path}:${a[0]}`, seed) - hash(`${path}:${b[0]}`, seed) || a[0] - b[0])[0];
			if (best && best[1] > 0 && best[0] !== current) {
				labels.set(path, best[0]);
				changed = true;
			}
		}
		if (!changed) break;
	}
	const counts = new Map<number, number>();
	for (const label of labels.values()) counts.set(label, (counts.get(label) ?? 0) + 1);
	const rank = new Map([...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([label], index) => [label, index]));
	return Object.fromEntries(ordered.map((path) => [path, (degree.get(path) ?? 0) ? (rank.get(labels.get(path) ?? -1) ?? -1) : -1]));
}

export function createSemanticModel(
	input: { nodes: SemanticNodeInput[]; edges?: SemanticEdgeInput[] },
	options: { view?: SemanticView; mergeMirrors?: boolean; seed?: number } = {},
): SemanticGraph {
	const view = options.view ?? "semantic";
	const mergeMirrors = options.mergeMirrors ?? true;
	const seed = options.seed ?? 42;
	const sourceNodes = [...input.nodes].sort((a, b) => comparePath(a.path, b.path));
	const visible = sourceNodes.filter((node) => view === "all" || !isInfrastructureNode(node));
	const groups = new Map<string, SemanticNodeInput[]>();
	for (const node of visible) {
		const identity = fallbackIdentity(node);
		if (mergeMirrors && identity) {
			const group = groups.get(identity) ?? [];
			group.push(node);
			groups.set(identity, group);
		}
	}
	const canonicalFor = new Map<string, string>();
	const duplicates: { canonical: string; duplicate: string }[] = [];
	for (const group of groups.values()) {
		if (group.length < 2) continue;
		const ordered = [...group].sort((a, b) => {
			const [ar, ap] = canonicalRank(a.path);
			const [br, bp] = canonicalRank(b.path);
			return ar - br || ap.localeCompare(bp);
		});
		const first = ordered[0];
		if (!first) continue;
		const canonical = first.path;
		for (const node of ordered) {
			canonicalFor.set(node.path, canonical);
			if (node.path !== canonical) duplicates.push({ canonical, duplicate: node.path });
		}
	}
	const modelNodes = new Map<string, SemanticNodeInput>();
	for (const node of visible) {
		const canonical = canonicalFor.get(node.path) ?? node.path;
		if (!modelNodes.has(canonical)) modelNodes.set(canonical, node);
	}
	const relations: SemanticRelation[] = [];
	for (const raw of input.edges ?? []) {
		const source = canonicalFor.get(raw.source) ?? raw.source;
		const target = canonicalFor.get(raw.target) ?? raw.target;
		if (source === target || !modelNodes.has(source) || !modelNodes.has(target)) continue;
		const type = classifyRelation({ path: source }, { path: target }, raw.type);
		if (!relations.some((edge) => edge.source === source && edge.target === target && edge.type === type)) relations.push({ source, target, type });
	}
	if (view === "all") {
		const all = [...modelNodes.keys()].sort(comparePath);
		const siblings = new Map<string, string[]>();
		for (const path of all) {
			const parent = path.slice(0, path.lastIndexOf("/"));
			const group = siblings.get(parent) ?? [];
			group.push(path);
			siblings.set(parent, group);
		}
		for (const group of siblings.values()) {
			for (let i = 1; i < group.length; i++) {
				const source = group[i - 1];
				const target = group[i];
				if (source && target && !relations.some((edge) => edge.source === source && edge.target === target)) relations.push({ source, target, type: "directory" });
			}
		}
	}
	for (const duplicate of duplicates) relations.push({ source: duplicate.canonical, target: duplicate.duplicate, type: "duplicate" });
	const communities = assignCommunities([...modelNodes.keys()], relations, seed);
	const { layout, mains, sharedWith } = sectorLayout(modelNodes, relations, seed);
	const linkRelations = relations.filter((edge) => edge.type === "link");
	const degree = new Map<string, number>();
	for (const edge of linkRelations) {
		degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
		degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
	}
	const nodes = [...modelNodes.entries()].sort(([a], [b]) => comparePath(a, b)).map(([path, node]) => {
		const mirrorPaths = [...canonicalFor.entries()].filter(([, canonical]) => canonical === path).map(([mirror]) => mirror).filter((mirror) => mirror !== path).sort(comparePath);
		const type = nodeType(node);
		const category = contentCategory(node);
		return {
			path,
			title: node.title,
			kind: node.kind,
			degree: degree.get(path) ?? 0,
			nodeType: mirrorPaths.length ? "mirror" : type,
			isInfrastructure: type === "infrastructure",
			community: communities[path] ?? -1,
			contentType: category,
			isMain: mains.has(path),
			...(sharedWith.has(path) ? { sharedWith: sharedWith.get(path) } : {}),
			...(layout[path] ?? { x: WIDTH / 2, y: HEIGHT / 2 }),
			...(mirrorPaths.length ? { mirrors: mirrorPaths, warnings: ["mirror"] } : {}),
		};
	});
	return { nodes, edges: linkRelations.map(({ source, target }) => ({ source, target })), relations, duplicates, communities, layout };
}
