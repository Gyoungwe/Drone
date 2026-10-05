import type { AskResponse, DecisionRecord, TodoItem } from "@drone/shared";
import { useEffect, useState } from "react";
import { getPi } from "../../api";
import { useSessionReadOnly } from "../../hooks/use-session-state";
import { useT } from "../../i18n";
import { Slot } from "../../plugins/Slot";
import { UI_SLOTS } from "../../plugins/slots";
import { useSessionsStore } from "../../stores/sessions";
import { EMPTY_TODOS, selectTranscript, useTranscriptStore } from "../../stores/transcript";
import { TaskRow } from "../chat/TaskRow";
import { TodoCompleteIcon, TodoPendingIcon, TodoSpinnerIcon } from "../icons";
import { AskDialog } from "../session/AskDialog";
import { useAgentActive } from "../session/session-status";
import { ExampleTaskCards } from "../tasks/ExampleTaskCards";
import { decisionConfirmationChoice, decisionConfirmationRequest } from "./decision-confirm";

function TodoLine({ todo, spinnerPaused }: { todo: TodoItem; spinnerPaused: boolean }) {
	if (todo.status === "completed") {
		return (
			<li className="flex items-start gap-2 px-1 py-1">
				<TodoCompleteIcon size={14} className="mt-[3px] shrink-0 text-green-500" />
				<span className="min-w-0 flex-1 break-words text-[13px] leading-5 text-ink-dim line-through">
					{todo.content}
				</span>
			</li>
		);
	}
	if (todo.status === "in_progress") {
		return (
			<li className="flex items-start gap-2 px-1 py-1">
				<TodoSpinnerIcon
					size={14}
					className={`mt-[3px] shrink-0 animate-spin ${
						spinnerPaused ? "text-ink-faint [animation-play-state:paused]" : "text-ink-2"
					}`}
				/>
				<span className="min-w-0 flex-1 break-words text-[13px] leading-5 font-medium text-ink">
					{todo.content}
				</span>
			</li>
		);
	}
	return (
		<li className="flex items-start gap-2 px-1 py-1">
			<TodoPendingIcon size={14} className="mt-[3px] shrink-0 text-ink-faint" />
			<span className="min-w-0 flex-1 break-words text-[13px] leading-5 text-ink-2">{todo.content}</span>
		</li>
	);
}

function DecisionsSection({ projectId }: { projectId: string | null }) {
	const t = useT();
	const [decisions, setDecisions] = useState<readonly DecisionRecord[]>([]);
	const [busyId, setBusyId] = useState<string | null>(null);
	const [confirmedIds, setConfirmedIds] = useState<ReadonlySet<string>>(new Set());
	const [confirmation, setConfirmation] = useState<{
		decision: DecisionRecord;
		action: "revoke" | "confirm";
	} | null>(null);

	useEffect(() => {
		let disposed = false;
		if (!projectId) {
			setDecisions([]);
			setConfirmedIds(new Set());
			return () => {
				disposed = true;
			};
		}
		void getPi()
			.list(projectId)
			.then((next) => {
				if (!disposed) {
					setDecisions(next);
					setConfirmedIds(new Set());
				}
			})
			.catch(() => {
				if (!disposed) setDecisions([]);
			});
		return () => {
			disposed = true;
		};
	}, [projectId]);

	const apply = async () => {
		const pending = confirmation;
		if (!pending || busyId) return;
		setConfirmation(null);
		const { decision, action } = pending;
		setBusyId(decision.id);
		try {
			if (action === "revoke") {
				const revoked = await getPi().revoke(decision.id, t("panel.decisionRevokeReason"));
				setDecisions((current) => current.map((item) => (item.id === revoked.id ? revoked : item)));
			} else {
				await getPi().confirm(decision.id, t("panel.decisionConfirmReview"));
				setConfirmedIds((current) => new Set(current).add(decision.id));
			}
		} finally {
			setBusyId(null);
		}
	};
	const confirmationRequest = confirmation
		? decisionConfirmationRequest(confirmation.decision, confirmation.action, {
				title: t("panel.decisionConfirmTitle"),
				message: t("panel.decisionConfirmMessage", {
					action:
						confirmation.action === "revoke"
							? t("panel.decisionRevoke").toLowerCase()
							: t("panel.decisionConfirmReview").toLowerCase(),
				}),
				confirm: t("panel.decisionConfirmAction"),
				cancel: t("panel.decisionCancel"),
			})
		: null;
	const respondConfirmation = async (_requestId: string, response: AskResponse) => {
		if (decisionConfirmationChoice(response) === "confirm") await apply();
		else setConfirmation(null);
	};

	return (
		<section className="panel-card" data-testid="decisions-section">
			<header className="flex items-center gap-2">
				<span className="text-[12px] font-medium text-ink">{t("panel.decisionsTitle")}</span>
				<span className="text-[11px] tabular-nums text-ink-faint">{decisions.length}</span>
			</header>
			{decisions.length === 0 ? (
				<p className="mt-1 text-[11px] text-ink-faint">{t("panel.decisionsEmpty")}</p>
			) : (
				<ul className="mt-2 space-y-2">
					{decisions.map((decision) => (
						<li
							key={decision.id}
							className="rounded-md border border-edge/60 px-2 py-1.5"
							data-testid="decision-row"
						>
							<div className="flex items-start gap-2">
								<div className="min-w-0 flex-1">
									<p className="break-words text-[12px] text-ink">{decision.summary}</p>
									<p className="text-[11px] text-ink-faint">
										{t("panel.decisionAffected", { count: decision.affectedArtifactIds.length })} ·{" "}
										{decision.kind}
									</p>
								</div>
								{decision.status === "active" ? (
									<button
										type="button"
										className="shrink-0 text-[11px] text-err hover:underline disabled:opacity-50"
										disabled={busyId !== null}
										onClick={() => setConfirmation({ decision, action: "revoke" })}
									>
										{busyId === decision.id ? t("panel.decisionRevoking") : t("panel.decisionRevoke")}
									</button>
								) : confirmedIds.has(decision.id) ? (
									<span className="shrink-0 text-[11px] text-ink-faint">{t("panel.decisionConfirmed")}</span>
								) : (
									<button
										type="button"
										className="shrink-0 text-[11px] text-accent hover:underline disabled:opacity-50"
										disabled={busyId !== null}
										onClick={() => setConfirmation({ decision, action: "confirm" })}
									>
										{busyId === decision.id ? t("panel.decisionRevoking") : t("panel.decisionConfirmReview")}
									</button>
								)}
							</div>
						</li>
					))}
				</ul>
			)}
			{confirmationRequest && <AskDialog requests={[confirmationRequest]} onRespond={respondConfirmation} />}
		</section>
	);
}

