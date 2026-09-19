import type { ProcessSegment } from "@drone/shared";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { t } from "../i18n";
import { ChevronRightIcon } from "./icons";

/**
 * 过程块（lan-web 版）：与桌面 ProcessBlock 同一份 shared groupProcessRows 分段，
 * 把一轮里的「阶段说明 + 折叠工具组」收成一行摘要（N 阶段 · M 次工具 · 最新阶段）。
 * 运行中自动展开、结束后自动收起；用户手动切换后不再自动改变。
 */
export function ProcessBlock({ segment, children }: { segment: ProcessSegment; children: ReactNode }) {
	const [open, setOpen] = useState(segment.working);
	const userToggled = useRef(false);
	const wasWorking = useRef(segment.working);

	useEffect(() => {
		if (wasWorking.current === segment.working) return;
		wasWorking.current = segment.working;
		if (!userToggled.current) setOpen(segment.working);
	}, [segment.working]);

	const stageText = segment.working
		? (segment.statusText ?? segment.latestStage?.text)
		: segment.latestStage?.text;
	const parts: string[] = [];
	if (segment.stages > 0) parts.push(t("process.stages", { n: segment.stages }));
	if (segment.tools > 0) parts.push(t("process.tools", { n: segment.tools }));
	if (segment.subagents > 0) parts.push(t("process.subagents", { n: segment.subagents }));

	return (
		<section className={`process-block${open ? " open" : ""}${segment.working ? " working" : ""}`}>
			<button
				type="button"
				className="process-head"
				aria-expanded={open}
				onClick={() => {
					userToggled.current = true;
					setOpen((v) => !v);
				}}
			>
				<ChevronRightIcon size={12} className={`meta-caret${open ? " open" : ""}`} />
				<span className="process-label">{segment.working ? t("process.running") : t("process.label")}</span>
				<span className="process-meta">{parts.join(" · ")}</span>
				{!open && stageText && (
					<span className="process-stage" title={stageText}>
						{stageText}
					</span>
				)}
			</button>
			{open && <div className="process-body">{children}</div>}
		</section>
	);
}
