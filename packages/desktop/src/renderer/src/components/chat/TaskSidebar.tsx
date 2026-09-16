import {
	explainTaskReason,
	TASK_STATE_LABELS,
	type TaskView,
	TERMINAL_TASK_STATES,
	taskNeedsUser,
	type WorkbenchTask,
} from "@drone/shared";
import { useT } from "../../i18n";
import { useSessionsStore } from "../../stores/sessions";
import { selectTranscript, useTranscriptStore } from "../../stores/transcript";
import { useUiStore } from "../../stores/ui";
import { CloseIcon } from "../icons";

/**
 * 任务工作台侧栏：常驻显示「最新一份」TaskView 的进度面。
 *
 * 与聊天流里的工作台卡是同一份数据的两个投影：
 * - 流内卡只在需要用户拍板或任务收尾时出现，是时间线上的审计记录（授权绑定契约哈希）
 * - 本侧栏只读，展示随时在变的进度：阶段、调用预算、里程碑、操作流水
 *
 * 只读是有意的：这里不放任何授权入口。一个脱离上下文、始终悬浮的「同意」按钮
 * 会让用户无法回答「我当时批准的是哪一份契约」。
 */
function TaskRow({ task, limits }: { task: WorkbenchTask; limits: TaskView["limits"] }) {
	const pct = Math.min(100, Math.round((task.budget.calls / Math.max(1, limits.totalCalls)) * 100));
	const done = task.milestones.filter((m) => m.state === "done").length;
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
				阶段 {task.stage} · 调用 {task.budget.calls}/{limits.totalCalls}
				{task.milestones.length > 0 && ` · 里程碑 ${done}/${task.milestones.length}`}
			</p>
			{!TERMINAL_TASK_STATES.has(task.state) && (
				<div className="mt-2 h-1 overflow-hidden rounded-full bg-hover" aria-hidden="true">
					<div
						className={`h-full rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none ${
							pct >= 85 ? "bg-amber-500" : "bg-green-500"
						}`}
						style={{ width: `${pct}%` }}
					/>
				</div>
			)}
			{reason && <p className="mt-2 text-[11px] text-ink-dim">{reason}</p>}
			{taskNeedsUser(task) && (
				/* 可点击：长对话里那张卡早被滚过去了，给一个回到它的入口 */
				<button
					type="button"
					className="mt-2 w-full rounded-md bg-amber-500/10 px-2 py-1 text-left text-[11px] text-amber-600 hover:bg-amber-500/20 dark:text-amber-400"
					onClick={() => {
						const el = document.querySelector(`[data-task-id="${CSS.escape(task.id)}"]`);
						if (!el) return;
						el.scrollIntoView({
							block: "center",
							behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
						});
						el.classList.remove("jump-flash");
						void (el as HTMLElement).offsetWidth; // reflow 重播动画
						el.classList.add("jump-flash");
						setTimeout(() => el.classList.remove("jump-flash"), 1200);
					}}
				>
					等待你确认 · 点此跳转 →
				</button>
			)}
			{!!task.milestones.length && (
				<ul className="mt-2 space-y-1">
					{task.milestones.map((m) => (
						<li key={m.id} className="flex items-start gap-1.5 text-[11px] leading-4">
							<span className={m.state === "done" ? "text-green-500" : "text-ink-dim"}>
								{m.state === "done" ? "\u2713" : "\u25cb"}
							</span>
							<span className={m.state === "done" ? "text-ink-dim line-through" : ""}>{m.title}</span>
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
		<aside className={`diff-sidebar${open ? " open" : ""}`} aria-hidden={!open} data-testid="task-sidebar">
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
							<TaskRow key={task.id} task={task} limits={latest.limits} />
						))
					)}
				</div>
			</div>
		</aside>
	);
}
