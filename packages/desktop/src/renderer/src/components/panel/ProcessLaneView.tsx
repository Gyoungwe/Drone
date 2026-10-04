import {
	estimateProcessLayout,
	PROCESS_LANE_EMPTY,
	PROCESS_LANE_LABELS,
	type ProcessLaneState,
	type ProcessNode,
	processNodeLine,
	processWirePath,
	type RunInspectorTurn,
	type TurnTiming,
	type UsageDisplayTotal,
} from "@drone/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { type MessageKey, useI18nStore, useT } from "../../i18n";
import type { ProcessFocus } from "../../stores/ui";
import { RunInspector } from "../chat/RunInspector";

type LaneProps = {
	state: ProcessLaneState;
	inspectors: RunInspectorTurn[];
	timings: (TurnTiming | undefined)[];
	usages: (UsageDisplayTotal | undefined)[];
	processFocus?: ProcessFocus | null;
	onProcessFocusCleared?: () => void;
	onOpenTask?: () => void;
	onOpenReconcile?: () => void;
};

function nodeHeight(node: ProcessNode): number {
	return node.id === "doing" && node.receipts?.length ? 116 : 96;
}

const nodeLabelKeys: Record<ProcessNode["id"], MessageKey> = {
	ask: "panel.processLanes.nodes.ask",
	picked: "panel.processLanes.nodes.picked",
	doing: "panel.processLanes.nodes.doing",
	taskGate: "panel.processLanes.taskGate",
	hostGate: "panel.processLanes.hostGate",
	libGate: "panel.processLanes.nodes.libGate",
	local: "panel.processLanes.nodes.local",
	inspect: "panel.processLanes.nodes.inspect",
	archived: "panel.processLanes.nodes.archived",
	read: "panel.processLanes.nodes.read",
	bound: "panel.processLanes.nodes.bound",
	deposit: "panel.processLanes.nodes.deposit",
	wiki: "panel.processLanes.nodes.wiki",
	zotero: "panel.processLanes.nodes.zotero",
	cited: "panel.processLanes.nodes.cited",
	check: "panel.processLanes.nodes.check",
	answer: "panel.processLanes.nodes.answer",
};

function nodeLabel(node: ProcessNode, t: ReturnType<typeof useT>): string {
	return t(nodeLabelKeys[node.id]);
}

function NodeDetails({
	node,
	inspectors,
	timings,
	usages,
	turnIndex,
	showRun,
}: Pick<LaneProps, "inspectors" | "timings" | "usages"> & {
	node: ProcessNode;
	turnIndex: number;
	showRun: boolean;
}) {
	const t = useT();
	const run = showRun ? inspectors[turnIndex] : undefined;
	if (!run && !node.receipts?.length && !node.paths?.length) return null;
	return (
		<details className="process-lane-details">
			<summary>{t("panel.processLanes.details")}</summary>
			{node.receipts?.length ? (
				<ul className="process-lane-receipts">
					{node.receipts.map((receipt) => (
						<li key={receipt.id}>
							<code>{receipt.name}</code> · {receipt.state}
						</li>
					))}
				</ul>
			) : null}
			{node.paths?.length ? (
				<ul className="process-lane-paths">
					{node.paths.map((path) => (
						<li key={path}>
							<code>{path}</code>
						</li>
					))}
				</ul>
			) : null}
			{run ? <RunInspector run={run} timing={timings[turnIndex]} usage={usages[turnIndex]} embedded /> : null}
		</details>
	);
}

