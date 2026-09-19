import type { ProgressDisplay } from "@drone/shared";
import { useI18nStore } from "../../i18n";

/**
 * 阶段说明（Agent 公开摘要）：过程块内的一条「阶段行」——标题 + 可选说明 + 下一步。
 * 只讲发生了什么，不带外壳标签（「阶段说明 · Agent 公开摘要」之类的元信息已由过程块头承担）。
 */
export function ProgressNote({ progress }: { progress: ProgressDisplay }) {
	const zh = useI18nStore((s) => s.language) === "zh";
	const kindLabel =
		progress.kind === "summary"
			? zh
				? "小结"
				: "Summary"
			: progress.kind === "update"
				? null
				: zh
					? "计划"
					: "Plan";
	return (
		<div className="progress-stage" data-testid="progress-note" data-stage-kind={progress.kind || "plan"}>
			<span className="progress-stage-dot" aria-hidden="true" />
			<div className="min-w-0 flex-1">
				<p className="progress-stage-title">
					{progress.text}
					{kindLabel && <span className="progress-stage-kind">{kindLabel}</span>}
				</p>
				{progress.detail && <p className="progress-stage-detail">{progress.detail}</p>}
				{progress.next && (
					<p className="progress-stage-next">
						{zh ? "接下来：" : "Next: "}
						{progress.next}
					</p>
				)}
			</div>
		</div>
	);
}
