import { type TurnRoute, turnRouteSteps } from "@drone/shared";
import { useMemo } from "react";
import { useI18nStore } from "../../i18n";
import { ROADMAP_TONE, RoadmapLane, summarizeRoadmap } from "../route/Roadmap";

/** Compact route snapshot for the Process panel; detailed receipts stay in the lane graph. */
export function ProcessRouteSummary({ route }: { route: TurnRoute }) {
	const language = useI18nStore((store) => store.language);
	const lang = language === "en" ? "en" : "zh";
	const steps = useMemo(() => turnRouteSteps(route, lang), [route, lang]);
	const summary = useMemo(() => summarizeRoadmap(steps), [steps]);
	const zh = lang === "zh";
	const statusLabel =
		summary.status === "blocked"
			? zh
				? "等待处理"
				: "Needs attention"
			: summary.status === "active"
				? zh
					? "执行中"
					: "Running"
				: summary.status === "warn"
					? zh
						? "需要注意"
						: "Review"
					: zh
						? "可继续"
						: "Ready";
	const current = steps.find(
		(step) => step.status === "blocked" || step.status === "active" || step.status === "warn",
	);

	return (
		<section
			className="mb-3 rounded-xl border border-border bg-surface px-3 py-2"
			data-testid="process-route-summary"
			data-route-status={summary.status}
			aria-label={zh ? "本轮路由摘要" : "Turn route summary"}
		>
			<header className="flex items-start gap-3">
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-2">
						<h3 className="text-[12px] font-semibold text-ink">{zh ? "本轮路由" : "Turn route"}</h3>
						<span
							data-testid="process-route-status"
							className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${ROADMAP_TONE[summary.status]}`}
						>
							{statusLabel}
						</span>
					</div>
					<p className="mt-0.5 truncate text-[11px] text-ink-dim" title={route.utterance}>
						{route.utterance}
					</p>
				</div>
				<span className="shrink-0 pt-0.5 text-[10px] text-ink-faint" data-testid="process-route-progress">
					{summary.settled}/{summary.total} {zh ? "步已判断" : "steps settled"}
				</span>
			</header>
			<div className="mt-2">
				<RoadmapLane
					nodes={steps}
					testId="process-route-roadmap"
					ariaLabel={zh ? "本轮路由步骤" : "Turn route steps"}
				/>
			</div>
			{current ? (
				<p className="mt-2 border-t border-border/70 pt-2 text-[11px] text-ink-dim">
					{zh ? "当前需要关注：" : "Focus now: "}
					<span className="font-medium text-ink">{current.label}</span>
					{current.detail ? ` · ${current.detail}` : ""}
				</p>
			) : null}
		</section>
	);
}