export function ProcessLaneView({
	state,
	inspectors,
	timings,
	usages,
	processFocus = null,
	onProcessFocusCleared,
	onOpenTask,
	onOpenReconcile,
}: LaneProps) {
	const language = useI18nStore((store) => store.language);
	const t = useT();
	const rootRef = useRef<HTMLDivElement>(null);
	const [panelWidth, setPanelWidth] = useState(372);
	const [heights, setHeights] = useState<Partial<Record<ProcessNode["id"], number>>>({});
	useEffect(() => {
		const root = rootRef.current;
		if (!root) return;
		const update = () => setPanelWidth(root.clientWidth || 372);
		update();
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(update);
		observer.observe(root);
		return () => observer.disconnect();
	}, []);
	useEffect(() => {
		const root = rootRef.current;
		if (!root || typeof ResizeObserver === "undefined") return;
		const cards = state.nodes.flatMap((node) => {
			const card = root.querySelector<HTMLElement>(`[data-process-node="${node.id}"]`);
			return card ? [card] : [];
		});
		const update = () => {
			const next: Partial<Record<ProcessNode["id"], number>> = {};
			for (const card of cards)
				next[card.dataset.processNode as ProcessNode["id"]] = Math.ceil(card.getBoundingClientRect().height);
			setHeights((old) => (JSON.stringify(old) === JSON.stringify(next) ? old : next));
		};
		const observer = new ResizeObserver(update);
		for (const card of cards) observer.observe(card);
		update();
		return () => observer.disconnect();
	}, [state]);
	useEffect(() => {
		if (!processFocus || !rootRef.current) return;
		const target = rootRef.current;
		if (target instanceof HTMLElement) {
			const details =
				target.querySelector<HTMLDetailsElement>("[data-process-node='doing'] details") ??
				target.querySelector<HTMLDetailsElement>("details");
			if (details) details.open = true;
			target.scrollIntoView({
				block: "nearest",
				behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
			});
			target.classList.remove("jump-flash");
			void target.offsetWidth;
			target.classList.add("jump-flash");
			setTimeout(() => target.classList.remove("jump-flash"), 1200);
		}
		onProcessFocusCleared?.();
	}, [processFocus, onProcessFocusCleared]);
	const layout = useMemo(
		() => estimateProcessLayout(state, panelWidth, heights),
		[state, panelWidth, heights],
	);
	const rectById = new Map(layout.rects.map((rect) => [rect.id, rect]));
	return (
		<div
			className="process-lanes"
			ref={rootRef}
			data-testid="process-lanes"
			data-turn={state.turnIndex}
			style={{ minHeight: layout.height }}
		>
			{layout.lanes.map((lane) => {
				const label = PROCESS_LANE_LABELS[lane.id][language];
				const nodes = state.nodes.filter((node) => node.lane === lane.id);
				return (
					<section
						key={lane.id}
						className="process-lane"
						data-process-lane={lane.id}
						style={{ top: lane.top, height: lane.height }}
						aria-label={label}
					>
						<h3 className="process-lane-label">{label}</h3>
						{nodes.length === 0 ? (
							<p className="process-lane-empty">
								{PROCESS_LANE_EMPTY[lane.id][language] ?? t("panel.processLanes.empty")}
							</p>
						) : null}
					</section>
				);
			})}
			<svg className="process-lane-wires" width={layout.width + 12} height={layout.height} aria-hidden="true">
				{state.edges.map((edge) => {
					const from = rectById.get(edge.from);
					const to = rectById.get(edge.to);
					return from && to ? (
						<path
							key={`${edge.from}-${edge.to}`}
							d={processWirePath(from, to, layout.width + 8)}
							className={`process-lane-wire ${edge.kind}`}
						/>
					) : null;
				})}
			</svg>
			{state.nodes.map((node) => {
				const rect = rectById.get(node.id);
				if (!rect) return null;
				const line = (index: 0 | 1 | 2) => processNodeLine(node, index, language);
				return (
					<article
						key={node.id}
						className={`process-lane-node ${node.state}${state.current === node.id ? " current" : ""}`}
						data-process-node={node.id}
						data-state={node.state}
						style={{ left: rect.x, top: rect.y, width: rect.width, minHeight: nodeHeight(node) }}
					>
						<header className="process-lane-node-head">
							<strong>{nodeLabel(node, t)}</strong>
							{node.demo ? (
								<span className="process-lane-demo">{t("panel.processLanes.ruleDemo")}</span>
							) : null}
						</header>
						<p>{line(0)}</p>
						<p>{line(1)}</p>
						<p className="process-lane-code" data-code={node.code}>
							{line(2)}
						</p>
						{node.id === "taskGate" && node.state === "waiting" && onOpenTask ? (
							<button type="button" onClick={onOpenTask}>
								{t("panel.processLanes.openTask")}
							</button>
						) : null}
						{node.id === "hostGate" && node.state === "blocked" && onOpenReconcile ? (
							<button type="button" onClick={onOpenReconcile}>
								{t("panel.processLanes.openReconcile")}
							</button>
						) : null}
						<NodeDetails
							node={node}
							showRun={
								node.id === "doing" || (node.id === "ask" && !state.nodes.some((item) => item.id === "doing"))
							}
							inspectors={inspectors}
							timings={timings}
							usages={usages}
							turnIndex={state.turnIndex}
						/>
					</article>
				);
			})}
		</div>
	);
}
