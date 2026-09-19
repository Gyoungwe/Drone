import {
	explainTaskReason,
	type TaskView,
	taskActionCommand,
	taskDeliveryPresentation,
	type WorkbenchTask,
} from "@drone/shared";
import { useState } from "react";
import { getPi } from "../../api";
import { TaskArtifactLinks } from "./TaskArtifactLinks";

/**
 * 任务卡：一份 TaskView 里的单个任务（目标 / 交付状态 / 验收进度 / 继续做剩下的 / 产物链接 / 验收项 / 操作记录）。
 * 由右侧上下文面板「任务」页签渲染（原 TaskSidebar 已并入面板）。
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
	const presentation = taskDeliveryPresentation(task, agentActive);
	const remainingSummary =
		(agentActive ? "任务仍在执行；验收进度会随结果更新，无需重复发起。" : task.remainingSummary) ||
		(task.milestones.length
			? "还有几项没确认完成；这是较早的记录，先核对一下已有结果，别重复生成。"
			: "还没约定要交付什么，暂不显示进度。");
	return (
		<article className="border-b border-border px-2 py-2 last:border-0">
			<div className="flex items-start justify-between gap-2">
				<h4 className="min-w-0 break-words text-[12px] font-medium leading-4">{task.goal}</h4>
				<span className="shrink-0 rounded-full border border-border px-1.5 py-0.5 text-[11px]">
					{presentation.label}
				</span>
			</div>
			<p className="mt-0.5 text-[11px] text-ink-dim">
				已执行 {task.budget.calls} 步
				{task.milestones.length > 0 && ` · 已验收 ${done}/${task.milestones.length}`}
			</p>
			{task.milestones.length > 0 && (
				<div
					className="mt-1 h-0.5 overflow-hidden rounded-full bg-hover"
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
			{reason && (
				<p className="mt-1 truncate text-[11px] text-ink-dim" title={reason}>
					{reason}
				</p>
			)}
			<p
				className="mt-1 truncate text-[11px] leading-4"
				data-testid="task-remaining-summary"
				title={remainingSummary}
			>
				{remainingSummary}
			</p>
			{presentation.canContinue && (
				<button
					type="button"
					disabled={busy || agentActive || !sessionId}
					className="mt-1.5 w-full rounded-md bg-amber-500/10 px-2 py-1.5 text-left text-[11px] text-amber-600 disabled:opacity-40"
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
				<p role="alert" className="text-[11px] text-red-500">
					{error}
				</p>
			)}
			<TaskArtifactLinks task={task} sessionId={sessionId} />
			{!!task.milestones.length && (
				<details className="mt-1.5">
					<summary className="cursor-pointer text-[11px] text-ink-dim">
						验收项 {done}/{task.milestones.length}
					</summary>
					<ul className="mt-1 space-y-0.5">
						{task.milestones.map((m) => (
							<li key={m.id} className="flex items-start gap-1.5 text-[11px] leading-4">
								<span className={m.state === "completed" ? "text-green-500" : "text-ink-dim"}>
									{m.state === "completed" ? "\u2713" : "\u25cb"}
								</span>
								<span className={m.state === "completed" ? "text-ink-dim line-through" : ""}>{m.title}</span>
							</li>
						))}
					</ul>
				</details>
			)}
			{!!task.operations.length && (
				<details className="mt-1.5">
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
