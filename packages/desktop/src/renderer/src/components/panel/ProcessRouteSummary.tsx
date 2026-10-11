import { type TurnRoute, turnRouteSteps } from "@drone/shared";
import { useMemo } from "react";
import { useI18nStore, useT } from "../../i18n";
import { RoadmapLane, summarizeRoadmap } from "../route/Roadmap";

/** Compact route snapshot for the Process panel; detailed receipts stay in the lane graph. */
export function ProcessRouteSummary({ route }: { route: TurnRoute }) {
	const language = useI18nStore((store) => store.language);
	const t = useT();
	const lang = language === "en" ? "en" : "zh";
	const steps = useMemo(() => turnRouteSteps(route, lang), [route, lang]);
	const summary = useMemo(() => summarizeRoadmap(steps), [steps]);
	const currentIndex = Math.max(
		0,
		steps.findIndex(
			(step) => step.status === "active" || step.status === "warn" || step.status === "blocked",
		),
	);
	const current = steps[currentIndex] ?? steps[steps.length - 1];

	return (
		<section
			className="mb-3 rounded-xl border border-border bg-surface px-3 py-2"
			data-testid="process-route-summary"
			data-route-status={summary.status}
			aria-label={t("panel.processRoute.ariaLabel")}
		>
			<header className="flex items-start gap-3">
				<div className="min-w-0 flex-1">
					<h3 className="text-[12px] font-semibold text-ink">{t("panel.processRoute.title")}</h3>
					<p className="mt-0.5 truncate text-[11px] text-ink-dim" title={route.utterance}>
						{route.utterance}
					</p>
				</div>
				<span className="shrink-0 pt-0.5 text-[10px] text-ink-faint" data-testid="process-route-progress">
					{t("panel.processRoute.stepCount", {
						current: Math.min(currentIndex + 1, summary.total),
						total: summary.total,
					})}
				</span>
			</header>
			{current ? (
				<div
					className="mt-2 flex items-center gap-2 rounded-lg bg-hover/60 px-2.5 py-1.5"
					data-testid="process-route-current"
				>
					<span className="text-[10px] text-ink-faint">{t("panel.processRoute.current")}</span>
					<strong className="text-[12px] text-ink">{current.label}</strong>
					<span className="min-w-0 truncate text-[11px] text-ink-dim">{current.value}</span>
				</div>
			) : null}
			<div className="mt-2">
				<RoadmapLane nodes={steps} testId="process-route-roadmap" ariaLabel={t("panel.processRoute.steps")} />
			</div>
			{current?.detail ? (
				<p className="mt-2 border-t border-border/70 pt-2 text-[11px] leading-5 text-ink-dim">
					{current.detail}
				</p>
			) : null}
		</section>
	);
}
