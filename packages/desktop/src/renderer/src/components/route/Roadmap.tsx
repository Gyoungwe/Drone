import { Fragment, useState } from "react";

export type RoadmapStatus = "ok" | "active" | "warn" | "blocked" | "skip";
export interface RoadmapNode {
	key: string;
	label: string;
	value?: string;
	status: RoadmapStatus;
	detail?: string;
}

/** 状态配色：成功 / 进行中 / 注意 / 阻塞 / 跳过，路由卡、科研运行和泳道共用 */
export const ROADMAP_TONE: Record<RoadmapStatus, string> = {
	ok: "border-ok/35 bg-ok/5 text-ok",
	active: "border-accent/45 bg-accent/8 text-accent",
	warn: "border-warn/40 bg-warn/5 text-warn",
	blocked: "border-err/35 bg-err/5 text-err",
	skip: "border-border bg-hover/60 text-ink-faint",
};
export const ROADMAP_DOT: Record<RoadmapStatus, string> = {
	ok: "bg-ok",
	active: "bg-accent",
	warn: "bg-warn",
	blocked: "bg-err",
	skip: "bg-ink-faint/50",
};

/** 研究运行等其它路由状态映射到统一的路线图状态 */
export function roadmapStatus(state: string): RoadmapStatus {
	if (state === "complete" || state === "done" || state === "ok") return "ok";
	if (state === "active" || state === "running") return "active";
	if (state === "blocked" || state === "failed" || state === "error") return "blocked";
	if (state === "warn" || state === "partial") return "warn";
	return "skip";
}

/** 单个路线节点：极简标签 + 状态色，悬停显示详情，点击可选中 */
export function RoadmapChip({
	node,
	selected = false,
	onSelect,
}: {
	node: RoadmapNode;
	selected?: boolean;
	onSelect?: (key: string) => void;
}) {
	return (
		<button
			type="button"
			title={node.detail}
			data-status={node.status}
			data-testid={`roadmap-node-${node.key}`}
			onClick={() => onSelect?.(node.key)}
			className={`flex min-w-0 shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] leading-5 ${ROADMAP_TONE[node.status]} ${selected ? "ring-1 ring-current" : ""}`}
		>
			<span className={`h-1.5 w-1.5 shrink-0 rounded-full ${ROADMAP_DOT[node.status]}`} />
			<span className="font-medium">{node.label}</span>
			{node.value && <span className="max-w-[9rem] truncate opacity-80">{node.value}</span>}
		</button>
	);
}

/** 横向技术路线图：节点之间用细箭头连接，点击节点在下方展开该步详情 */
export function RoadmapLane({ nodes, testId = "roadmap" }: { nodes: RoadmapNode[]; testId?: string }) {
	const [open, setOpen] = useState<string | null>(null);
	const current = nodes.find((node) => node.key === open);
	return (
		<div data-testid={testId}>
			<div className="flex items-center gap-1 overflow-x-auto pb-0.5">
				{nodes.map((node, index) => (
					<Fragment key={node.key}>
						{index > 0 && (
							<span aria-hidden className="shrink-0 text-[10px] text-ink-faint">
								→
							</span>
						)}
						<RoadmapChip
							node={node}
							selected={node.key === open}
							onSelect={(key) => setOpen((value) => (value === key ? null : key))}
						/>
					</Fragment>
				))}
			</div>
			{current?.detail && (
				<p
					data-testid={`${testId}-detail`}
					className="mt-1.5 whitespace-pre-wrap text-[12px] leading-5 text-ink-dim"
				>
					{current.detail}
				</p>
			)}
		</div>
	);
}
