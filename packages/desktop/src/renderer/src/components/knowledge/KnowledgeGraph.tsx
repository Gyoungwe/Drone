import type { KnowledgeGraph as GraphData, KnowledgeNoteLinks } from "@drone/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { getPi } from "../../api";
import { useI18nStore } from "../../i18n";
import { COMPOSER_FOCUS_EVENT, useDraftStore } from "../../stores/drafts";
import { useKnowledgeStore } from "../../stores/knowledge";
import { useSessionsStore } from "../../stores/sessions";
import { useUiStore } from "../../stores/ui";
import { Button } from "../ui/Button";
import { useKnowledgeText } from "./copy";
import {
	declutterLayout,
	graphNodeRadius,
	GRAPH_HEIGHT as HEIGHT,
	type LabelPlacement,
	layoutGraph,
	mergeIncrementalLayout,
	type Point,
	placeGraphLabels,
	GRAPH_WIDTH as WIDTH,
} from "./graph-layout";
import {
	clusterColor,
	clusterLayout,
	graphClusters,
	graphHealth,
	type HealthKind,
	hubRadius,
	inDegrees,
	localNeighbourhood,
	type NodeShape,
	shapeFor,
} from "./graph-model";
import { openKnowledgeNote } from "./KnowledgeLinks";

const GRAPH_LIMIT = 400;
const MIN_ZOOM = 0.65;
const MAX_ZOOM = 2.8;
type RelationFilter = "all" | "link" | "directory";
type Camera = { x: number; y: number; scale: number };
type GraphCategory =
	| "paper"
	| "method"
	| "software"
	| "dataset"
	| "concept"
	| "entity"
	| "idea"
	| "claim"
	| "evidence"
	| "decision"
	| "question"
	| "wiki"
	| "other";
const LIVE_BATCH_MS = 1000;
/** Permanent labels for at most this many notes (by link count); others label on hover. */
const LABEL_LIMIT = 14;
/** New nodes/edges use the live green, distinct from the paper blue. */
const LIVE_COLOR = "#059669";

const CATEGORY_COLORS: Record<GraphCategory, string> = {
	paper: "#3b6fd8",
	method: "#1f8a7a",
	software: "#c9822b",
	dataset: "#7fc5e5",
	concept: "#c58ee8",
	entity: "#e4a0b5",
	idea: "#8a63d2",
	claim: "#f1d36b",
	evidence: "#63d6d0",
	decision: "#ff9f73",
	question: "#b8a1ff",
	wiki: "#9bb5ff",
	other: "#9aa4b8",
};

const CATEGORY_LABELS_ZH: Record<GraphCategory, string> = {
	paper: "文献",
	method: "方法",
	software: "软件",
	dataset: "数据集",
	concept: "概念",
	entity: "实体",
	idea: "想法",
	claim: "主张",
	evidence: "证据",
	decision: "决策",
	question: "问题",
	wiki: "Wiki",
	other: "其他",
};
const CATEGORY_LABELS_EN: Record<GraphCategory, string> = {
	paper: "Paper",
	method: "Method",
	software: "Software",
	dataset: "Dataset",
	concept: "Concept",
	entity: "Entity",
	idea: "Idea",
	claim: "Claim",
	evidence: "Evidence",
	decision: "Decision",
	question: "Question",
	wiki: "Wiki",
	other: "Other",
};

function categoryOf(node: GraphData["nodes"][number]): GraphCategory {
	const value = (node.contentType ?? node.type ?? "other").toLowerCase() as GraphCategory;
	return value in CATEGORY_COLORS ? value : node.kind === "wiki" ? "wiki" : "other";
}

function clampZoom(scale: number): number {
	return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));
}

function clampCamera(camera: Camera): Camera {
	return { ...camera, scale: clampZoom(camera.scale) };
}

function graphNodes(data: GraphData): GraphData["nodes"] {
	return data.semantic?.nodes ?? data.nodes;
}

function graphEdges(data: GraphData) {
	const graph = data.semantic ?? data;
	if (graph.relations)
		return graph.relations
			.filter((edge) => edge.type !== "duplicate")
			.map((edge) => ({ source: edge.source, target: edge.target, type: edge.type }));
	return graph.edges.map((edge) => ({
		source: edge.source,
		target: edge.target,
		type: edge.directory ? ("directory" as const) : ("link" as const),
	}));
}

function nodeColor(node: GraphData["nodes"][number]): string {
	if (node.isInfrastructure || node.nodeType === "infrastructure") return "#9aa4b8";
	return CATEGORY_COLORS[categoryOf(node)];
}

function labelText(node: GraphData["nodes"][number]): string {
	return node.title.length > 18 ? `${node.title.slice(0, 17)}…` : node.title;
}

const HEALTH_COLORS: Record<HealthKind, string> = {
	orphan: "#d0564a",
	uncited: "#c9822b",
	untitled: "#7b6fd0",
	warning: "#b8860b",
};
const HEALTH_ORDER: HealthKind[] = ["untitled", "orphan", "uncited", "warning"];
const HEALTH_COPY = {
	orphan: { label: "graphHealthOrphan", hint: "graphHealthOrphanHint", prompt: "graphHealthOrphanPrompt" },
	uncited: {
		label: "graphHealthUncited",
		hint: "graphHealthUncitedHint",
		prompt: "graphHealthUncitedPrompt",
	},
	untitled: {
		label: "graphHealthUntitled",
		hint: "graphHealthUntitledHint",
		prompt: "graphHealthUntitledPrompt",
	},
	warning: { label: "graphHealthWarning", hint: "graphHealthWarningHint", prompt: "handOffPrompt" },
} as const satisfies Record<HealthKind, { label: string; hint: string; prompt: string }>;
const LOCAL_LABEL_LIMIT = 24;

function NodeMark({
	shape,
	x,
	y,
	r,
	fill,
	stroke,
	strokeWidth,
	strokeDasharray,
	fillOpacity,
}: {
	shape: NodeShape;
	x: number;
	y: number;
	r: number;
	fill: string;
	stroke: string;
	strokeWidth: number | string;
	strokeDasharray?: string;
	fillOpacity?: number | string;
}) {
	const common = { fill, stroke, strokeWidth, strokeDasharray, fillOpacity };
	if (shape === "square") {
		const side = r * 1.75;
		return <rect x={x - side / 2} y={y - side / 2} width={side} height={side} rx={r * 0.35} {...common} />;
	}
	if (shape === "diamond") {
		const d = r * 1.3;
		return <polygon points={`${x},${y - d} ${x + d},${y} ${x},${y + d} ${x - d},${y}`} {...common} />;
	}
	return <circle cx={x} cy={y} r={r} {...common} />;
}

