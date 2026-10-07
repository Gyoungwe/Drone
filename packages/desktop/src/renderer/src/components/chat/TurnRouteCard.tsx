import {
	type TaskView,
	type TurnRoute,
	turnRouteLines,
	turnRouteSteps,
	type WorkbenchTask,
} from "@drone/shared";
import { lazy, Suspense, useMemo, useState } from "react";
import { useI18nStore } from "../../i18n";
import { RoadmapLane } from "../route/Roadmap";
import { formatCardText } from "../session/format-card-text";
import { TaskDecisionCard } from "./TaskDecisionCard";

const RouteMindMap = lazy(() => import("../route/RouteMindMap"));

/**
 * One turn's route as a compact horizontal roadmap
 * (request → capabilities → skill → stage → tools → result). Each node shows only a short label
 * and a status colour; hover shows the full sentence, click expands it. The full explanation and a
 * mind-map view are opt-in. The optional task decision is embedded so a blocked route and its
 * action share one card; the task panel remains the full ledger.
 */
export function TurnRouteCard({
	route,
	tasks = [],
	view,
	sessionId = null,
	agentActive = false,
}: {
	route: TurnRoute;
	tasks?: WorkbenchTask[];
	view?: TaskView;
	sessionId?: string | null;
	agentActive?: boolean;
}) {
	const language = useI18nStore((state) => state.language);
	const lang = language === "en" ? "en" : "zh";
	const steps = useMemo(() => turnRouteSteps(route, lang), [route, lang]);
	const [mode, setMode] = useState<"lane" | "mind" | "text">("lane");
	const zh = lang === "zh";
	const toggle = (next: "mind" | "text") => setMode((value) => (value === next ? "lane" : next));
	return (
		<div className="mt-2 rounded-xl border border-border bg-surface px-3 py-2" data-testid="turn-route">
			<div className="flex items-start gap-2">
				<div className="min-w-0 flex-1">
					<RoadmapLane nodes={steps} testId="turn-route-roadmap" />
				</div>
				<div className="flex shrink-0 gap-1 pt-0.5">
					<button
						type="button"
						className={`rounded-md px-1.5 text-[10px] leading-5 ${mode === "mind" ? "bg-accent/10 text-accent" : "text-ink-faint hover:text-ink"}`}
						onClick={() => toggle("mind")}
						aria-pressed={mode === "mind"}
					>
						{zh ? "导图" : "Map"}
					</button>
					<button
						type="button"
						className={`rounded-md px-1.5 text-[10px] leading-5 ${mode === "text" ? "bg-accent/10 text-accent" : "text-ink-faint hover:text-ink"}`}
						onClick={() => toggle("text")}
						aria-pressed={mode === "text"}
					>
						{zh ? "全文" : "Details"}
					</button>
				</div>
			</div>
			{mode === "mind" && (
				<div className="mt-2">
					<Suspense fallback={null}>
						<RouteMindMap nodes={steps} />
					</Suspense>
				</div>
			)}
			{mode === "text" && <RouteText route={route} lang={lang} />}
			{view && tasks.length > 0 && (
				<div className="mt-2 border-t border-border/70 pt-2" data-testid="turn-route-decisions">
					{tasks.map((task) => (
						<TaskDecisionCard
							key={task.id}
							task={task}
							view={view}
							sessionId={sessionId}
							agentActive={agentActive}
							embedded
						/>
					))}
				</div>
			)}
		</div>
	);
}

function RouteText({ route, lang }: { route: TurnRoute; lang: "zh" | "en" }) {
	const routeView = turnRouteLines(route, lang);
	return (
		<div className="mt-2 border-t border-border/70 pt-2" data-testid="turn-route-text">
			<p className="text-[12px] leading-5 text-ink">{formatCardText(routeView.summary)}</p>
			<ul className="mt-1 list-disc space-y-1 pl-4">
				{routeView.lines.map((line) => (
					<li key={line} className="whitespace-pre-wrap text-[12px] leading-5 text-ink-dim">
						{formatCardText(line)}
					</li>
				))}
			</ul>
		</div>
	);
}
