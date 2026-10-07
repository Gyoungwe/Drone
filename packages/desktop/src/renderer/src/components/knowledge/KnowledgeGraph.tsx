import type { KnowledgeGraph as GraphData } from "@drone/shared";
import { useEffect, useMemo, useState } from "react";
import { getPi } from "../../api";
import { useKnowledgeStore } from "../../stores/knowledge";
import { useKnowledgeText } from "./copy";
import { GRAPH_HEIGHT as HEIGHT, layoutGraph, type Point, GRAPH_WIDTH as WIDTH } from "./graph-layout";
import { openKnowledgeNote } from "./KnowledgeLinks";
import { KnowledgeNebula, supportsWebGL } from "./KnowledgeNebula";

const GRAPH_LIMIT = 400;

/** 知识网络：笔记与 [[双链]] 组成的图；点节点打开笔记，悬停高亮其邻居 */
export function KnowledgeGraph({
	cwd,
	revision,
	indexKey = "",
}: {
	cwd: string | null;
	revision: number;
	/** 索引变化标记（笔记数 + 最近对账时间）：变化时重新取图 */
	indexKey?: string;
}) {
	const t = useKnowledgeText();
	const nonce = useKnowledgeStore((s) => s.revision);
	const [data, setData] = useState<GraphData | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [hover, setHover] = useState<string | null>(null);
	const [webgl] = useState(supportsWebGL);
	// biome-ignore lint/correctness/useExhaustiveDependencies: nonce 与 indexKey 是知识库 / 索引变化后的刷新信号
	useEffect(() => {
		let live = true;
		void getPi()
			.getKnowledgeGraph({ revision, limit: GRAPH_LIMIT })
			.then(
				(value) => {
					if (live) setData(value);
				},
				(e) => {
					if (live) setError(String((e as Error).message || e));
				},
			);
		return () => {
			live = false;
		};
	}, [revision, nonce, indexKey]);
	const points = useMemo(() => (data ? layoutGraph(data) : new Map<string, Point>()), [data]);
	const neighbours = useMemo(() => {
		const map = new Map<string, Set<string>>();
		for (const edge of data?.edges ?? []) {
			if (!map.has(edge.source)) map.set(edge.source, new Set());
			if (!map.has(edge.target)) map.set(edge.target, new Set());
			map.get(edge.source)?.add(edge.target);
			map.get(edge.target)?.add(edge.source);
		}
		return map;
	}, [data]);
	if (error) return <p className="text-[11px] text-err">{error}</p>;
	if (!data) return <p className="text-[11px] text-ink-faint">{t("loading")}</p>;
	if (data.nodes.length === 0) return <p className="text-[11px] text-ink-faint">{t("graphEmpty")}</p>;
	const summary = (
		<p className="mb-1 text-[11px] text-ink-faint">
			{t("graphSummary")
				.replace("{nodes}", String(data.nodes.length))
				.replace("{edges}", String(data.edges.length))
				.replace("{total}", String(data.totalNotes))
				.replace("{limit}", String(GRAPH_LIMIT))}
		</p>
	);
	if (webgl)
		return (
			<div data-testid="knowledge-graph">
				{summary}
				<KnowledgeNebula
					data={data}
					onOpen={(path) => openKnowledgeNote(cwd, path, revision)}
					labels={{ reset: t("graphReset"), relayout: t("graphRelayout") }}
				/>
				<p className="mt-1 text-[11px] text-ink-faint">{t("graphNebulaHint")}</p>
			</div>
		);
	const active = hover ? new Set([hover, ...(neighbours.get(hover) ?? [])]) : null;
	const labelled = new Set(
		[...data.nodes]
			.sort((a, b) => b.degree - a.degree)
			.slice(0, 18)
			.map((node) => node.path),
	);
	return (
		<div data-testid="knowledge-graph">
			{summary}
			<svg
				viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
				className="h-auto w-full rounded-xl border border-border bg-hover/40"
				role="img"
				aria-label={t("graphTitle")}
			>
				<g className="text-ink-faint">
					{data.edges.map((edge) => {
						const a = points.get(edge.source);
						const b = points.get(edge.target);
						if (!a || !b) return null;
						const on = !active || (active.has(edge.source) && active.has(edge.target));
						return (
							<line
								key={`${edge.source}|${edge.target}`}
								x1={a.x}
								y1={a.y}
								x2={b.x}
								y2={b.y}
								stroke="currentColor"
								strokeOpacity={on ? 0.55 : 0.08}
								strokeWidth={1}
							/>
						);
					})}
				</g>
				{data.nodes.map((node) => {
					const p = points.get(node.path);
					if (!p) return null;
					const on = !active || active.has(node.path);
					const r = 3 + Math.min(7, Math.sqrt(node.degree) * 1.6);
					return (
						// biome-ignore lint/a11y/useSemanticElements: SVG 节点没有可用的语义按钮元素
						<g
							key={node.path}
							role="button"
							tabIndex={0}
							className={node.kind === "wiki" ? "text-accent" : "text-ink-2"}
							opacity={on ? 1 : 0.25}
							style={{ cursor: "pointer" }}
							onMouseEnter={() => setHover(node.path)}
							onMouseLeave={() => setHover(null)}
							onFocus={() => setHover(node.path)}
							onBlur={() => setHover(null)}
							onClick={() => openKnowledgeNote(cwd, node.path, revision)}
							onKeyDown={(event) => {
								if (event.key === "Enter") openKnowledgeNote(cwd, node.path, revision);
							}}
						>
							<title>{`${node.title}\n${node.path}`}</title>
							<circle cx={p.x} cy={p.y} r={r} fill="currentColor" />
							{(labelled.has(node.path) || hover === node.path) && (
								<text x={p.x + r + 3} y={p.y + 3} fontSize={10} fill="currentColor" className="text-ink">
									{node.title.length > 24 ? `${node.title.slice(0, 23)}…` : node.title}
								</text>
							)}
						</g>
					);
				})}
			</svg>
			<p className="mt-1 text-[11px] text-ink-faint">{t("graphHint")}</p>
		</div>
	);
}
