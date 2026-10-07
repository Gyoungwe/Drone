import type { KnowledgeGraph as GraphData } from "@drone/shared";
import type Graph from "graphology";
import { useEffect, useRef, useState } from "react";
import { buildNebulaGraph, labelledNodes, type NebulaNodeAttributes, neighbourhood } from "./nebula-model";

/** 是否能用 WebGL（测试环境 / 老显卡上回退到 SVG） */
export function supportsWebGL(): boolean {
	try {
		if (typeof document === "undefined") return false;
		const canvas = document.createElement("canvas");
		return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
	} catch {
		return false;
	}
}

const DIM_NODE = "#262b38";
const DIM_EDGE = "rgba(120,130,160,0.05)";
const EDGE = "rgba(150,170,220,0.18)";
const EDGE_ON = "rgba(200,215,255,0.65)";

/**
 * 星云式知识网络（sigma.js v3 + graphology，WebGL）：
 * ForceAtlas2 在 Web Worker 里收敛，Louvain 主题簇着色，节点大小按连接数，
 * 支持滚轮缩放、拖动平移，悬停高亮一跳邻居，点击打开笔记。
 */
export function KnowledgeNebula({
	data,
	onOpen,
	height = 460,
	labels,
}: {
	data: Pick<GraphData, "nodes" | "edges">;
	onOpen: (path: string) => void;
	height?: number;
	labels: { reset: string; relayout: string };
}) {
	const container = useRef<HTMLDivElement | null>(null);
	const controls = useRef<{ reset: () => void; relayout: () => void } | null>(null);
	const [hovered, setHovered] = useState<string | null>(null);
	const openRef = useRef(onOpen);
	openRef.current = onOpen;

	useEffect(() => {
		const element = container.current;
		if (!element) return;
		let disposed = false;
		let cleanup = () => {};
		void (async () => {
			const [{ default: Sigma }, { default: FA2Layout }, { default: forceAtlas2 }] = await Promise.all([
				import("sigma"),
				import("graphology-layout-forceatlas2/worker"),
				import("graphology-layout-forceatlas2"),
			]);
			if (disposed) return;
			const graph: Graph<NebulaNodeAttributes> = buildNebulaGraph(data);
			const sticky = labelledNodes(data as GraphData, 14);
			let hover: string | null = null;
			let active: Set<string> | null = null;
			const renderer = new Sigma(graph, element, {
				renderLabels: true,
				labelColor: { color: "#dfe6ff" },
				labelSize: 11,
				labelFont: "Inter, system-ui, sans-serif",
				labelRenderedSizeThreshold: 7,
				defaultEdgeColor: EDGE,
				minCameraRatio: 0.05,
				maxCameraRatio: 8,
				zIndex: true,
				nodeReducer: (node, attrs) => {
					const out: Record<string, unknown> = { ...attrs };
					if (sticky.has(node)) out.forceLabel = true;
					if (active && !active.has(node)) {
						out.color = DIM_NODE;
						out.label = "";
						out.forceLabel = false;
						out.zIndex = 0;
					} else if (active) {
						out.zIndex = 1;
						out.forceLabel = true;
						if (node === hover) out.highlighted = true;
					}
					return out;
				},
				edgeReducer: (edge, attrs) => {
					if (!active) return attrs;
					const [a, b] = graph.extremities(edge);
					const on = active.has(a) && active.has(b) && (a === hover || b === hover);
					return { ...attrs, color: on ? EDGE_ON : DIM_EDGE, size: on ? 1.4 : 0.5, zIndex: on ? 1 : 0 };
				},
			});
			renderer.on("enterNode", ({ node }) => {
				hover = node;
				active = neighbourhood(graph, node);
				setHovered(graph.getNodeAttribute(node, "label"));
				element.style.cursor = "pointer";
				renderer.refresh({ skipIndexation: true });
			});
			renderer.on("leaveNode", () => {
				hover = null;
				active = null;
				setHovered(null);
				element.style.cursor = "";
				renderer.refresh({ skipIndexation: true });
			});
			renderer.on("clickNode", ({ node }) => openRef.current(node));

			const settings = {
				...forceAtlas2.inferSettings(graph),
				barnesHutOptimize: graph.order > 300,
				gravity: 0.6,
				scalingRatio: 6,
			};
			let layout = graph.order > 1 ? new FA2Layout(graph, { settings }) : null;
			let timer: ReturnType<typeof setTimeout> | null = null;
			const run = (ms: number) => {
				if (!layout) return;
				layout.start();
				if (timer) clearTimeout(timer);
				timer = setTimeout(() => layout?.stop(), ms);
			};
			run(Math.min(6000, 1500 + graph.order * 10));
			controls.current = {
				reset: () => void renderer.getCamera().animatedReset({ duration: 400 }),
				relayout: () => run(2500),
			};
			cleanup = () => {
				if (timer) clearTimeout(timer);
				layout?.kill();
				layout = null;
				renderer.kill();
				controls.current = null;
			};
		})();
		return () => {
			disposed = true;
			cleanup();
		};
	}, [data]);

	return (
		<div className="relative">
			<div
				ref={container}
				data-testid="knowledge-nebula"
				className="knowledge-nebula w-full overflow-hidden rounded-xl border border-border"
				style={{
					height,
					background:
						"radial-gradient(ellipse at 30% 20%, rgba(90,110,200,0.25), transparent 55%), radial-gradient(ellipse at 75% 80%, rgba(200,80,160,0.18), transparent 50%), #0b0e17",
				}}
			/>
			<div className="pointer-events-none absolute left-2 top-2 text-[11px] text-[#c9d3f5]">
				{hovered ?? ""}
			</div>
			<div className="absolute right-2 top-2 flex gap-1">
				<button
					type="button"
					className="rounded-md bg-white/10 px-2 py-0.5 text-[11px] text-[#dfe6ff] hover:bg-white/20"
					onClick={() => controls.current?.reset()}
				>
					{labels.reset}
				</button>
				<button
					type="button"
					className="rounded-md bg-white/10 px-2 py-0.5 text-[11px] text-[#dfe6ff] hover:bg-white/20"
					onClick={() => controls.current?.relayout()}
				>
					{labels.relayout}
				</button>
			</div>
		</div>
	);
}
