import {
	deriveProcessLaneTurns,
	deriveRunInspectors,
	deriveTurnTimings,
	deriveTurnUsage,
	initialProcessLaneState,
} from "@drone/shared";
import { useMemo, useState } from "react";
import { useT } from "../../i18n";
import { selectTranscript, useTranscriptStore } from "../../stores/transcript";
import { useUiStore } from "../../stores/ui";
import { ProcessLaneView } from "./ProcessLaneView";
import { ReviewerCard } from "./ReviewerCard";

/** Public transcript receipts projected into six lanes, with historical turn navigation. */
export function ProcessPane({ sessionId }: { sessionId: string | null }) {
	const t = useT();
	const transcript = useTranscriptStore((s) => selectTranscript(s, sessionId));
	const messages = useMemo(() => {
		const stream = transcript.streaming;
		if (!stream) return transcript.messages;
		const timestamp = transcript.messages.at(-1)?.timestamp ?? 0;
		return [
			...transcript.messages,
			{
				kind: "assistant" as const,
				id: stream.id,
				text: stream.text,
				thinking: "",
				tools: stream.tools,
				timestamp,
				progress: stream.progress,
				usage: stream.usage,
			},
			...(stream.subagentRuns.length
				? [{ kind: "subagent" as const, id: `${stream.id}-subagents`, runs: stream.subagentRuns, timestamp }]
				: []),
		];
	}, [transcript.messages, transcript.streaming]);
	const inspectors = useMemo(() => deriveRunInspectors(messages), [messages]);
	const timings = useMemo(
		() => deriveTurnTimings(messages, transcript.runEndedAt),
		[messages, transcript.runEndedAt],
	);
	const usages = useMemo(() => deriveTurnUsage(messages), [messages]);
	const turns = useMemo(() => deriveProcessLaneTurns(messages), [messages]);
	const focus = useUiStore((s) => s.processFocus);
	const clearFocus = useUiStore((s) => s.clearProcessFocus);
	const openPanel = useUiStore((s) => s.openPanel);
	const [selection, setSelection] = useState<{ sessionId: string | null; index: number } | null>(null);
	const requested =
		focus?.turnIndex ?? (selection?.sessionId === sessionId ? selection.index : turns.length - 1);
	const index = Math.max(0, Math.min(requested, turns.length - 1));
	const laneState = turns[index] ?? initialProcessLaneState();

	if (!sessionId || messages.length === 0) return <p className="panel-empty">{t("panel.processEmpty")}</p>;
	return (
		<div className="context-pane">
			{turns.length > 0 ? (
				<select
					className="process-turn-select"
					aria-label={t("panel.processLanes.selectTurn")}
					value={index}
					onChange={(event) => setSelection({ sessionId, index: Number(event.target.value) })}
				>
					{turns.map((turn) => (
						<option key={turn.turnIndex} value={turn.turnIndex}>
							{t("panel.turn", { n: turn.turnIndex + 1 })}
						</option>
					))}
				</select>
			) : null}
			<ProcessLaneView
				key={sessionId}
				state={laneState}
				inspectors={inspectors}
				timings={timings}
				usages={usages}
				processFocus={focus}
				onProcessFocusCleared={() => {
					if (focus) setSelection({ sessionId, index: focus.turnIndex });
					clearFocus();
				}}
				onOpenTask={() => openPanel("tasks")}
				onOpenReconcile={() => openPanel("tasks")}
			/>
			{transcript.reviewerFindings.length ? (
				<section className="reviewer-cards" aria-label={t("process.reviewerTitle")}>
					{transcript.reviewerFindings.map((finding) => (
						<ReviewerCard key={finding.id} finding={finding} />
					))}
				</section>
			) : null}
		</div>
	);
}
