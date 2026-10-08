import type { KnowledgeGraph as GraphData, KnowledgeNoteLinks } from "@drone/shared";
import { useEffect, useMemo, useState } from "react";
import { getPi } from "../../api";
import { useKnowledgeStore } from "../../stores/knowledge";
import { Button } from "../ui/Button";
import { useKnowledgeText } from "./copy";
import { GRAPH_HEIGHT as HEIGHT, layoutGraph, type Point, GRAPH_WIDTH as WIDTH } from "./graph-layout";
import { openKnowledgeNote } from "./KnowledgeLinks";
import { KnowledgeNebula, supportsWebGL } from "./KnowledgeNebula";

const GRAPH_LIMIT = 400;
type GraphMode = "focus" | "nebula" | "browse";

/** 图上只选择节点；右侧卡片的主按钮才会打开笔记。 */
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
	const nonce = useKnowledgeStore((s) => s.revision);
	const [data, setData] = useState<GraphData | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [selected, setSelected] = useState<string | null>(null);
	const [view, setView] = useState<"semantic" | "all">("semantic");
	const [mergeMirrors, setMergeMirrors] = useState(true);
	const [mode, setMode] = useState<GraphMode>("focus");
	const [webgl] = useState(supportsWebGL);
	const [links, setLinks] = useState<KnowledgeNoteLinks | null>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: nonce/indexKey are index refresh signals
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
	useEffect(() => {
		if (!selected || !(data?.semantic?.nodes ?? data?.nodes).some((node) => node.path === selected)) setSelected(null);
	}, [data, selected]);
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
		const graph = data?.semantic ?? data;
		if (!graph) return new Map<string, Point>();
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
	const neighbours = useMemo(() => {
		const graph = data?.semantic ?? data;
		const map = new Map<string, Set<string>>();
		for (const edge of graph?.relations?.filter((item) => item.type === "link") ?? graph?.edges ?? []) {
			if (!map.has(edge.source)) map.set(edge.source, new Set());
			if (!map.has(edge.target)) map.set(edge.target, new Set());
			map.get(edge.source)?.add(edge.target);
			map.get(edge.target)?.add(edge.source);
		}
		return map;
	}, [data]);
	const active =
		selected && mode === "focus" ? new Set([selected, ...(neighbours.get(selected) ?? [])]) : null;
	const hops = useMemo(() => {
		if (!selected) return 0;
		const seen = new Set([selected]);
		let frontier = [selected];
		for (let depth = 1; depth <= 3; depth++) {
			const next = frontier
				.flatMap((path) => [...(neighbours.get(path) ?? [])])
				.filter((path) => !seen.has(path));
			if (!next.length) return depth - 1;
			next.forEach((path) => {
				seen.add(path);
			});
			frontier = next;
		}
		return 3;
	}, [selected, neighbours]);
	if (error) return <p className="text-[11px] text-err">{error}</p>;
	if (!data) return <p className="text-[11px] text-ink-faint">{t("loading")}</p>;
	const graph = data.semantic ?? data;
	if (graph.nodes.length === 0) return <p className="text-[11px] text-ink-faint">{t("graphEmpty")}</p>;
	const labelled = new Set(
		[...graph.nodes]
			.sort((a, b) => b.degree - a.degree || a.path.localeCompare(b.path))
			.slice(0, 18)
			.map((node) => node.path),
	);
	const nodeByPath = new Map(graph.nodes.map((node) => [node.path, node]));
	const summary = t("graphSummary")
		.replace("{nodes}", String(graph.nodes.length))
		.replace("{edges}", String(graph.edges.length))
		.replace("{total}", String(graph.totalNotes))
		.replace("{limit}", String(GRAPH_LIMIT));
	return (
		<div data-testid="knowledge-graph" className="space-y-2">
			<div className="flex flex-wrap items-center gap-1.5">
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
					<Button size="sm" aria-pressed={mode === "focus"} onClick={() => setMode("focus")}>
						{t("graphFocus")}
					</Button>
					{webgl && (
						<Button size="sm" aria-pressed={mode === "nebula"} onClick={() => setMode("nebula")}>
							{t("graphNebula")}
						</Button>
					)}
					<Button size="sm" aria-pressed={mode === "browse"} onClick={() => setMode("browse")}>
						{t("graphBrowse")}
					</Button>
				</span>
			</div>
			<div className="flex flex-wrap gap-1 text-[11px] text-ink-faint">
				<span className="rounded-full border border-border px-2 py-0.5">{summary}</span>
				<span className="rounded-full border border-border px-2 py-0.5">
					{t("graphHealthIsolated").replace(
						"{count}",
										String(graph.health?.isolated ?? graph.nodes.filter((node) => node.degree === 0).length),
					)}
				</span>
				<span className="rounded-full border border-border px-2 py-0.5">
					{t("graphHealthDuplicates").replace(
						"{count}",
										String(graph.health?.duplicates ?? graph.duplicates?.length ?? 0),
					)}
				</span>
			</div>
			<div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_240px]">
				{mode === "nebula" && webgl ? (
						<KnowledgeNebula
								data={graph}
						onSelect={setSelected}
						labels={{ reset: t("graphReset"), relayout: t("graphRelayout") }}
					/>
				) : (
					<svg
						viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
						className="h-auto w-full rounded-xl border border-border bg-hover/40"
						role="img"
						aria-label={t("graphTitle")}
					>
						<g className="text-ink-faint">
							{(graph.relations?.filter((item) => item.type !== "duplicate") ?? graph.edges).map((edge) => {
								const a = points.get(edge.source),
									b = points.get(edge.target);
								if (!a || !b) return null;
								const on = !active || (active.has(edge.source) && active.has(edge.target));
								return (
									<line
										key={`${edge.source}|${edge.target}|{"type" in edge ? edge.type : "link"}`}
										x1={a.x}
										y1={a.y}
										x2={b.x}
										y2={b.y}
										stroke="currentColor"
										strokeOpacity={on ? 0.55 : 0.08}
										strokeWidth={"type" in edge && edge.type === "directory" ? 0.7 : 1}
										strokeDasharray={"type" in edge && edge.type === "directory" ? "3 3" : undefined}
									/>
								);
							})}
						</g>
						{graph.nodes.map((node) => {
							const p = points.get(node.path);
							if (!p) return null;
							const on = !active || active.has(node.path);
							const r = 3 + Math.min(7, Math.sqrt(node.degree) * 1.6);
							const fill =
								node.nodeType === "wiki"
									? "#5e8cff"
									: node.nodeType === "mirror"
										? "#c88cff"
										: node.isInfrastructure
											? "#9ca3af"
											: "#36c7a4";
							return (
								// biome-ignore lint/a11y/useSemanticElements: SVG nodes do not support native buttons
								<g
									key={node.path}
									role="button"
									tabIndex={0}
									aria-label={node.title}
									opacity={on ? 1 : 0.22}
									style={{ cursor: "pointer" }}
									onClick={() => setSelected(node.path)}
									onFocus={() => setSelected(node.path)}
									onKeyDown={(event) => {
										if (event.key === "Enter" || event.key === " ") setSelected(node.path);
									}}
								>
									<title>{`${node.title}\n${node.path}`}</title>
									<circle
										cx={p.x}
										cy={p.y}
										r={r}
										fill={fill}
										stroke={selected === node.path ? "#fff" : "none"}
										strokeWidth={2}
									/>
									{(labelled.has(node.path) || selected === node.path) && (
										<text x={p.x + r + 3} y={p.y + 3} fontSize={10} fill="currentColor">
											{node.title.length > 24 ? `${node.title.slice(0, 23)}…` : node.title}
										</text>
									)}
								</g>
							);
						})}
					</svg>
				)}
				<aside className="rounded-xl border border-border bg-surface p-3" aria-label={t("graphNodeCard")}>
					{selected && nodeByPath.get(selected) ? (
						(() => {
							const node = nodeByPath.get(selected);
							if (!node) return null;
							return (
								<>
									<h4 className="truncate text-xs font-semibold">{node.title}</h4>
									<p className="mt-1 break-all font-mono text-[10px] text-ink-faint">{node.path}</p>
									<dl className="mt-2 space-y-1 text-[11px] text-ink-dim">
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
											<dd>{hops}</dd>
										</div>
									</dl>
									{(node.warnings?.length || node.mirrors?.length) && (
										<p className="mt-2 rounded bg-hover px-2 py-1 text-[11px] text-warn">
											{t("graphMirrorWarning").replace("{count}", String(node.mirrors?.length ?? 0))}
										</p>
									)}
									<Button
										className="mt-3 w-full"
										size="sm"
										onClick={() => openKnowledgeNote(cwd, node.path, revision)}
									>
										{t("graphOpenNote")}
									</Button>
								</>
							);
						})()
					) : (
						<p className="text-[11px] text-ink-faint">{t("graphSelectHint")}</p>
					)}
				</aside>
			</div>
			<div className="flex flex-wrap items-center gap-3 text-[11px] text-ink-faint">
				<span>
					<i className="mr-1 inline-block h-2 w-2 rounded-full bg-[#36c7a4]" />
					{t("graphLegendNote")}
				</span>
				<span>
					<i className="mr-1 inline-block h-2 w-2 rounded-full bg-[#5e8cff]" />
					Wiki
				</span>
				<span>
					<i className="mr-1 inline-block h-2 w-2 rounded-full bg-[#c88cff]" />
					{t("graphLegendMirror")}
				</span>
				<span>{t("graphHint")}</span>
			</div>
		</div>
	);
}
