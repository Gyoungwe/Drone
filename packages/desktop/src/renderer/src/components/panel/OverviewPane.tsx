import { collectDeliveries, deriveProcessLaneTurns } from "@drone/shared";
import { useMemo, useState } from "react";
import { useT } from "../../i18n";
import { useSessionsStore } from "../../stores/sessions";
import { summarizeRuns, useSubagentsStore } from "../../stores/subagents";
import { selectTranscript, useTranscriptStore } from "../../stores/transcript";
import { DeliveryCards } from "../chat/DeliveryCards";
import { ContextUsageMeter } from "./ContextUsageMeter";
import { EvidencePane } from "./EvidencePane";
import { ProcessPane } from "./ProcessPane";
import { ReviewerCard } from "./ReviewerCard";
import { DecisionsSection, SessionOverviewSections } from "./SessionOverviewSections";
import { SubagentsPane } from "./SubagentsPane";

/**
 * The default right rail view. Every section is derived from the active session
 * and host stores; the design mock's example records never enter this component.
 */
export function OverviewPane({ sessionId }: { sessionId: string | null }) {
	const t = useT();
	const cwd = useSessionsStore((state) => state.cwd);
	const transcript = useTranscriptStore((state) => selectTranscript(state, sessionId));
	const messages = transcript.messages;
	const runsRecord = useSubagentsStore((state) => (sessionId ? state.runsBySession[sessionId] : undefined));
	const [detailsOpen, setDetailsOpen] = useState(false);
	const turns = useMemo(() => deriveProcessLaneTurns(messages), [messages]);
	const deliveries = useMemo(() => collectDeliveries(messages), [messages]);
	const runs = useMemo(() => (runsRecord ? Object.values(runsRecord) : []), [runsRecord]);
	const runSummary = useMemo(() => summarizeRuns(runs), [runs]);
	const todos = transcript.todos;
	const completedSteps = todos.filter((todo) => todo.status === "completed").length;
	const stepCount =
		todos.length > 0 ? `${completedSteps}/${todos.length}` : turns.length > 0 ? String(turns.length) : null;

	return (
		<div className="context-pane" data-testid="overview-pane">
			<section aria-label={t("panel.overview.usage")}>
				<ContextUsageMeter sessionId={sessionId} />
			</section>

			<SessionOverviewSections sessionId={sessionId} embedded includeDecisions={false} />

			{(todos.length > 0 || messages.length > 0 || turns.length > 0) && (
				<section className="panel-card" data-testid="overview-steps">
					<header className="flex items-center gap-2">
						<span className="text-[12px] font-medium text-ink">{t("panel.overview.steps")}</span>
						{stepCount && (
							<span className="ml-auto text-[11px] tabular-nums text-ink-faint">{stepCount}</span>
						)}
					</header>
					<button
						type="button"
						className="mt-2 text-[12px] text-ink-dim underline decoration-border underline-offset-4 hover:text-ink"
						aria-expanded={detailsOpen}
						onClick={() => setDetailsOpen((open) => !open)}
					>
						{detailsOpen ? t("panel.overview.hideDetails") : t("panel.overview.details")}
					</button>
					{detailsOpen && (
						<div className="mt-3 border-t border-border/70 pt-3">
							<ProcessPane sessionId={sessionId} includeReview={false} />
						</div>
					)}
				</section>
			)}

			{deliveries.length > 0 && (
				<section className="panel-card" data-testid="overview-deliveries">
					<header className="flex items-center gap-2">
						<span className="text-[12px] font-medium text-ink">{t("delivery.title")}</span>
						<span className="text-[11px] tabular-nums text-ink-faint">{deliveries.length}</span>
					</header>
					<div className="mt-2">
						<DeliveryCards files={deliveries} sessionId={sessionId} />
					</div>
				</section>
			)}

			{runs.length > 0 && (
				<details className="panel-card" data-testid="overview-subagents">
					<summary className="flex cursor-pointer items-center gap-2">
						<span className="text-[12px] font-medium text-ink">{t("panel.tabs.subagents")}</span>
						<span className="text-[11px] tabular-nums text-ink-faint">
							{runSummary.active > 0 ? runSummary.active : runs.length}
						</span>
					</summary>
					<div className="mt-2">
						<SubagentsPane sessionId={sessionId} />
					</div>
				</details>
			)}

			<EvidencePane defaultRoot={cwd} hideWhenEmpty />

			{transcript.reviewerFindings.length > 0 && (
				<details className="panel-card" data-testid="overview-review">
					<summary className="flex cursor-pointer items-center gap-2">
						<span className="text-[12px] font-medium text-ink">{t("process.reviewerTitle")}</span>
						<span className="text-[11px] tabular-nums text-ink-faint">
							{transcript.reviewerFindings.length}
						</span>
					</summary>
					<div className="mt-2 space-y-2">
						{transcript.reviewerFindings.map((finding) => (
							<ReviewerCard key={finding.id} finding={finding} />
						))}
					</div>
				</details>
			)}

			<DecisionsSection projectId={cwd} />
		</div>
	);
}
