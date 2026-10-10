import type { KnowledgeGraph as GraphData, KnowledgeNoteLinks } from "@drone/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { getPi } from "../../api";
import { useI18nStore } from "../../i18n";
import { useKnowledgeStore } from "../../stores/knowledge";
import { Button } from "../ui/Button";
import { useKnowledgeText } from "./copy";
import {
	GRAPH_HEIGHT as HEIGHT,
	type LabelPlacement,
	layoutGraph,
	type Point,
	placeGraphLabels,
	GRAPH_WIDTH as WIDTH,
} from "./graph-layout";
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
const CATEGORY_COLORS: Record<GraphCategory, string> = {
	paper: "#f2b880",
	method: "#79d5b1",
	software: "#8ca8ff",
	dataset: "#7fc5e5",
	concept: "#c58ee8",
	entity: "#e4a0b5",
	idea: "#f08cae",
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
	const dragRef = useRef<{ x: number; y: number; camera: Camera } | null>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: nonce and indexKey are knowledge index refresh signals
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
	}, [revision, nonce, indexKey, view, mergeMirrors]);

	const nodes = useMemo(() => (data ? graphNodes(data) : []), [data]);
	const edges = useMemo(() => (data ? graphEdges(data) : []), [data]);
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

	const points = useMemo(() => {
		if (!data) return new Map<string, Point>();
		const graph = data.semantic ?? data;
		if (graph.layout)
			return new Map(Object.entries(graph.layout).map(([path, point]) => [path, { ...point, vx: 0, vy: 0 }]));
		if (graph.nodes.some((node) => node.x !== undefined && node.y !== undefined))
			return new Map(
				graph.nodes.map((node) => [
					node.path,
					{ x: node.x ?? WIDTH / 2, y: node.y ?? HEIGHT / 2, vx: 0, vy: 0 },
				]),
			);
		return layoutGraph(graph);
	}, [data]);
	const labelled = useMemo(
		() =>
			new Set(
				[...nodes]
					.sort((a, b) => b.degree - a.degree || a.path.localeCompare(b.path))
					.slice(0, 6)
					.concat(nodes.filter((node) => node.isMain || (node.sharedWith?.length ?? 0) > 1))
					.map((node) => node.path),
			),
		[nodes],
	);
	const labels = useMemo(
		() =>
			data
				? placeGraphLabels({ nodes }, points, labelled, selected, { uniformOrientation: true })
				: new Map<string, LabelPlacement>(),
		[data, nodes, points, labelled, selected],
	);
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
	const visibleEdges = edges.filter((edge) => relationFilter === "all" || edge.type === relationFilter);
	const nodeByPath = new Map(nodes.map((node) => [node.path, node]));
	const selectedNode = selected ? nodeByPath.get(selected) : undefined;
	const graph = data?.semantic ?? data;
	const isolated = graph?.health?.isolated ?? nodes.filter((node) => node.degree === 0).length;
	const duplicates = graph?.health?.duplicates ?? graph?.duplicates?.length ?? 0;
	const resetCamera = () => setCamera({ x: 0, y: 0, scale: 1 });
	const zoomBy = (factor: number) =>
		setCamera((current) => clampCamera({ ...current, scale: current.scale * factor }));
	const fitCamera = () => {
		if (!points.size) return resetCamera();
		const values = [...points.values()];
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
		const point = points.get(path);
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
		setCamera({
			...drag.camera,
			x: drag.camera.x + dx / drag.camera.scale,
			y: drag.camera.y + dy / drag.camera.scale,
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
			if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable) return;
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

	if (error) return <p className="rounded-lg border border-border p-3 text-[11px] text-err">{error}</p>;
	if (!data || !graph) return <p className="text-[11px] text-ink-faint">{t("loading")}</p>;
	if (nodes.length === 0)
		return (
			<p className="rounded-lg border border-border p-4 text-[11px] text-ink-faint">{t("graphEmpty")}</p>
		);

	return (
		<div data-testid="knowledge-graph" className="knowledge-observatory space-y-3">
			<div className="knowledge-graph-toolbar flex flex-wrap items-center gap-1.5">
				<Button size="sm" aria-pressed={view === "semantic"} onClick={() => setView("semantic")}>
					{t("graphSemantic")}
				</Button>
				<Button size="sm" aria-pressed={view === "all"} onClick={() => setView("all")}>
					{t("graphAllFiles")}
				</Button>
				<label className="ml-1 flex items-center gap-1 text-[11px] text-ink-dim">
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
			<div className="flex flex-wrap items-center gap-1 text-[10px] text-ink-faint">
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
				<span className="rounded-full border border-border px-2 py-0.5">
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
			<div className="relative">
				<div className="knowledge-observatory-canvas relative overflow-hidden rounded-xl">
					<div className="knowledge-graph-canvas-tools absolute left-3 right-3 top-3 z-10 flex items-start justify-between gap-3">
						<span className="knowledge-graph-observatory-label rounded-lg px-3 py-2 text-[11px]">
							{t("graphObservatoryLabel")}
						</span>
						<div className="knowledge-graph-controls flex items-center gap-1 rounded-lg p-1">
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
						<g fill="none" stroke="var(--knowledge-edge)" strokeOpacity=".38" strokeWidth="1">
							<line x1="48" y1={HEIGHT - 54} x2={WIDTH - 22} y2={HEIGHT - 54} />
							<line x1="44" y1={HEIGHT - 50} x2="44" y2="22" />
						</g>
						<g className="knowledge-graph-axis-labels">
							<text x="54" y={HEIGHT - 36}>
								{t("graphAxisRelations")} →
							</text>
							<text x="27" y={HEIGHT - 58} transform={`rotate(-90 27 ${HEIGHT - 58})`}>
								{t("graphAxisConcepts")}
							</text>
						</g>
						<g
							className="knowledge-graph-scene"
							transform={`translate(${camera.x} ${camera.y}) scale(${camera.scale})`}
						>
							{nodes
								.filter((node) => node.isMain)
								.map((node) => {
									const point = points.get(node.path);
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
									const a = points.get(edge.source),
										b = points.get(edge.target);
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
									return (
										<line
											key={`${edge.source}|${edge.target}|${edge.type}`}
											className={
												on && focusPath
													? "knowledge-graph-edge knowledge-graph-edge--active"
													: "knowledge-graph-edge"
											}
											x1={a.x}
											y1={a.y}
											x2={b.x}
											y2={b.y}
											stroke={
												edge.type === "directory" ? "var(--knowledge-directory)" : "var(--knowledge-edge)"
											}
											strokeOpacity={on ? (edge.type === "directory" ? 0.6 : 0.5) : categoryOn ? 0.08 : 0.025}
											strokeWidth={edge.type === "directory" ? 1 : 1.4}
											strokeDasharray={edge.type === "directory" ? "4 4" : undefined}
										/>
									);
								})}
							</g>
							{nodes.map((node) => {
								const point = points.get(node.path);
								if (!point) return null;
								const categoryOn = !categoryFilter || categoryOf(node) === categoryFilter;
								const on = categoryOn && (!active || active.has(node.path));
								const radius = 4 + Math.min(9, Math.sqrt(node.degree) * 1.7) + (node.isMain ? 3 : 0);
								const placement = labels.get(node.path);
								const showLabel = Boolean(
									placement && (camera.scale >= 1.05 || selected === node.path || hovered === node.path),
								);
								const showMetadata = camera.scale >= 1.15 || selected === node.path || hovered === node.path;
								return (
									// biome-ignore lint/a11y/useSemanticElements: SVG nodes do not support native button elements
									<g
										key={node.path}
										role="button"
										tabIndex={0}
										aria-label={node.title}
										opacity={on ? 1 : categoryOn ? 0.2 : 0.06}
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
											className="knowledge-graph-node-aura"
											cx={point.x}
											cy={point.y}
											r={radius + 5}
											fill={nodeColor(node)}
											fillOpacity=".1"
										/>
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
										<circle
											cx={point.x}
											cy={point.y}
											r={radius}
											fill={nodeColor(node)}
											stroke="var(--knowledge-surface)"
											strokeWidth="2"
										/>
										{showLabel && placement && (
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
														{t("graphLinks").replace("{count}", String(node.degree))} ·{" "}
														{categoryLabels[categoryOf(node)]}
													</tspan>
												)}
											</text>
										)}
									</g>
								);
							})}
						</g>
					</svg>
					<div className="knowledge-graph-legend absolute bottom-2 left-3 flex max-w-[calc(100%-24px)] flex-wrap gap-x-3 gap-y-1 rounded-md px-2 py-1.5 text-[10px]">
						{([...new Set(nodes.map(categoryOf))] as GraphCategory[]).map((category) => (
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
					className={`knowledge-node-drawer absolute right-3 top-16 bottom-12 z-20 w-[min(360px,calc(100%-24px))] overflow-y-auto rounded-xl p-4 transition duration-200 ${selectedNode ? "is-open" : ""}`}
					aria-label={t("graphNodeCard")}
					aria-hidden={!selectedNode}
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
							<p className="text-[10px] uppercase tracking-[0.12em] text-ink-faint">
								{t("graphSelectedNode")}
							</p>
							<h4 className="mt-1 truncate text-xs font-semibold">{selectedNode.title}</h4>
							<p className="mt-1 break-all font-mono text-[10px] text-ink-faint">{selectedNode.path}</p>
							<div className="mt-2 flex flex-wrap gap-1">
								<span className="rounded border border-border px-1.5 py-0.5 text-[10px] text-ink-dim">
									{categoryLabels[categoryOf(selectedNode)]}
								</span>
								<span className="rounded border border-border px-1.5 py-0.5 text-[10px] text-ink-dim">
									{t("graphLinks").replace("{count}", String(selectedNode.degree))}
								</span>
							</div>
							<dl className="mt-3 space-y-1.5 text-[11px] text-ink-dim">
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
								<p className="mt-3 rounded bg-hover px-2 py-1.5 text-[11px] text-warn">
									{t("graphMirrorWarning").replace("{count}", String(selectedNode.mirrors?.length ?? 0))}
								</p>
							) : null}
							{links && (
								<div className="mt-3 border-t border-border pt-2">
									<p className="text-[10px] font-semibold text-ink-dim">{t("graphRelatedNotes")}</p>
									{[...links.outgoing, ...links.incoming].slice(0, 4).map((link) => (
										<button
											key={`${link.path}-${link.exists}`}
											type="button"
											className="mt-1 block w-full truncate text-left text-[10px] text-ink-faint hover:text-ink"
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
					) : (
						<div className="flex h-full min-h-[220px] flex-col justify-between">
							<p className="text-[10px] uppercase tracking-[0.12em] text-ink-faint">
								{t("graphSelectedNode")}
							</p>
							<p className="mt-3 text-[11px] leading-relaxed text-ink-faint">{t("graphSelectHint")}</p>
							<p className="text-[10px] leading-relaxed text-ink-faint">{t("graphCollisionHint")}</p>
						</div>
					)}
				</aside>
			</div>
			<p className="text-[10px] text-ink-faint">
				{t("graphHint")} · {t("graphShortcuts")}
			</p>
		</div>
	);
}
