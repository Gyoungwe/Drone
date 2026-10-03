import {
	type TaskDecisionLang,
	type TaskView,
	taskActionCommand,
	taskDecision,
	type WorkbenchTask,
} from "@drone/shared";
import { useState } from "react";
import { getPi } from "../../api";
import { useI18nStore } from "../../i18n";

/**
 * The chat decision. The side pane keeps the full ledger.
 * “先不验收，继续后面的” sends the same “继续” the host already understands.
 */
export function TaskDecisionCard({
	task,
	view,
	sessionId,
	agentActive,
}: {
	task: WorkbenchTask;
	view: TaskView;
	sessionId: string | null;
	agentActive: boolean;
}) {
	const language = useI18nStore((state) => state.language) as TaskDecisionLang;
	const decision = taskDecision(task, language === "en" ? "en" : "zh");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const send = async (text: string) => {
		if (!sessionId) return;
		setBusy(true);
		setError("");
		try {
			await getPi().prompt(sessionId, text);
		} catch (cause) {
			setError(String(cause));
		} finally {
			setBusy(false);
		}
	};
	if (decision.mode === "line") {
		return (
			<p className="mt-2 text-[12px] text-ink-dim" data-testid="task-decision-line">
				{decision.line}
			</p>
		);
	}
	return (
		<section
			className="mt-2 rounded-xl border border-amber-500/35 bg-surface px-3 py-2"
			data-testid="task-decision"
		>
			<h4 className="text-[13px] font-medium leading-5 text-ink">{decision.title}</h4>
			<p className="mt-1 text-[12px] leading-5 text-ink">{decision.stop}</p>
			<p className="text-[12px] leading-5 text-ink-dim">{decision.done}</p>
			<p className="text-[12px] leading-5 text-ink-dim">{decision.remaining}</p>
			{decision.cannotComplete && (
				<p className="mt-1 text-[12px] leading-5 text-ink-dim">{decision.cannotComplete}</p>
			)}
			<div className="mt-2 flex flex-wrap gap-1.5">
				{decision.canComplete && decision.completeActionId && (
					<button
						type="button"
						disabled={busy || !sessionId || agentActive}
						className="rounded-md border border-border bg-surface px-2 py-1 text-[11px] text-ink-2 hover:bg-hover disabled:opacity-40"
						onClick={() => {
							const actionId = decision.completeActionId;
							if (!actionId) return;
							void send(taskActionCommand(view, task.id, "acknowledge", { actionId }));
						}}
					>
						{decision.completeLabel}
					</button>
				)}
				{decision.canDefer && (
					<button
						type="button"
						disabled={busy || !sessionId || agentActive}
						className="rounded-md bg-amber-500/10 px-2 py-1 text-[11px] text-amber-600 disabled:opacity-40"
						onClick={() => void send("继续")}
					>
						{decision.deferLabel}
					</button>
				)}
				{decision.canEnd && (
					<button
						type="button"
						disabled={busy || !sessionId || agentActive}
						className="rounded-md border border-border px-2 py-1 text-[11px] text-ink-dim hover:bg-hover disabled:opacity-40"
						onClick={() => void send(taskActionCommand(view, task.id, "cancel"))}
					>
						{decision.endLabel}
					</button>
				)}
			</div>
			<details className="mt-2">
				<summary className="cursor-pointer text-[11px] text-ink-dim">{decision.detailsLabel}</summary>
				<ul className="mt-1 space-y-0.5">
					{decision.details.map((line) => (
						<li key={line} className="text-[11px] leading-4 text-ink-dim">
							{line}
						</li>
					))}
				</ul>
			</details>
			{error && (
				<p role="alert" className="mt-1 text-[11px] text-red-500">
					{error}
				</p>
			)}
		</section>
	);
}
