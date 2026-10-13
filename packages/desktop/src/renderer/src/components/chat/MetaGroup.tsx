import { type MetaItem, summarizeCategories, thinkingLabel } from "@drone/shared";
import { Fragment, memo, useEffect, useMemo, useState } from "react";
import type { OrbState } from "thinking-orbs";
import { ThinkingOrb } from "thinking-orbs";
import { useI18nStore, useT } from "../../i18n";
import { Slot } from "../../plugins/Slot";
import { UI_SLOTS } from "../../plugins/slots";
import { ExpandArrowIcon } from "../icons";
import { summaryLabel } from "./meta-summary-label";
import { type LivePreviewItem, PreviewTicker } from "./PreviewTicker";
import { ToolCallCard } from "./ToolCallCard";
import { useShownWorking } from "./use-shown-working";

export type { MetaItem };

/** 思考计时：思考中每秒刷新「思考中 Ns」；endedAt 落定（首个正文/工具到达）后冻结为「深度思考 X.Xs」。
 * 无起点（历史回放未持久化思考时间）→ null，调用方回退静态标签，不留空位 */
function useThinkingTimer(startedAt?: number, endedAt?: number): string | null {
	const zh = useI18nStore((st) => st.language) === "zh";
	const live = startedAt != null && endedAt == null;
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!live) return;
		setNow(Date.now());
		const id = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(id);
	}, [live]);
	return startedAt != null ? thinkingLabel(startedAt, endedAt ?? null, now, zh) : null;
}

/** 思考过程行（内层折叠，与 tool call 行同风格） */
function ThinkingRow({
	thinking,
	startedAt,
	endedAt,
}: {
	thinking: string;
	startedAt?: number;
	endedAt?: number;
}) {
	const t = useT();
	const label = useThinkingTimer(startedAt, endedAt) ?? t("message.thinking");
	return (
		<details className="group/dets drawer-details">
			<summary className="group/row flex cursor-pointer items-center gap-2 py-0.5 select-none [&::-webkit-details-marker]:hidden">
				<span className="shrink-0 text-[13px] font-semibold text-ink-faint transition-colors group-hover/row:text-ink">
					<span data-testid="thinking-label" className="tabular-nums">
						{label}
					</span>
				</span>
				<ExpandArrowIcon className="shrink-0 text-ink-faint opacity-0 transition-[opacity,transform,color] group-hover/row:opacity-100 group-hover/row:text-ink-2 group-open/dets:rotate-90" />
			</summary>
			<div className="py-1 pl-4 text-[13px] leading-relaxed whitespace-pre-wrap break-words text-ink-dim select-text">
				{thinking}
			</div>
		</details>
	);
}
/**
 * 外层折叠组：聚合多条非正文消息的思考/工具。
 * 标题行：working 期 = Working/Thinking 标签 + 内联预览行；worked 期 = 分类统计单行
 * （读取/编辑/探索/搜索/执行命令，未知工具按原名计数；无工具时回退 Worked 标签）。
 * 其下圆点行按 tool call 逐粒追加（done 实心 ink / error 灰 / running 空心呼吸），working 期
 * 实时、结束后随 items 冻结，展开组时隐藏。展开区为完整思考行/工具卡。
 * endImmediately：组被正文边界切分（streaming.text 在输出）或 run 已终结 → working 信号消失时
 * 立即结束，不做滞后缓冲；否则（turn/工具间隙）滞后 HYSTERESIS_MS 防闪烁
 */
/**
 * memo 比较器：items 元素逐一身份比较（历史 MetaItem 由 chat-rows 的 WeakMap 缓存保证引用稳定；
 * 数组本身每次重建，不能比数组身份）。working/endImmediately/subagentCount 为原始值。
 * 语言切换不受影响：useT/i18n 订阅在组件内部，父级 memo 拦不住也不需要拦。
 */
function metaGroupPropsEqual(
	a: {
		items: MetaItem[];
		working: boolean;
		endImmediately?: boolean;
		subagentCount?: number;
		statusText?: string;
	},
	b: {
		items: MetaItem[];
		working: boolean;
		endImmediately?: boolean;
		subagentCount?: number;
		statusText?: string;
	},
): boolean {
	if (
		a.working !== b.working ||
		a.endImmediately !== b.endImmediately ||
		a.subagentCount !== b.subagentCount ||
		a.statusText !== b.statusText ||
		a.items.length !== b.items.length
	)
		return false;
	for (let i = 0; i < a.items.length; i++) {
		if (a.items[i] !== b.items[i]) return false;
	}
	return true;
}

