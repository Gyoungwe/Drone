import {
	explainTaskReason,
	TASK_STATE_LABELS,
	type TaskView,
	TERMINAL_TASK_STATES,
	taskActionCommand,
	type WorkbenchTask,
} from "@drone/shared";
import { useState } from "react";
import { getPi } from "../../api";
import { useT } from "../../i18n";
import { useSessionsStore } from "../../stores/sessions";
import { selectTranscript, useTranscriptStore } from "../../stores/transcript";
import { useUiStore } from "../../stores/ui";
import { CloseIcon } from "../icons";
import { TaskArtifactLinks } from "./TaskArtifactLinks";

/**
 * 任务工作台侧栏：常驻显示「最新一份」TaskView 的进度面。
 *
 * 与聊天流里的工作台卡是同一份数据的两个投影：
 * - 流内卡只在需要用户拍板或任务收尾时出现，是时间线上的审计记录（授权绑定契约哈希）
 * - 本侧栏展示随时在变的进度：阶段、调用预算、里程碑、操作流水
 *
 * 授权入口只触发 ask_user，绝不直接同意；宿主问题展示并绑定准确的任务契约版本。
 */
export function TaskRow({
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
	const [busy, setBusy] = useState(false),
		[error, setError] = useState("");
	const done = task.milestones.filter((m) => m.state === "completed").length;
	const pct = task.milestones.length ? Math.round((done / task.milestones.length) * 100) : 0;
	const reason = explainTaskReason(task.reason);
	return (
		<article className="border-b border-border p-3 last:border-0">
			<div className="flex items-start justify-between gap-2">
				<h4 className="min-w-0 break-words text-[13px] font-medium leading-5">{task.goal}</h4>
				<span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px]">
					{TASK_STATE_LABELS[task.state]}
				</span>
			</div>
			<p className="mt-1 text-[11px] text-ink-dim">
				已执行 {task.budget.calls} 步
				{task.milestones.length > 0 && ` · 已验收 ${done}/${task.milestones.length}`}
			</p>
			{task.milestones.length > 0 && (
				<div
					className="mt-2 h-1 overflow-hidden rounded-full bg-hover"
					role="progressbar"
					aria-label="交付验收进度"
					aria-valuemin={0}
					aria-valuemax={100}
					aria-valuenow={pct}
					aria-valuetext={`已验收 ${done}/${task.milestones.length} 项`}
				>
					<div
						className={`h-full rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none ${
							pct < 100 ? "bg-amber-500" : "bg-green-500"
						}`}
						style={{ width: `${pct}%` }}
					/>
				</div>
			)}
			{reason && <p className="mt-2 text-[11px] text-ink-dim">{reason}</p>}
			<p className="mt-2 whitespace-pre-wrap text-[11px] leading-5" data-testid="task-remaining-summary">
				{task.remainingSummary ||
					(task.milestones.length
						? "还有几项没确认完成；这是较早的记录，先核对一下已有结果，别重复生成。"
						: "还没约定要交付什么，暂不显示进度。")}
			</p>
			{!TERMINAL_TASK_STATES.has(task.state) && (
				<button
					type="button"
					disabled={busy || agentActive || !sessionId}
					className="mt-2 w-full rounded-md bg-amber-500/10 px-2 py-2 text-left text-xs text-amber-600 disabled:opacity-40"
					onClick={async () => {
						if (!sessionId) return;
						setBusy(true);
						setError("");
						try {
							await getPi().prompt(sessionId, taskActionCommand(view, task.id, "progress"));
						} catch (e) {
							setError(String(e));
						} finally {
							setBusy(false);
						}
					}}
				>
					继续做剩下的
				</button>
			)}
			{error && (
				<p role="alert" className="text-xs text-red-500">
					{error}
				</p>
			)}
			<TaskArtifactLinks task={task} sessionId={sessionId} />
			{!!task.milestones.length && (
				<ul className="mt-2 space-y-1">
					{task.milestones.map((m) => (
						<li key={m.id} className="flex items-start gap-1.5 text-[11px] leading-4">
							<span className={m.state === "completed" ? "text-green-500" : "text-ink-dim"}>
								{m.state === "completed" ? "\u2713" : "\u25cb"}
							</span>
							<span className={m.state === "completed" ? "text-ink-dim line-through" : ""}>{m.title}</span>
						</li>
					))}
				</ul>
			)}
			{!!task.operations.length && (
				<details className="mt-2">
					<summary className="cursor-pointer text-[11px] text-ink-dim">
						操作记录 {task.operations.length}
					</summary>
					<ul className="mt-1 space-y-0.5">
						{task.operations.slice(-12).map((o) => (
							<li key={o.id} className="truncate text-[11px] text-ink-dim">
								<code>{o.tool}</code> · {o.state}
							</li>
						))}
					</ul>
				</details>
			)}
		</article>
	);
}

export function TaskSidebar() {
	const t = useT();
	const open = useUiStore((s) => s.taskSidebarOpen);
	const setOpen = useUiStore((s) => s.setTaskSidebarOpen);
	const activeSessionId = useSessionsStore((s) => s.activeSessionId);
	const transcript = useTranscriptStore((s) => selectTranscript(s, activeSessionId));
	// 只取最新一份：TaskView 每次 revision 都是全量快照，历史版本没有展示价值
	const latestMessage = [...transcript.messages].reverse().find((m) => m.kind === "assistant" && m.taskView);
	const latest = latestMessage?.kind === "assistant" ? latestMessage.taskView : undefined;
	return (
		<aside
			id="task-workbench-sidebar"
			className={`diff-sidebar${open ? " open" : ""}`}
			aria-hidden={!open}
			data-testid="task-sidebar"
		>
			<div className="diff-sidebar-in">
				<div className="diff-side-head">
					<span className="diff-side-title">任务工作台</span>
					{latest && <span className="diff-side-sum">v{latest.revision}</span>}
					<button
						type="button"
						className="diff-side-close"
						onClick={() => setOpen(false)}
						aria-label={t("common.close")}
					>
						<CloseIcon />
					</button>
				</div>
				<div className="diff-side-scroll">
					{!latest || latest.tasks.length === 0 ? (
						<div className="diff-side-empty">尚无任务。发送具体需求后会建立宿主任务记录。</div>
					) : (
						latest.tasks.map((task: WorkbenchTask) => (
							<TaskRow
								key={task.id}
								task={task}
								view={latest}
								sessionId={activeSessionId}
								agentActive={transcript.agentActive}
							/>
						))
					)}
				</div>
			</div>
		</aside>
	);
}