/** 任务清单卡（UI_SLOTS.TodoPanel 的默认实现：插件可整体替换；原悬浮胶囊改为面板内卡片） */
export function TodoCard() {
	const t = useT();
	const sessionId = useSessionsStore((s) => s.activeSessionId);
	const todos =
		useTranscriptStore((s) => (sessionId ? s.bySession[sessionId]?.todos : undefined)) ?? EMPTY_TODOS;
	const agentActive = useAgentActive(sessionId);
	if (todos.length === 0) return null;
	const done = todos.filter((x) => x.status === "completed").length;
	const pct = Math.round((done / todos.length) * 100);
	return (
		<section className="panel-card" data-testid="todo-card">
			<header className="flex items-center gap-2">
				<span className="text-[12px] font-medium text-ink">{t("panel.todoTitle")}</span>
				<span className="text-[11px] tabular-nums text-ink-faint">
					{done}/{todos.length}
				</span>
				<span className="ml-auto text-[11px] tabular-nums text-ink-faint">{pct}%</span>
			</header>
			<div className="mt-2 h-1 overflow-hidden rounded-full bg-hover" role="progressbar" aria-valuenow={pct}>
				<div
					className="h-full rounded-full bg-green-500 transition-[width] duration-500 ease-out motion-reduce:transition-none"
					style={{ width: `${pct}%` }}
				/>
			</div>
			<ul className="mt-1.5">
				{todos.map((todo, i) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: 全量替换列表无稳定 id，顺序稳定
					<TodoLine key={i} todo={todo} spinnerPaused={!agentActive} />
				))}
			</ul>
		</section>
	);
}

/**
 * 「任务」页签：待确认提示 → 任务清单（todo，带进度条）→ 任务契约（最新一份 TaskView 的任务卡）。
 * 审批本身仍在输入框位置的 ApprovalDock 决策（一处一事），这里只给指向。
 * 空态给六方向示例卡（只读会话除外）：点击只打开示例对话框，任务仍由 task_plan + 授权卡建立。
 */
export function TasksPane({ sessionId }: { sessionId: string | null }) {
	const t = useT();
	const todoCount = useTranscriptStore((s) => (sessionId ? (s.bySession[sessionId]?.todos.length ?? 0) : 0));
	const pendingCount = useTranscriptStore((s) => selectTranscript(s, sessionId).pendingPermissions.length);
	const messages = useTranscriptStore((s) => selectTranscript(s, sessionId).messages);
	const agentActive = useAgentActive(sessionId);
	const readOnly = useSessionReadOnly();
	const projectId = useSessionsStore((s) => s.cwd);
	const latestMessage = [...messages].reverse().find((m) => m.kind === "assistant" && m.taskView);
	const view = latestMessage?.kind === "assistant" ? latestMessage.taskView : undefined;
	const empty = todoCount === 0 && !(view && view.tasks.length > 0);

	return (
		<div className="context-pane">
			{pendingCount > 0 && (
				<div className="panel-card border-amber-500/40 bg-amber-500/5 text-[12px] text-amber-700">
					{t("panel.approvalPending")}
				</div>
			)}
			<Slot name={UI_SLOTS.TodoPanel} props={{}} fallback={TodoCard} />
			<DecisionsSection projectId={projectId} />
			{view && view.tasks.length > 0 && (
				<section className="panel-card">
					<header className="flex items-center gap-2">
						<span className="text-[12px] font-medium text-ink">{t("panel.taskViewTitle")}</span>
						<span className="text-[11px] tabular-nums text-ink-faint">{view.tasks.length}</span>
					</header>
					<div className="mt-1">
						{view.tasks.map((task) => (
							<TaskRow
								key={task.id}
								task={task}
								view={view}
								sessionId={sessionId}
								agentActive={agentActive}
							/>
						))}
					</div>
				</section>
			)}
			{empty && (readOnly ? <p className="panel-empty">{t("panel.tasksEmpty")}</p> : <ExampleTaskCards />)}
		</div>
	);
}
