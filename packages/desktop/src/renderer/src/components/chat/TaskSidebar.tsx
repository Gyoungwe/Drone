import {
	explainTaskReason,
	type TaskView,
	taskActionCommand,
	taskDeliveryPresentation,
	type WorkbenchTask,
} from "@drone/shared";
import { useState } from "react";
import { getPi } from "../../api";
import { useT } from "../../i18n";
import { useSessionsStore } from "../../stores/sessions";
import { useSettingsStore } from "../../stores/settings";
import { selectTranscript, useTranscriptStore } from "../../stores/transcript";
import { useUiStore } from "../../stores/ui";
import { ChevronDownIcon, CloseIcon, ShieldIcon, SubagentIcon, TaskBoardIcon } from "../icons";
import { TaskArtifactLinks } from "./TaskArtifactLinks";

/**
 * 任务工作台侧栏：常驻显示「最新一份」TaskView 的进度面。
 *
 * 聊天流隐藏 task status 消息；本侧栏展示阶段、调用预算、里程碑、操作流水。
 * task_plan 显式建立任务契约；用户授权通过弹窗完成。
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
				<span className="shrink-0 rounded-full border border-border px-1.5 py-0.5 text-[10px]">
					{presentation.label}
				</span>
			</div>
			<p className="mt-0.5 text-[10px] text-ink-dim">
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
				<p className="mt-1 truncate text-[10px] text-ink-dim" title={reason}>
					{reason}
				</p>
			)}
			<p
				className="mt-1 truncate text-[10px] leading-4"
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
				<p role="alert" className="text-[10px] text-red-500">
					{error}
				</p>
			)}
			<TaskArtifactLinks task={task} sessionId={sessionId} />
			{!!task.milestones.length && (
				<details className="mt-1.5">
					<summary className="cursor-pointer text-[10px] text-ink-dim">
						验收项 {done}/{task.milestones.length}
					</summary>
					<ul className="mt-1 space-y-0.5">
						{task.milestones.map((m) => (
							<li key={m.id} className="flex items-start gap-1.5 text-[10px] leading-4">
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
					<summary className="cursor-pointer text-[10px] text-ink-dim">
						操作记录 {task.operations.length}
					</summary>
					<ul className="mt-1 space-y-0.5">
						{task.operations.slice(-12).map((o) => (
							<li key={o.id} className="truncate text-[10px] text-ink-dim">
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
	const activeSession = useSessionsStore((s) =>
		s.sessions.find((session) => session.sessionId === s.activeSessionId),
	);
	const currentModel = useSessionsStore((s) => s.currentModel);
	const models = useSessionsStore((s) => s.models);
	const skills = useSettingsStore((s) => s.skills);
	const capabilities = useSettingsStore((s) => s.capabilities);
	const transcript = useTranscriptStore((s) => selectTranscript(s, activeSessionId));
	// 只取最新一份：TaskView 每次 revision 都是全量快照，历史版本没有展示价值
	const latestMessage = [...transcript.messages].reverse().find((m) => m.kind === "assistant" && m.taskView);
	const latest = latestMessage?.kind === "assistant" ? latestMessage.taskView : undefined;
	const effectiveModel = activeSession?.model ?? currentModel;
	const modelLabel = effectiveModel
		? (models.find(
				(model) => model.provider === effectiveModel.provider && model.id === effectiveModel.modelId,
			)?.label ?? effectiveModel.modelId)
		: t("workbench.modelNotSelected");
	return (
		<aside
			id="task-workbench-sidebar"
			className={`diff-sidebar task-sidebar${open ? " open" : ""}`}
			aria-hidden={!open}
			data-testid="task-sidebar"
		>
			<div className="diff-sidebar-in sunburst-sidebar-in">
				<div className="diff-side-head sunburst-sidebar-head">
					<div className="min-w-0">
						<div className="flex items-center gap-2">
							<TaskBoardIcon size={15} />
							<span className="diff-side-title">{t("workbench.task.title")}</span>
						</div>
						{latest && (
							<span className="diff-side-sum">
								{latest.tasks.length} {t("workbench.task.count")}
							</span>
						)}
					</div>
					<button
						type="button"
						className="diff-side-close"
						onClick={() => setOpen(false)}
						aria-label={t("common.close")}
					>
						<CloseIcon />
					</button>
				</div>
				<div className="diff-side-scroll sunburst-sidebar-scroll">
					<section className="sunburst-card">
						<div className="sunburst-card-head">
							<span>{t("workbench.task.title")}</span>
							{latest && <span className="sunburst-card-meta">v{latest.revision}</span>}
						</div>
						<div className="sunburst-card-body p-0">
							{!latest || latest.tasks.length === 0 ? (
								<div className="diff-side-empty">尚无任务。模型制定执行计划后，任务进度会显示在这里。</div>
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
					</section>

					<section className="sunburst-card sunburst-ssh-card">
						<button
							type="button"
							className="sunburst-card-head w-full text-left"
							onClick={() => useSettingsStore.getState().openWith("general")}
						>
							<span className="flex items-center gap-2">
								<ShieldIcon size={15} />
								{t("settings.sshGuard.title")}
							</span>
							<span className="sunburst-status-warn">{t("workbench.approvalRequired")}</span>
							<ChevronDownIcon size={11} />
						</button>
						<div className="sunburst-card-body">
							<p className="text-[11px] leading-4 text-ink-dim">{t("workbench.sshSummary")}</p>
							<div className="sunburst-ssh-detail">
								<span>{t("settings.sshGuard.keys")}</span>
								<strong>{t("workbench.localOpenSsh")}</strong>
							</div>
							<button
								type="button"
								className="sunburst-link"
								onClick={() => useSettingsStore.getState().openWith("general")}
							>
								{t("workbench.reviewGuard")}
							</button>
						</div>
					</section>

					<section className="sunburst-card">
						<button
							type="button"
							className="sunburst-card-head w-full text-left"
							onClick={() => useSettingsStore.getState().openWith("skills")}
						>
							<span className="flex items-center gap-2">
								<SubagentIcon size={15} />
								{t("workbench.skills.title")}
							</span>
							<span className="sunburst-card-meta">{skills ? skills.length : "—"}</span>
						</button>
						<div className="sunburst-card-body">
							<div className="sunburst-chip-list">
								{skills?.slice(0, 6).map((skill) => (
									<span key={skill.name}>{skill.name}</span>
								))}
								{!skills && <span>{t("workbench.skills.loading")}</span>}
								{skills && skills.length > 6 && <span>+{skills.length - 6}</span>}
							</div>
						</div>
					</section>

					<section className="sunburst-card">
						<button
							type="button"
							className="sunburst-card-head w-full text-left"
							onClick={() => useSettingsStore.getState().openWith("models")}
						>
							<span>{t("workbench.modelTools")}</span>
							<span className="sunburst-status-ok">
								{capabilities ? t("workbench.online") : t("workbench.ready")}
							</span>
						</button>
						<div className="sunburst-card-body grid grid-cols-2 gap-2">
							<div>
								<span className="sunburst-label">{t("workbench.model")}</span>
								<strong className="truncate" title={modelLabel}>
									{modelLabel}
								</strong>
							</div>
							<div>
								<span className="sunburst-label">{t("workbench.tools")}</span>
								<strong>{capabilities?.tools.length ?? "—"}</strong>
							</div>
						</div>
					</section>

					<div className="sunburst-note-card">
						<div className="flex items-center gap-2 font-medium text-ink">
							<ShieldIcon size={14} />
							{t("workbench.controlTitle")}
						</div>
						<p className="mt-1 text-[10px] leading-4 text-ink-dim">{t("workbench.controlHint")}</p>
					</div>
				</div>
			</div>
		</aside>
	);
}
