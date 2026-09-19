import type { ProcessSegment } from "@drone/shared";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useT } from "../../i18n";
import { ChevronRightIcon } from "../icons";

/**
 * 过程块：一轮里的「阶段说明 + 工具组」整体收成一行。
 *
 * - 运行中自动展开（能看到实时活动行）；运行结束后自动收起成摘要行（N 阶段 · M 次工具 · 最新阶段；工具分类明细看展开态或右侧「过程」页签）。
 * - 用户手动展开/收起后，本块不再自动改变（记住用户意图，直到块被卸载）。
 * - 子行仍由 MessageList 按原规则渲染（MetaGroup 的 working / ticker / 圆点行为原样保留）。
 */
export function ProcessBlock({ segment, children }: { segment: ProcessSegment; children: ReactNode }) {
	const t = useT();
	const [open, setOpen] = useState(segment.working);
	const userToggled = useRef(false);
	const wasWorking = useRef(segment.working);

	// 运行状态翻转时（未被用户手动干预）跟随：开始 → 展开，结束 → 收起
	useEffect(() => {
		if (wasWorking.current === segment.working) return;
		wasWorking.current = segment.working;
		if (!userToggled.current) setOpen(segment.working);
	}, [segment.working]);

	const stageText = segment.working
		? (segment.statusText ?? segment.latestStage?.text)
		: segment.latestStage?.text;

	return (
		<section
			className={`process-block${open ? " open" : ""}${segment.working ? " working" : ""}`}
			data-testid="process-block"
		>
			<button
				type="button"
				className="process-block-head"
				aria-expanded={open}
				onClick={() => {
					userToggled.current = true;
					setOpen((v) => !v);
				}}
			>
				<ChevronRightIcon size={12} className={`process-block-chevron${open ? " open" : ""}`} />
				<span className="process-block-label">
					{segment.working ? t("process.running") : t("process.label")}
				</span>
				<span className="process-block-meta">
					{segment.stages > 0 && <span>{t("process.stages", { count: segment.stages })}</span>}
					{segment.tools > 0 && (
						<>
							{segment.stages > 0 && <span className="process-block-dot">·</span>}
							<span>{t("process.tools", { count: segment.tools })}</span>
						</>
					)}
					{segment.subagents > 0 && (
						<>
							<span className="process-block-dot">·</span>
							<span>{t("process.subagents", { count: segment.subagents })}</span>
						</>
					)}
				</span>
				{!open && stageText && (
					<span className="process-block-stage" title={stageText}>
						{stageText}
					</span>
				)}
			</button>
			{open && <div className="process-block-body">{children}</div>}
		</section>
	);
}