/** 单一科研观测台：主题关系、证据路径、节点详情与知识库操作共用一个视图。 */
export function KnowledgeGraph({
	cwd,
	revision,
	indexKey = "",
}: {
	cwd: string | null;
	revision: number;
	indexKey?: string;
}) {
	const t = useKnowledgeText();
	const language = useI18nStore((state) => state.language);
	const categoryLabels = language === "zh" ? CATEGORY_LABELS_ZH : CATEGORY_LABELS_EN;
	const nonce = useKnowledgeStore((s) => s.revision);
	const [data, setData] = useState<GraphData | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [selected, setSelected] = useState<string | null>(null);
	const [view, setView] = useState<"semantic" | "all">("semantic");
	const [mergeMirrors, setMergeMirrors] = useState(true);
	const [relationFilter, setRelationFilter] = useState<RelationFilter>("all");
	const [categoryFilter, setCategoryFilter] = useState<GraphCategory | null>(null);
	const [links, setLinks] = useState<KnowledgeNoteLinks | null>(null);
	const [hovered, setHovered] = useState<string | null>(null);
	const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, scale: 1 });
	const [freshPaths, setFreshPaths] = useState<Set<string>>(() => new Set());
	const [colorMode, setColorMode] = useState<"cluster" | "type">("cluster");
	const [scope, setScope] = useState<"global" | "local">("global");
	const [hops, setHops] = useState<1 | 2>(1);
	const [healthOn, setHealthOn] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);
	const dragRef = useRef<{ x: number; y: number; camera: Camera } | null>(null);
	const dragFrameRef = useRef<number | null>(null);
	const pendingCameraRef = useRef<Camera | null>(null);
	const previousGraphRef = useRef<Map<string, { title: string; degree: number }> | null>(null);
	const graphSignatureRef = useRef<string | null>(null);
	useEffect(
		() => () => {
			if (dragFrameRef.current !== null) cancelAnimationFrame(dragFrameRef.current);
		},
		[],
	);

	// Live refresh: knowledge write events arrive as revision/nonce/indexKey changes. Bursts within
	// one second are merged into a single fetch; while paused they queue and apply on resume.
	const liveKey = `${revision}:${nonce}:${indexKey}`;
	const [appliedKey, setAppliedKey] = useState(liveKey);
	const [paused, setPaused] = useState(false);
	const [pendingEvents, setPendingEvents] = useState(0);
	const lastKeyRef = useRef(liveKey);
	useEffect(() => {
		if (lastKeyRef.current === liveKey) return;
		lastKeyRef.current = liveKey;
		if (paused) {
			setPendingEvents((count) => count + 1);
			return;
		}
		const timer = window.setTimeout(() => setAppliedKey(liveKey), LIVE_BATCH_MS);
		return () => window.clearTimeout(timer);
	}, [liveKey, paused]);
	const togglePaused = () => {
		if (paused) {
			setPendingEvents(0);
			setAppliedKey(lastKeyRef.current);
		}
		setPaused(!paused);
	};
	// biome-ignore lint/correctness/useExhaustiveDependencies: appliedKey is the batched knowledge refresh signal
	useEffect(() => {
		let live = true;
		setError(null);
		void getPi()
			.getKnowledgeGraph({ revision, limit: GRAPH_LIMIT, view, mergeMirrors })
			.then(
				(value) => live && setData(value),
				(e) => live && setError(String((e as Error).message || e)),
			);
		return () => {
			live = false;
		};
	}, [appliedKey, view, mergeMirrors]);

	const nodes = useMemo(() => (data ? graphNodes(data) : []), [data]);
	const edges = useMemo(() => (data ? graphEdges(data) : []), [data]);
	const incoming = useMemo(() => inDegrees(nodes, edges), [nodes, edges]);
	const clusters = useMemo(() => graphClusters(nodes, edges), [nodes, edges]);
	const clusterSizes = useMemo(() => {
		const sizes = new Map<number, number>();
		for (const value of clusters.values()) sizes.set(value, (sizes.get(value) ?? 0) + 1);
		return sizes;
	}, [clusters]);
	const findings = useMemo(() => graphHealth(nodes, edges, incoming), [nodes, edges, incoming]);
	const findingsByPath = useMemo(() => {
		const map = new Map<string, HealthKind[]>();
		for (const finding of findings) map.set(finding.path, [...(map.get(finding.path) ?? []), finding.kind]);
		return map;
	}, [findings]);
	const radiusOf = (node: GraphData["nodes"][number]) =>
		hubRadius(incoming.get(node.path) ?? 0, node.degree) + (node.isMain ? 3 : 0);
	useEffect(() => {
		if (!selected || !nodes.some((node) => node.path === selected)) setSelected(null);
	}, [nodes, selected]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: nonce refreshes link counts after index changes
	useEffect(() => {
		if (!selected) {
			setLinks(null);
			return;
		}
		let live = true;
		void getPi()
			.getKnowledgeNoteLinks({ path: selected, revision })
			.then(
				(value) => live && setLinks(value),
				() => live && setLinks(null),
			);
		return () => {
			live = false;
		};
	}, [selected, revision, nonce]);

	const layoutRef = useRef<{ key: string; points: Map<string, Point> } | null>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: view/mergeMirrors reset the retained layout
	const points = useMemo(() => {
		if (!data) return new Map<string, Point>();
		const graph = data.semantic ?? data;
		const graphNodeList = graphNodes(data);
		const graphEdgeList = graphEdges(data);
		const incomingLinks = inDegrees(graphNodeList, graphEdgeList);
		// Size follows "how often this note is cited"; the same value drives the collision radius.
		const sizes = new Map(
			graphNodeList.map((node) => [
				node.path,
				Math.max((incomingLinks.get(node.path) ?? 0) * 1.5, node.degree * 0.5),
			]),
		);
		let base: Map<string, Point>;
		if (graphNodeList.length <= GRAPH_LIMIT)
			// Topic clusters pull together around their own anchor; the worker's sector layout
			// fanned every paper out from one point and piled paper-heavy vaults into a blob.
			base = clusterLayout(
				graphNodeList,
				graphEdgeList,
				graphClusters(graphNodeList, graphEdgeList),
				new Map(graphNodeList.map((node) => [node.path, graphNodeRadius(sizes.get(node.path) ?? 0)])),
			);
		else if (graph.layout)
			base = new Map(Object.entries(graph.layout).map(([path, point]) => [path, { ...point, vx: 0, vy: 0 }]));
		else if (graph.nodes.some((node) => node.x !== undefined && node.y !== undefined))
			base = new Map(
				graph.nodes.map((node) => [
					node.path,
					{ x: node.x ?? WIDTH / 2, y: node.y ?? HEIGHT / 2, vx: 0, vy: 0 },
				]),
			);
		else base = layoutGraph(graph);
		// Spread overlapping nodes (paper-heavy vaults pile up around one anchor in the worker layout).
		base = declutterLayout(base, sizes);
		const key = `${view}:${mergeMirrors}`;
		const previous = layoutRef.current?.key === key ? layoutRef.current.points : null;
		const merged = mergeIncrementalLayout(previous, base, graph);
		layoutRef.current = { key, points: merged };
		return merged;
	}, [data]);
	// Local view (Obsidian-style): only the selected note and its 1–2 hop neighbourhood,
	// re-laid out around the centre so a dense vault can still be read note by note.
	const localSet = useMemo(
		() => (scope === "local" && selected ? localNeighbourhood(selected, nodes, edges, hops) : null),
		[scope, selected, nodes, edges, hops],
	);
	const viewNodes = useMemo(
		() => (localSet ? nodes.filter((node) => localSet.has(node.path)) : nodes),
		[localSet, nodes],
	);
	const localPoints = useMemo(() => {
		if (!localSet || !selected) return null;
		const subEdges = edges.filter((edge) => localSet.has(edge.source) && localSet.has(edge.target));
		const sub = nodes.filter((node) => localSet.has(node.path));
		const placed = clusterLayout(
			sub,
			subEdges,
			new Map(sub.map((node) => [node.path, 0])),
			new Map(sub.map((node) => [node.path, hubRadius(incoming.get(node.path) ?? 0, node.degree) + 4])),
			160,
		);
		const centre = placed.get(selected);
		if (!centre) return placed;
		const dx = WIDTH / 2 - centre.x;
		const dy = HEIGHT / 2 - centre.y;
		for (const point of placed.values()) {
			point.x = Math.min(WIDTH - 16, Math.max(16, point.x + dx));
			point.y = Math.min(HEIGHT - 16, Math.max(16, point.y + dy));
		}
		return placed;
	}, [localSet, selected, nodes, edges, incoming]);
	const viewPoints = localPoints ?? points;
	const clusterHeads = useMemo(() => {
		const best = new Map<number, GraphData["nodes"][number]>();
		for (const node of nodes) {
			const cluster = clusters.get(node.path) ?? 0;
			if ((clusterSizes.get(cluster) ?? 0) < 3) continue;
			const current = best.get(cluster);
			const score = (incoming.get(node.path) ?? 0) * 2 + node.degree;
			const currentScore = current ? (incoming.get(current.path) ?? 0) * 2 + current.degree : -1;
			if (score > currentScore || (score === currentScore && current && node.path < current.path))
				best.set(cluster, node);
		}
		return best;
	}, [nodes, clusters, clusterSizes, incoming]);
	const labelled = useMemo(
		() =>
			new Set(
				localSet
					? [...viewNodes]
							.sort(
								(a, b) =>
									(incoming.get(b.path) ?? 0) - (incoming.get(a.path) ?? 0) ||
									b.degree - a.degree ||
									a.path.localeCompare(b.path),
							)
							.slice(0, LOCAL_LABEL_LIMIT)
							.map((node) => node.path)
							.concat(selected ? [selected] : [])
					: // Most-cited notes plus one head per topic cluster get a permanent label; the rest on hover.
						[...nodes]
							.filter((node) => node.degree >= 2)
							.sort(
								(a, b) =>
									(incoming.get(b.path) ?? 0) - (incoming.get(a.path) ?? 0) ||
									b.degree - a.degree ||
									a.path.localeCompare(b.path),
							)
							.slice(0, LABEL_LIMIT)
							.concat([...clusterHeads.values()])
							.concat(nodes.filter((node) => node.isMain))
							.concat(nodes.filter((node) => node.path === selected || node.path === hovered))
							.map((node) => node.path),
			),
		[nodes, viewNodes, localSet, selected, hovered, incoming, clusterHeads],
	);
	const labels = useMemo(
		() =>
			data
				? placeGraphLabels({ nodes: viewNodes }, viewPoints, labelled, selected, {
						avoidZones: [
							// The controls are absolutely positioned over the SVG's bottom-right corner.
							{ x: WIDTH - 224, y: HEIGHT - 72, width: 224, height: 72 },
							// The legend occupies the lower-left corner of the canvas.
							{ x: 0, y: HEIGHT - 82, width: 270, height: 82 },
						],
					})
				: new Map<string, LabelPlacement>(),
		[data, viewNodes, viewPoints, labelled, selected],
	);
	// biome-ignore lint/correctness/useExhaustiveDependencies: entering/leaving the local view or re-centring resets the camera
	useEffect(() => {
		setCamera({ x: 0, y: 0, scale: 1 });
	}, [scope, hops, scope === "local" ? selected : null]);
	const fillOf = (node: GraphData["nodes"][number]) => {
		if (freshPaths.has(node.path)) return LIVE_COLOR;
		if (colorMode === "type" || node.isInfrastructure || node.nodeType === "infrastructure")
			return nodeColor(node);
		const cluster = clusters.get(node.path) ?? 0;
		return clusterColor(cluster, clusterSizes.get(cluster) ?? 0);
	};
	const handOff = (path: string, kind: HealthKind) => {
		useSessionsStore.getState().createDraftSession(cwd ?? undefined);
		const id = useSessionsStore.getState().activeSessionId;
		if (!id) return;
		const template = t(HEALTH_COPY[kind].prompt);
		useDraftStore
			.getState()
			.updateDraft(id, (entry) => ({ ...entry, text: template.replace("{path}", path) }));
		useKnowledgeStore.getState().close();
		useUiStore.getState().setView("chat");
		window.dispatchEvent(new Event(COMPOSER_FOCUS_EVENT));
	};
	useEffect(() => {
		if (!data) return;
		const current = new Map(nodes.map((node) => [node.path, { title: node.title, degree: node.degree }]));
		const graphSignature = `${view}:${mergeMirrors}:${[...current]
			.map(([path, value]) => `${path}:${value.title}:${value.degree}`)
			.join("|")}`;
		const previous = previousGraphRef.current;
		const previousSignature = graphSignatureRef.current;
		previousGraphRef.current = current;
		graphSignatureRef.current = graphSignature;
		if (previous && previousSignature !== graphSignature) {
			const changed = new Set<string>();
			for (const [path, value] of current) {
				const old = previous.get(path);
				if (!old || old.title !== value.title || old.degree !== value.degree) changed.add(path);
			}
			if (changed.size > 0) {
				setFreshPaths(changed);
				const timer = window.setTimeout(() => setFreshPaths(new Set()), 3200);
				return () => window.clearTimeout(timer);
			}
		}
	}, [data, mergeMirrors, nodes, view]);
	const neighbours = useMemo(() => {
		const map = new Map<string, Set<string>>();
		for (const edge of edges) {
			if (!map.has(edge.source)) map.set(edge.source, new Set());
			if (!map.has(edge.target)) map.set(edge.target, new Set());
			map.get(edge.source)?.add(edge.target);
			map.get(edge.target)?.add(edge.source);
		}
		return map;
	}, [edges]);
	const focusPath = selected ?? hovered;
	const active = focusPath ? new Set([focusPath, ...(neighbours.get(focusPath) ?? [])]) : null;
	const visibleEdges = edges.filter(
		(edge) =>
			(relationFilter === "all" || edge.type === relationFilter) &&
			(!localSet || (localSet.has(edge.source) && localSet.has(edge.target))),
	);
	const nodeByPath = new Map(nodes.map((node) => [node.path, node]));
	const selectedNode = selected ? nodeByPath.get(selected) : undefined;
	const graph = data?.semantic ?? data;
	const isolated = graph?.health?.isolated ?? nodes.filter((node) => node.degree === 0).length;
	const duplicates = graph?.health?.duplicates ?? graph?.duplicates?.length ?? 0;
	const resetCamera = () => setCamera({ x: 0, y: 0, scale: 1 });
	const zoomBy = (factor: number) =>
		setCamera((current) => clampCamera({ ...current, scale: current.scale * factor }));
	const fitCamera = () => {
		if (!viewPoints.size) return resetCamera();
		const values = [...viewPoints.values()];
		const minX = Math.min(...values.map((point) => point.x));
		const maxX = Math.max(...values.map((point) => point.x));
		const minY = Math.min(...values.map((point) => point.y));
		const maxY = Math.max(...values.map((point) => point.y));
		const padding = 72;
		const scale = clampZoom(
			Math.min(
				(WIDTH - padding * 2) / Math.max(1, maxX - minX),
				(HEIGHT - padding * 2) / Math.max(1, maxY - minY),
			),
		);
		setCamera({
			x: WIDTH / 2 - ((minX + maxX) / 2) * scale,
			y: HEIGHT / 2 - ((minY + maxY) / 2) * scale,
			scale,
		});
	};
	const focusNode = (path: string | null) => {
		if (!path) return resetCamera();
		const point = viewPoints.get(path);
		if (!point) return;
		const scale = Math.max(1.15, camera.scale);
		setCamera({ x: WIDTH / 2 - point.x * scale, y: HEIGHT / 2 - point.y * scale, scale });
	};
	const onCanvasWheel = (event: React.WheelEvent<SVGSVGElement>) => {
		const rect = event.currentTarget.getBoundingClientRect();
		const anchor = {
			x: ((event.clientX - rect.left) / rect.width) * WIDTH,
			y: ((event.clientY - rect.top) / rect.height) * HEIGHT,
		};
		const factor = event.deltaY > 0 ? 0.88 : 1.14;
		setCamera((current) => {
			const scale = clampZoom(current.scale * factor);
			const worldX = (anchor.x - current.x) / current.scale;
			const worldY = (anchor.y - current.y) / current.scale;
			return { x: anchor.x - worldX * scale, y: anchor.y - worldY * scale, scale };
		});
	};
	const onCanvasPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
		if (event.button !== 0) return;
		dragRef.current = { x: event.clientX, y: event.clientY, camera };
		event.currentTarget.setPointerCapture(event.pointerId);
	};
	const onCanvasPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
		const drag = dragRef.current;
		if (!drag) return;
		const rect = event.currentTarget.getBoundingClientRect();
		const dx = ((event.clientX - drag.x) / rect.width) * WIDTH;
		const dy = ((event.clientY - drag.y) / rect.height) * HEIGHT;
		// SVG translation is expressed in viewBox units. Do not divide by zoom:
		// doing so makes a zoomed graph pan too far and causes extra React work.
		pendingCameraRef.current = { ...drag.camera, x: drag.camera.x + dx, y: drag.camera.y + dy };
		if (dragFrameRef.current !== null) return;
		dragFrameRef.current = requestAnimationFrame(() => {
			dragFrameRef.current = null;
			if (pendingCameraRef.current) setCamera(pendingCameraRef.current);
		});
	};
	const onCanvasPointerUp = (event: React.PointerEvent<SVGSVGElement>) => {
		dragRef.current = null;
		if (event.currentTarget.hasPointerCapture(event.pointerId))
			event.currentTarget.releasePointerCapture(event.pointerId);
	};
	// biome-ignore lint/correctness/useExhaustiveDependencies: keyboard shortcuts intentionally bind the current camera and selection
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement | null;
			if (
				event.defaultPrevented ||
				event.ctrlKey ||
				event.metaKey ||
				event.altKey ||
				!rootRef.current?.contains(target)
			)
				return;
			if (
				target?.tagName === "INPUT" ||
				target?.tagName === "TEXTAREA" ||
				target?.tagName === "SELECT" ||
				target?.isContentEditable
			)
				return;
			if (event.key === "+" || event.key === "=") {
				event.preventDefault();
				zoomBy(1.14);
			} else if (event.key === "-") {
				event.preventDefault();
				zoomBy(0.88);
			} else if (event.key === "0") {
				event.preventDefault();
				resetCamera();
			} else if (event.key.toLowerCase() === "f") {
				event.preventDefault();
				focusNode(selected);
			} else if (event.key === "Escape") {
				event.preventDefault();
				if (selected) event.stopImmediatePropagation();
				setSelected(null);
			}
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [camera, points, selected]);

	if (error)
		return (
			<p className="knowledge-state-card knowledge-state-card--error rounded-lg border p-3 text-xs text-err">
				{error}
			</p>
		);
	if (!data || !graph)
		return (
			<p className="knowledge-state-card rounded-lg border p-3 text-[11px] text-ink-faint">{t("loading")}</p>
		);
	if (nodes.length === 0)
		return (
			<p className="knowledge-state-card rounded-lg border p-4 text-[11px] text-ink-faint">
				{t("graphEmpty")}
			</p>
		);

	return (
		<div
			ref={rootRef}
			data-testid="knowledge-graph"
			className="knowledge-observatory space-y-3"
			aria-describedby="knowledge-graph-summary knowledge-graph-keyboard-help"
		>
			<header className="knowledge-network-header" data-testid="knowledge-network-header">
				{/* The page header already says 知识库; the usage hint lives under the canvas. */}
				<h3 className="sr-only">{t("graphTitle")}</h3>
				<div className="knowledge-network-stats">
					<span>
						<strong>{nodes.length}</strong> {t("graphLegendNote")}
					</span>
					<span>
						<strong>{edges.length}</strong> {t("graphLinks").replace("{count}", "")}
					</span>
					<span>
						<strong>{isolated}</strong> {t("graphHealthIsolated").replace("{count}", "")}
					</span>
				</div>
			</header>
			<div className="knowledge-graph-toolbar flex flex-wrap items-center gap-2">
				<Button size="sm" aria-pressed={view === "semantic"} onClick={() => setView("semantic")}>
					{t("graphSemantic")}
				</Button>
				<Button size="sm" aria-pressed={view === "all"} onClick={() => setView("all")}>
					{t("graphAllFiles")}
				</Button>
				<label className="ml-1 flex items-center gap-1 text-xs text-ink-dim">
					<input
						type="checkbox"
						checked={mergeMirrors}
						onChange={(event) => setMergeMirrors(event.target.checked)}
					/>
					{t("graphMergeMirrors")}
				</label>
				<span className="ml-auto flex gap-1">
					{(["all", "link", "directory"] as const).map((filter) => (
						<Button
							key={filter}
							size="sm"
							aria-pressed={relationFilter === filter}
							onClick={() => setRelationFilter(filter)}
						>
							{filter === "all"
								? t("graphRelationAll")
								: filter === "link"
									? t("graphRelationLinks")
									: t("graphRelationDirectory")}
						</Button>
					))}
				</span>
			</div>
			<div
				className="knowledge-graph-toolbar flex flex-wrap items-center gap-2"
				data-testid="knowledge-graph-modes"
			>
				<span className="flex gap-1">
					<Button size="sm" aria-pressed={colorMode === "cluster"} onClick={() => setColorMode("cluster")}>
						{t("graphColorCluster")}
					</Button>
					<Button size="sm" aria-pressed={colorMode === "type"} onClick={() => setColorMode("type")}>
						{t("graphColorType")}
					</Button>
				</span>
				<span className="flex gap-1">
					<Button size="sm" aria-pressed={scope === "global"} onClick={() => setScope("global")}>
						{t("graphScopeGlobal")}
					</Button>
					<Button size="sm" aria-pressed={scope === "local"} onClick={() => setScope("local")}>
						{t("graphScopeLocal")}
					</Button>
					{scope === "local" &&
						([1, 2] as const).map((count) => (
							<Button key={count} size="sm" aria-pressed={hops === count} onClick={() => setHops(count)}>
								{t("graphHopCount").replace("{count}", String(count))}
							</Button>
						))}
				</span>
				<Button
					size="sm"
					aria-pressed={healthOn}
					data-testid="knowledge-graph-health-toggle"
					onClick={() => setHealthOn((value) => !value)}
				>
					{t("graphHealth")}
					{findings.length ? ` · ${findings.length}` : ""}
				</Button>
				{scope === "local" && !selected && (
					<span className="text-[11px] text-ink-faint">{t("graphLocalHint")}</span>
				)}
			</div>
			<div className="flex flex-wrap items-center gap-1 text-[11px] text-ink-faint">
				<span className="mr-1 uppercase tracking-[0.12em]">{t("graphCategory")}</span>
				{([...new Set(nodes.map(categoryOf))] as GraphCategory[]).map((category) => (
					<button
						key={category}
						type="button"
						className={`knowledge-graph-category-filter ${categoryFilter === category ? "is-active" : ""}`}
						aria-pressed={categoryFilter === category}
						onClick={() => setCategoryFilter((current) => (current === category ? null : category))}
					>
						<i style={{ backgroundColor: CATEGORY_COLORS[category] }} />
						{categoryLabels[category]}
					</button>
				))}
			</div>
			<div className="flex flex-wrap gap-1 text-[11px] text-ink-faint">
				<span id="knowledge-graph-summary" className="rounded-full border border-border px-2 py-0.5">
					{t("graphSummary")
						.replace("{nodes}", String(nodes.length))
						.replace("{edges}", String(edges.length))
						.replace("{total}", String(graph.totalNotes))
						.replace("{limit}", String(GRAPH_LIMIT))}
				</span>
				<span className="rounded-full border border-border px-2 py-0.5">
					{t("graphHealthIsolated").replace("{count}", String(isolated))}
				</span>
				<span className="rounded-full border border-border px-2 py-0.5">
					{t("graphHealthDuplicates").replace("{count}", String(duplicates))}
				</span>
			</div>
			<p id="knowledge-graph-keyboard-help" className="sr-only">
				{t("graphKeyboardHelp")}
			</p>
			<div className="relative">
				<div className="knowledge-observatory-canvas relative overflow-hidden rounded-xl">
					<div className="knowledge-graph-canvas-tools absolute inset-3 z-10">
						<button
							type="button"
							className="knowledge-graph-live-toggle absolute right-0 top-0 flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs"
							aria-pressed={paused}
							title={t("graphLiveToggle")}
							data-testid="knowledge-graph-live-toggle"
							onClick={togglePaused}
						>
							<span
								aria-hidden="true"
								className={`knowledge-graph-live-dot${paused ? " knowledge-graph-live-dot--paused" : ""}`}
							/>
							{paused ? t("graphPaused").replace("{count}", String(pendingEvents)) : t("graphLive")}
						</button>
						<div className="knowledge-graph-controls absolute bottom-0 right-0 flex items-center gap-1 rounded-lg p-1">
							<button
								type="button"
								className="knowledge-graph-zoom-button"
								onClick={() => zoomBy(1.14)}
								title={`${t("graphZoomIn")} (+)`}
							>
								<span aria-hidden="true">＋</span>
								<span className="sr-only">{t("graphZoomIn")}</span>
							</button>
							<span className="knowledge-graph-zoom-value" aria-live="polite">
								{Math.round(camera.scale * 100)}%
							</span>
							<button
								type="button"
								className="knowledge-graph-zoom-button"
								onClick={() => zoomBy(0.88)}
								title={`${t("graphZoomOut")} (-)`}
							>
								<span aria-hidden="true">－</span>
								<span className="sr-only">{t("graphZoomOut")}</span>
							</button>
							<button
								type="button"
								className="knowledge-graph-zoom-button px-2"
								onClick={resetCamera}
								title={t("graphResetView")}
							>
								<span aria-hidden="true">⌂</span>
								<span className="sr-only">{t("graphResetView")}</span>
							</button>
							<button
								type="button"
								className="knowledge-graph-fit-button"
								onClick={fitCamera}
								title={t("graphFit")}
							>
								{t("graphFit")}
							</button>
						</div>
					</div>
					<svg
						viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
						className="knowledge-graph-svg h-[clamp(520px,68vh,760px)] w-full touch-none select-none"
						aria-labelledby="knowledge-graph-title"
						aria-describedby="knowledge-graph-summary knowledge-graph-keyboard-help"
						aria-keyshortcuts="+ - 0 F Escape"
						onWheel={onCanvasWheel}
						onPointerDown={onCanvasPointerDown}
						onPointerMove={onCanvasPointerMove}
						onPointerUp={onCanvasPointerUp}
						onPointerCancel={onCanvasPointerUp}
					>
						<title id="knowledge-graph-title">{t("graphTitle")}</title>
						<defs>
							<pattern id="knowledge-grid" width="32" height="32" patternUnits="userSpaceOnUse">
								<path
									d="M 32 0 L 0 0 0 32"
									fill="none"
									stroke="var(--knowledge-grid)"
									strokeOpacity=".8"
									strokeWidth="1"
								/>
							</pattern>
							<radialGradient id="knowledge-glow">
								<stop offset="0" stopColor="var(--knowledge-accent)" stopOpacity=".2" />
								<stop offset="1" stopColor="var(--knowledge-canvas)" stopOpacity="0" />
							</radialGradient>
						</defs>
						<rect width={WIDTH} height={HEIGHT} fill="url(#knowledge-grid)" />
						<ellipse cx={WIDTH / 2} cy={HEIGHT / 2} rx="300" ry="210" fill="url(#knowledge-glow)" />
						<g
							className="knowledge-graph-scene"
							transform={`translate(${camera.x} ${camera.y}) scale(${camera.scale})`}
						>
							{viewNodes
								.filter((node) => node.isMain)
								.map((node) => {
									const point = viewPoints.get(node.path);
									if (!point) return null;
									return (
										<circle
											key={`main-orbit-${node.path}`}
											cx={point.x}
											cy={point.y}
											r="40"
											fill="none"
											stroke={nodeColor(node)}
											strokeOpacity=".18"
											strokeDasharray="2 7"
										/>
									);
								})}
							<g>
								{visibleEdges.map((edge) => {
									const a = viewPoints.get(edge.source),
										b = viewPoints.get(edge.target);
									if (!a || !b) return null;
									const categoryOn =
										!categoryFilter ||
										categoryOf(
											nodeByPath.get(edge.source) ?? ({ kind: "note" } as GraphData["nodes"][number]),
										) === categoryFilter ||
										categoryOf(
											nodeByPath.get(edge.target) ?? ({ kind: "note" } as GraphData["nodes"][number]),
										) === categoryFilter;
									const on = categoryOn && (!active || (active.has(edge.source) && active.has(edge.target)));
									const fresh = freshPaths.has(edge.source) || freshPaths.has(edge.target);
									return (
										<line
											key={`${edge.source}|${edge.target}|${edge.type}`}
											className={`knowledge-graph-edge${on && focusPath ? " knowledge-graph-edge--active" : ""}${fresh ? " knowledge-graph-edge--fresh" : ""}`}
											x1={a.x}
											y1={a.y}
											x2={b.x}
											y2={b.y}
											stroke={
												fresh
													? LIVE_COLOR
													: edge.type === "directory"
														? "var(--knowledge-directory)"
														: "var(--knowledge-edge)"
											}
											strokeOpacity={on ? (edge.type === "directory" ? 0.6 : 0.5) : categoryOn ? 0.08 : 0.025}
											strokeWidth={fresh ? 2 : edge.type === "directory" ? 1 : 1.4}
											strokeDasharray={edge.type === "directory" ? "4 4" : undefined}
										/>
									);
								})}
							</g>
							{viewNodes.map((node) => {
								const point = viewPoints.get(node.path);
								if (!point) return null;
								const categoryOn = !categoryFilter || categoryOf(node) === categoryFilter;
								const nodeFindings = healthOn ? findingsByPath.get(node.path) : undefined;
								const healthDim = healthOn && !nodeFindings && !(active?.has(node.path) ?? false);
								const on = categoryOn && (!active || active.has(node.path)) && !healthDim;
								const fresh = freshPaths.has(node.path);
								const radius = radiusOf(node);
								const shape = shapeFor(categoryOf(node));
								const placement = labels.get(node.path);
								const showLabel = Boolean(placement);
								const showMetadata = camera.scale >= 1.15 || selected === node.path || hovered === node.path;
								return (
									// biome-ignore lint/a11y/useSemanticElements: SVG nodes do not support native button elements
									<g
										key={node.path}
										role="button"
										tabIndex={0}
										aria-label={`${node.title} · ${categoryLabels[categoryOf(node)]} · ${t("graphLinks").replace("{count}", String(node.degree))}`}
										aria-pressed={selected === node.path}
										aria-keyshortcuts="Enter Space"
										opacity={on ? 1 : healthDim ? 0.28 : categoryOn ? 0.2 : 0.14}
										style={{ cursor: "pointer" }}
										onClick={() => setSelected(node.path)}
										onMouseEnter={() => setHovered(node.path)}
										onMouseLeave={() => setHovered(null)}
										onPointerDown={(event) => event.stopPropagation()}
										onFocus={() => setSelected(node.path)}
										onKeyDown={(event) => {
											if (event.key === "Enter" || event.key === " ") {
												event.preventDefault();
												setSelected(node.path);
											}
										}}
									>
										<title>{`${node.title}\n${node.path}`}</title>
										{selected === node.path && (
											<circle
												className="knowledge-graph-selection-halo"
												cx={point.x}
												cy={point.y}
												r={radius + 8}
												fill="none"
												stroke="var(--knowledge-accent)"
												strokeOpacity=".35"
												strokeDasharray="2 3"
											/>
										)}
										<circle
											className={`knowledge-graph-node-aura${fresh ? " knowledge-graph-node-aura--fresh" : ""}`}
											cx={point.x}
											cy={point.y}
											r={radius + 5}
											fill={fillOf(node)}
											fillOpacity=".1"
										/>
										{nodeFindings?.map((kind, index) => (
											<circle
												key={`health-${kind}`}
												className="knowledge-graph-health-ring"
												cx={point.x}
												cy={point.y}
												r={radius + 4 + index * 3}
												fill="none"
												stroke={HEALTH_COLORS[kind]}
												strokeWidth="1.6"
												strokeDasharray={kind === "warning" ? undefined : kind === "orphan" ? "2 2" : "5 3"}
											/>
										))}
										{node.isMain && (
											<circle
												cx={point.x}
												cy={point.y}
												r={radius + 6}
												fill="none"
												stroke={nodeColor(node)}
												strokeOpacity=".78"
												strokeWidth="1.5"
												strokeDasharray="7 4"
											/>
										)}
										{(node.sharedWith?.length ?? 0) > 1 && (
											<circle
												cx={point.x}
												cy={point.y}
												r={radius + 4}
												fill="none"
												stroke="var(--knowledge-edge)"
												strokeOpacity=".45"
												strokeWidth="1"
												strokeDasharray="2 3"
											/>
										)}
										<NodeMark
											shape={shape}
											x={point.x}
											y={point.y}
											r={radius}
											fill={fillOf(node)}
											stroke="var(--knowledge-surface)"
											strokeWidth="2"
										/>
										{showLabel && placement && (
											<>
												<rect
													x={placement.anchor === "end" ? placement.x - placement.width - 4 : placement.x - 4}
													y={placement.y - 11}
													width={placement.width + 8}
													height={showMetadata ? 27 : 16}
													rx="4"
													fill="var(--knowledge-surface)"
													fillOpacity=".82"
													stroke="var(--knowledge-border)"
													strokeOpacity=".7"
												/>
												<text
													x={placement.x}
													y={placement.y}
													textAnchor={placement.anchor}
													fontSize="10"
													fill="var(--knowledge-ink)"
												>
													<tspan>{labelText(node)}</tspan>
													{showMetadata && (
														<tspan x={placement.x} dy="12" fontSize="8" fill="var(--knowledge-ink-muted)">
															{t("graphInDegree").replace("{count}", String(incoming.get(node.path) ?? 0))} ·{" "}
															{categoryLabels[categoryOf(node)]}
														</tspan>
													)}
												</text>
											</>
										)}
									</g>
								);
							})}
						</g>
					</svg>
					<div className="sr-only" aria-live="polite" aria-atomic="true">
						{selectedNode ? `${selectedNode.title} · ${selectedNode.path}` : ""}
					</div>
					<div className="knowledge-graph-legend absolute bottom-2 left-3 flex max-w-[calc(100%-24px)] flex-wrap gap-x-3 gap-y-1 rounded-md px-2 py-2 text-xs">
						{colorMode === "cluster" && (
							<>
								{[...clusterHeads.entries()]
									.sort((a, b) => a[0] - b[0])
									.slice(0, 6)
									.map(([cluster, head]) => (
										<span key={`legend-cluster-${cluster}`} title={head.title}>
											<i
												className="mr-1 inline-block h-2 w-2 rounded-full"
												style={{
													backgroundColor: clusterColor(cluster, clusterSizes.get(cluster) ?? 0),
												}}
											/>
											{labelText(head)}
										</span>
									))}
								<span>{t("graphLegendShapes")}</span>
							</>
						)}
						{colorMode === "type" &&
							([...new Set(nodes.map(categoryOf))] as GraphCategory[]).map((category) => (
								<span key={`legend-${category}`}>
									<i
										className="mr-1 inline-block h-2 w-2 rounded-full"
										style={{ backgroundColor: CATEGORY_COLORS[category] }}
									/>
									{categoryLabels[category]}
								</span>
							))}
						<span>
							<i className="knowledge-graph-legend-main mr-1 inline-block h-2 w-2 rounded-full border" />
							{t("graphLegendMain")}
						</span>
						<span>
							<i className="mr-1 inline-block h-2 w-2 rounded-full border border-[var(--knowledge-edge)] border-dashed" />
							{t("graphLegendShared")}
						</span>
						<span>
							<i className="mr-1 inline-block h-[1px] w-3 align-middle bg-[var(--knowledge-edge)]" />
							{t("graphLegendDirect")}
						</span>
						<span>
							<i className="knowledge-graph-legend-directory mr-1 inline-block w-3 border-t border-dashed align-middle" />
							{t("graphLegendDirectory")}
						</span>
					</div>
				</div>
				<aside
					className={`knowledge-node-drawer absolute right-3 top-16 bottom-12 z-20 w-[min(360px,calc(100%-24px))] overflow-y-auto rounded-xl p-4 transition duration-200 ${selectedNode || healthOn ? "is-open" : ""}`}
					aria-label={selectedNode || !healthOn ? t("graphNodeCard") : t("graphHealth")}
					aria-hidden={!selectedNode && !healthOn}
				>
					{selectedNode ? (
						<>
							<button
								type="button"
								className="absolute right-3 top-3 rounded-md px-2 py-1 text-xs text-ink-faint hover:bg-hover hover:text-ink"
								onClick={() => setSelected(null)}
								aria-label={t("graphDrawerClose")}
								title={t("graphDrawerClose")}
							>
								×
							</button>
							<p className="text-[11px] uppercase tracking-[0.12em] text-ink-faint">
								{t("graphSelectedNode")}
							</p>
							<h4 className="mt-1 truncate text-xs font-semibold">{selectedNode.title}</h4>
							<p className="mt-1 break-all font-mono text-[11px] text-ink-faint">{selectedNode.path}</p>
							<div className="mt-2 flex flex-wrap gap-1">
								<span className="rounded border border-border px-2 py-0.5 text-xs text-ink-dim">
									{categoryLabels[categoryOf(selectedNode)]}
								</span>
								<span className="rounded border border-border px-2 py-0.5 text-xs text-ink-dim">
									{t("graphLinks").replace("{count}", String(selectedNode.degree))}
								</span>
								<span className="rounded border border-border px-2 py-0.5 text-xs text-ink-dim">
									{t("graphInDegree").replace("{count}", String(incoming.get(selectedNode.path) ?? 0))}
								</span>
								{(clusterSizes.get(clusters.get(selectedNode.path) ?? 0) ?? 0) > 1 && (
									<span className="flex items-center gap-1 rounded border border-border px-2 py-0.5 text-xs text-ink-dim">
										<i
											className="inline-block h-2 w-2 rounded-full"
											style={{
												backgroundColor: clusterColor(
													clusters.get(selectedNode.path) ?? 0,
													clusterSizes.get(clusters.get(selectedNode.path) ?? 0) ?? 0,
												),
											}}
										/>
										{t("graphCluster").replace("{count}", String((clusters.get(selectedNode.path) ?? 0) + 1))}
									</span>
								)}
							</div>
							{(findingsByPath.get(selectedNode.path) ?? []).map((kind) => (
								<div
									key={`finding-${kind}`}
									className="mt-3 rounded border border-border px-2 py-2 text-xs"
									style={{ borderColor: HEALTH_COLORS[kind] }}
								>
									<p className="font-semibold" style={{ color: HEALTH_COLORS[kind] }}>
										{t(HEALTH_COPY[kind].label)}
									</p>
									<p className="mt-1 text-ink-dim">{t(HEALTH_COPY[kind].hint)}</p>
									<Button
										className="mt-2"
										size="sm"
										variant="primary"
										onClick={() => handOff(selectedNode.path, kind)}
									>
										{t("handOff")}
									</Button>
								</div>
							))}
							<dl className="mt-3 space-y-2 text-xs text-ink-dim">
								<div className="flex justify-between">
									<dt>{t("graphOutgoing")}</dt>
									<dd>{links?.outgoing.length ?? 0}</dd>
								</div>
								<div className="flex justify-between">
									<dt>{t("graphIncoming")}</dt>
									<dd>{links?.incoming.length ?? 0}</dd>
								</div>
								<div className="flex justify-between">
									<dt>{t("graphHops")}</dt>
									<dd>{neighbours.get(selected ?? "")?.size ? 1 : 0}</dd>
								</div>
							</dl>
							{selectedNode.warnings?.length || selectedNode.mirrors?.length ? (
								<p className="mt-3 rounded bg-hover px-2 py-2 text-xs text-warn">
									{t("graphMirrorWarning").replace("{count}", String(selectedNode.mirrors?.length ?? 0))}
								</p>
							) : null}
							{links && (
								<div className="mt-3 border-t border-border pt-2">
									<p className="text-xs font-semibold text-ink-dim">{t("graphRelatedNotes")}</p>
									{[...links.outgoing, ...links.incoming].slice(0, 4).map((link) => (
										<button
											key={`${link.path}-${link.exists}`}
											type="button"
											className="mt-1 block w-full truncate text-left text-[11px] text-ink-faint hover:text-ink"
											onClick={() => setSelected(link.path)}
										>
											{link.exists ? "↗" : "＋"} {link.title}
										</button>
									))}
								</div>
							)}
							<Button
								className="mt-3 w-full"
								size="sm"
								onClick={() => openKnowledgeNote(cwd, selectedNode.path, revision)}
							>
								{t("graphOpenNote")}
							</Button>
						</>
					) : healthOn ? (
						<div data-testid="knowledge-graph-health-list">
							<button
								type="button"
								className="absolute right-3 top-3 rounded-md px-2 py-1 text-xs text-ink-faint hover:bg-hover hover:text-ink"
								onClick={() => setHealthOn(false)}
								aria-label={t("graphDrawerClose")}
								title={t("graphDrawerClose")}
							>
								×
							</button>
							<p className="text-[11px] uppercase tracking-[0.12em] text-ink-faint">{t("graphHealth")}</p>
							<p className="mt-1 text-[11px] leading-relaxed text-ink-faint">{t("graphHealthIntro")}</p>
							{findings.length === 0 && <p className="mt-3 text-xs text-ink-dim">{t("graphHealthEmpty")}</p>}
							{HEALTH_ORDER.map((kind) => {
								const rows = findings.filter((finding) => finding.kind === kind);
								if (rows.length === 0) return null;
								return (
									<section key={`health-${kind}`} className="mt-3 border-t border-border pt-2">
										<p className="flex items-center gap-1.5 text-xs font-semibold text-ink-dim">
											<i
												className="inline-block h-2 w-2 rounded-full"
												style={{ backgroundColor: HEALTH_COLORS[kind] }}
											/>
											{t(HEALTH_COPY[kind].label)}
											<span className="font-normal text-ink-faint">{rows.length}</span>
										</p>
										{rows.slice(0, 12).map((finding) => (
											<button
												key={`${kind}-${finding.path}`}
												type="button"
												className="mt-1 block w-full truncate text-left text-[11px] text-ink-faint hover:text-ink"
												title={finding.path}
												onClick={() => {
													setSelected(finding.path);
													focusNode(finding.path);
												}}
											>
												{nodeByPath.get(finding.path)?.title ?? finding.path}
											</button>
										))}
										{rows.length > 12 && (
											<p className="mt-1 text-[11px] text-ink-faint">
												{t("graphMore").replace("{count}", String(rows.length - 12))}
											</p>
										)}
									</section>
								);
							})}
						</div>
					) : (
						<div className="flex h-full min-h-[220px] flex-col justify-between">
							<p className="text-[11px] uppercase tracking-[0.12em] text-ink-faint">
								{t("graphSelectedNode")}
							</p>
							<p className="mt-3 text-[11px] leading-relaxed text-ink-faint">{t("graphSelectHint")}</p>
							<p className="text-[11px] leading-relaxed text-ink-faint">{t("graphCollisionHint")}</p>
						</div>
					)}
				</aside>
			</div>
			<p className="text-[11px] text-ink-faint">
				{t("graphHint")} · {t("graphShortcuts")}
			</p>
		</div>
	);
}