export const MetaGroup = memo(function MetaGroup({
	items,
	working,
	endImmediately = false,
	subagentCount = 0,
	statusText,
}: {
	items: MetaItem[];
	working: boolean;
	endImmediately?: boolean;
	/** 该组派生的子代理数（统计行正向显示「子代理 ×N」；由 MessageList 按组归属计算） */
	subagentCount?: number;
	/** Agent 自报 / 宿主真实工具校验后的 live 状态文案。 */
	statusText?: string;
}) {
	const t = useT();
	const count = items.reduce((n, item) => n + (item.thinking ? 1 : 0) + item.tools.length, 0);
	// 分类汇总：worked 态标题行（working 期不显示；展开组时标题仍在）
	const segments = useMemo(() => summarizeCategories(items, subagentCount), [items, subagentCount]);

	// 滞后缓冲：working 信号消失后需保持缓冲才显示 worked（turn 间隙内不闪烁）；
	// 与 CenterOrb 中央动画共用同一 hook，两处显隐节奏一致
	const shownWorking = useShownWorking(working, endImmediately);
	// 状态行小 orb 恒显示：中央动画开关（centerOrbEnabled）与本行解耦，互不让位

	const rows = items.flatMap((item, i) => [
		item.thinking ? (
			<ThinkingRow
				// biome-ignore lint/suspicious/noArrayIndexKey: 折叠组内项无独立 id，列表顺序稳定
				key={`thinking-${i}`}
				thinking={item.thinking}
				startedAt={item.thinkingStartedAt}
				endedAt={item.thinkingEndedAt}
			/>
		) : null,
		...item.tools.map((tool) => (
			<Slot key={tool.key} name={UI_SLOTS.ToolCallCard} props={{ tool }} fallback={ToolCallCard} />
		)),
	]);
	// orb 状态（名字是包的渲染器名，与我们的语义不同名）：
	// tool 运行中 → connecting（星座连线 + 信号跑边）
	// 纯 thinking → working（粒子轨道，转速更快）
	// （必须在 liveItems 之前推导，因为 liveItems 会过滤掉 thinking）
	const latestActivity = useMemo(() => {
		for (let i = items.length - 1; i >= 0; i--) {
			const activity = items[i]?.activity;
			if (activity && activity.length > 0) {
				return activity[activity.length - 1];
			}
		}
		return undefined;
	}, [items]);
	const isTool = latestActivity?.kind === "tool";
	const orbState: OrbState = isTool ? "connecting" : "working";
	const labelKey = isTool ? "message.working" : "message.thinkingLabel";
	// 组内最近一段带计时的思考：working 期标题显示实时秒数，结束后冻结时长
	const timedThinking = useMemo(() => {
		for (let i = items.length - 1; i >= 0; i--) {
			const it = items[i];
			if (it?.thinking && it.thinkingStartedAt != null) return it;
		}
		return null;
	}, [items]);
	const thinkingTimerLabel = useThinkingTimer(
		timedThinking?.thinkingStartedAt,
		timedThinking?.thinkingEndedAt,
	);

	// 实时预览：完整活动序列按到达顺序展开，ticker 在 thinking/tool 间保持 latest-wins。
	// 内容已由 reducer 分块累计；这里不重新合并、解析或摘要。
	const liveItems = useMemo<LivePreviewItem[]>(() => {
		const out: LivePreviewItem[] = [];
		for (const item of items) {
			if (!item.activity) continue;
			for (const entry of item.activity) {
				if (entry.kind === "thinking") {
					out.push({ kind: "thinking", id: entry.id, text: entry.text });
				} else {
					out.push({ kind: "tool", id: entry.id, name: entry.name, text: entry.args });
				}
			}
		}
		return out;
	}, [items]);

	// 扫光目标集合（预览行 id）标识：集合变化 → hook 内同帧补样式，消除新行首帧实色闪烁

	/** 单条已结束（如正文前的思考）直接裸行展示，不套 "已完成 · 1" 外壳；-mb-4 与包装组一致：
	 * 与后续正文净距 8px（容器 gap-6 - 16px），单行/成组间距统一 */
	// 纯子代理调用不带普通 tool/thinking，仍须保留折叠状态行作为卡片的时间锚点。
	const showWrapper = count >= 2 || shownWorking || subagentCount > 0;
	if (!showWrapper) {
		return (
			<div data-testid="tool-phase-group" className="-mb-4 flex flex-col gap-2">
				{rows}
			</div>
		);
	}

	return (
		// -mb-4：抵消容器 gap-6 的一部分，折叠行与后续正文净距 8px（成组与单行一致）
		<div data-testid="tool-phase-group" className="-mb-4">
			<details className="group/outer peer drawer-details">
				<summary className="group/row flex cursor-pointer select-none flex-col [&::-webkit-details-marker]:hidden">
					{/* min-h-6：与内联预览行（h-6）等高，working/worked 切换首行行高不变 */}
					<div className="flex min-h-6 w-full items-center gap-2 py-0.5">
						{shownWorking ? (
							<>
								<div className="flex shrink-0 items-center gap-2">
									<ThinkingOrb state={orbState} size={20} paused={false} />
									<span className="shimmer text-[14px] font-bold text-ink-working transition-colors group-hover/row:text-ink">
										{statusText || (!isTool && thinkingTimerLabel) || t(labelKey)}
									</span>
								</div>
								{/* 实时预览内联进标题行（单行截断，展开组时隐藏） */}
								<div className="min-w-0 flex-1 group-open/outer:hidden">
									<PreviewTicker items={liveItems} reserveSpace />
								</div>
							</>
						) : segments.length > 0 ? (
							/* worked 态标题 = 分类统计（原展开区速读行提上来）；单行截断，hover 变色提示可展开 */
							<span className="min-w-0 flex-1 truncate text-[13px] text-ink-dim transition-colors group-hover/row:text-ink">
								{segments.map((seg, i) => (
									<Fragment key={seg.key}>
										{i > 0 && <span className="opacity-50"> · </span>}
										{summaryLabel(t, seg)}
									</Fragment>
								))}
							</span>
						) : (
							<span className="text-[14px] font-bold text-ink-dim transition-colors group-hover/row:text-ink">
								{thinkingTimerLabel ?? t("message.worked")}
							</span>
						)}
					</div>
				</summary>
				<div className="flex flex-col gap-2 py-1">{rows}</div>
			</details>
		</div>
	);
}, metaGroupPropsEqual);
