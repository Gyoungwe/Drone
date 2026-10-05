import { type TaskView, type TurnRoute, turnRouteLines, type WorkbenchTask } from "@drone/shared";
import { useI18nStore } from "../../i18n";
import { formatCardText } from "../session/format-card-text";
import { TaskDecisionCard } from "./TaskDecisionCard";

/**
 * One turn's route. The optional task is embedded here so a blocked route and its action share
 * one card; the task panel remains the full ledger and is not duplicated in chat.
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
	const routeView = turnRouteLines(route, language === "en" ? "en" : "zh");
	return (
		<details
			className="mt-2 rounded-xl border border-border bg-surface px-3 py-2"
			data-testid="turn-route"
			open={tasks.some((task) =>
				task.actions.some((action) => action.kind === "review" && action.state === "pending"),
			)}
		>
			<summary className="cursor-pointer text-[12px] leading-5 text-ink">
				{formatCardText(routeView.summary)}
			</summary>
			<div className="mt-2 border-t border-border/70 pt-2">
				<ul className="list-disc space-y-1 pl-4">
					{routeView.lines.map((line) => (
						<li key={line} className="whitespace-pre-wrap text-[12px] leading-5 text-ink-dim">
							{formatCardText(line)}
						</li>
					))}
				</ul>
				{view && tasks.length > 0 && (
					<div className="mt-2" data-testid="turn-route-decisions">
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
		</details>
	);
}
