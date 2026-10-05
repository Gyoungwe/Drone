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
import { formatCardText } from "../session/format-card-text";

/**
 * The task decision is also embedded in the route card. Keeping the action logic here means
 * chat, route and task-panel entry points all use the same taskActionCommand protocol.
 */
export function TaskDecisionCard({
	task,
	view,
	sessionId,
	agentActive,
	embedded = false,
}: {
	task: WorkbenchTask;
	view: TaskView;
	sessionId: string | null;
	agentActive: boolean;
	embedded?: boolean;
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
	const content = (
		<>
			<h4 className="text-[13px] font-medium leading-5 text-ink">{formatCardText(decision.title)}</h4>
			<p className="mt-1 whitespace-pre-wrap text-[12px] leading-5 text-ink">
				{formatCardText(decision.stop)}
			</p>
			<p className="whitespace-pre-wrap text-[12px] leading-5 text-ink-dim">
				{formatCardText(decision.done)}
			</p>
			<p className="whitespace-pre-wrap text-[12px] leading-5 text-ink-dim">
				{formatCardText(decision.remaining)}
			</p>
			{decision.cannotComplete && (
				<p className="mt-1 whitespace-pre-wrap text-[12px] leading-5 text-ink-dim">
					{formatCardText(decision.cannotComplete)}
				</p>
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
				<ul className="mt-1 list-disc space-y-0.5 pl-4">
					{decision.details.map((line) => (
						<li key={line} className="whitespace-pre-wrap text-[11px] leading-4 text-ink-dim">
							{formatCardText(line)}
						</li>
					))}
				</ul>
			</details>
			{error && (
				<p role="alert" className="mt-1 whitespace-pre-wrap text-[11px] text-red-500">
					{formatCardText(error)}
				</p>
			)}
		</>
	);
	if (decision.mode === "line") {
		return (
			<p
				className={
					embedded ? "mt-2 whitespace-pre-wrap text-[12px] text-ink-dim" : "mt-2 text-[12px] text-ink-dim"
				}
				data-testid="task-decision-line"
			>
				{formatCardText(decision.line)}
			</p>
		);
	}
	return embedded ? (
		<div className="mt-3 border-t border-border/70 pt-3" data-testid="task-decision">
			{content}
		</div>
	) : (
		<section
			className="mt-2 rounded-xl border border-amber-500/35 bg-surface px-3 py-2"
			data-testid="task-decision"
		>
			{content}
		</section>
	);
}
