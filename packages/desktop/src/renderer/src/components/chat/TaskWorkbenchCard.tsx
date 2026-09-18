import {
	canArchiveTask,
	explainTaskReason,
	TASK_STATE_LABELS,
	type TaskView,
	TERMINAL_TASK_STATES,
	taskActionCommand,
	taskNeedsUser,
	type WorkbenchTask,
} from "@drone/shared";
import { useState } from "react";
import { getPi } from "../../api";
import { useT } from "../../i18n";
import { selectTranscript, useTranscriptStore } from "../../stores/transcript";
import { useUiStore } from "../../stores/ui";
import { CheckIcon } from "../icons";
import { TaskArtifactLinks } from "./TaskArtifactLinks";

/**
 * 工作台详情的兼容组件。当前聊天流隐藏全部 taskView，进度由右侧任务栏承载，授权走弹窗。
 */
export function TaskWorkbenchCard({
	view,
	sessionId,
	tasks,
	expanded = false,
}: {
	view: TaskView;
	sessionId: string | null;
	tasks?: WorkbenchTask[];
	expanded?: boolean;
}) {
	const t = useT();
	const shown = tasks ?? view.tasks;
	// 有任何一项在等用户 → 整张卡走强调态（左侧强调条 + 实心底），避免混在流里被划过去
	const awaiting = shown.some(taskNeedsUser);
	const [busy, setBusy] = useState(false),
		[error, setError] = useState("");
	const [detailsOpen, setDetailsOpen] = useState(false);
	const [paths, setPaths] = useState<Record<string, string>>({});
	const transcript = useTranscriptStore((s) => selectTranscript(s, sessionId));
	const latest = [...transcript.messages].reverse().find((m) => m.kind === "assistant" && m.taskView);
	const stale = latest?.kind === "assistant" && latest.taskView && latest.taskView.revision !== view.revision;
	const disabled = busy || !sessionId || !!stale || transcript.agentActive;
	const act = async (id: string, action: string, extra: Record<string, string> = {}) => {
		if (!sessionId) return;
		setBusy(true);
		setError("");
		try {
			await getPi().prompt(sessionId, taskActionCommand(view, id, action, extra));
		} catch (e) {
			setError(e instanceof Error ? e.message : "操作未完成，请刷新核对");
		} finally {
			setBusy(false);
		}
	};
	const button = "rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-surface disabled:opacity-40";
	// 主操作：唯一推进任务的按钮，必须一眼可见——实心琥珀、加大点击区、focus 环。
	// 次要动作（归档/取消/继续）沿用上面的幽灵样式，层级差拉开才不会让用户猜该点哪个。
	const primaryButton =
		"inline-flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white shadow-soft transition-colors hover:bg-amber-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500 disabled:opacity-40 disabled:hover:bg-amber-500";
	if (!expanded && (!awaiting || stale))
		return (
			<section
				data-testid="task-workbench"
				className="my-2 rounded-lg border border-border p-3 text-xs text-ink"
			>
				<div className="flex items-center justify-between gap-2">
					<span>
						{stale
							? "历史任务记录"
							: shown
									.map(
										(task) => `${TASK_STATE_LABELS[task.state]}${task.executionConsent ? " · 已授权" : ""}`,
									)
									.join("；")}
					</span>
					<button
						type="button"
						className={button}
						onClick={() => useUiStore.getState().setTaskSidebarOpen(true)}
					>
						查看任务侧栏
					</button>
				</div>
				{!stale &&
					shown
						.filter((task) => task.state === "partial")
						.map((task) => (
							<div key={task.id} className="mt-2" data-testid="task-remaining-compact">
								{/* 只露第一行（“已验收 N/M；剩余 K 项”），其余收进折叠。
								    remainingSummary 是逐项的「原因/下一步」多行清单，整段摊在流里就是刷屏。 */}
								<p className="text-xs">
									{(task.remainingSummary || "仍有交付项未验收，请先核对已有结果。").split("\n")[0]}
								</p>
								{(task.remainingSummary || "").includes("\n") && (
									<details className="mt-1">
										<summary className="cursor-pointer text-[11px] text-ink-dim">
											每一项差在哪、下一步做什么
										</summary>
										<p className="mt-1 whitespace-pre-wrap text-[11px] text-ink-dim">
											{task.remainingSummary}
										</p>
									</details>
								)}
								<button
									type="button"
									className={`${button} mt-2`}
									disabled={disabled}
									onClick={() => act(task.id, "progress")}
								>
									继续做剩下的
								</button>
							</div>
						))}
				{!stale && shown.map((task) => <TaskArtifactLinks key={task.id} task={task} sessionId={sessionId} />)}
				<details className="mt-2" onToggle={(event) => setDetailsOpen(event.currentTarget.open)}>
					<summary className="cursor-pointer text-ink-dim">任务详情</summary>
					{detailsOpen && <TaskWorkbenchCard view={view} sessionId={sessionId} tasks={shown} expanded />}
				</details>
			</section>
		);
	return (
		<section
			data-testid="task-workbench"
			data-awaiting={awaiting || undefined}
			className={`my-3 overflow-hidden rounded-xl border text-ink ${
				awaiting ? "border-l-4 border-amber-500 bg-surface shadow-soft" : "border-border bg-surface/50"
			}`}
		>
			<header className="flex items-center justify-between gap-3 border-b border-border p-4">
				<div>
					<h3 className="text-sm font-semibold">
						{awaiting
							? shown.some((task) => task.authorizationRequired && !task.executionConsent)
								? "需要你授权"
								: "有待处理事项"
							: "任务工作台"}
					</h3>
					<p className="mt-1 text-xs text-ink-dim">
						{awaiting ? "看看下面哪一项在等你" : "任务的进展、交付和需要你做的事都在这里"}
					</p>
				</div>
				<button
					type="button"
					className={button}
					onClick={() =>
						void getPi()
							.saveFileDialog("task-checkpoint.json", JSON.stringify(view, null, 2))
							.catch((e) => setError(String(e.message || e)))
					}
				>
					导出任务记录
				</button>
			</header>
			{view.selectionRequired && (
				<p role="status" className="border-b border-border p-3 text-sm">
					有多个任务可以继续，请先选一个，避免弄混。
				</p>
			)}
			{shown.length === 0 && (
				<p className="p-4 text-sm text-ink-dim">还没有任务。说说你想做什么，确认计划后就会出现在这里。</p>
			)}
			{shown.map((task) => (
				<article key={task.id} data-task-id={task.id} className="border-b border-border p-4 last:border-0">
					<div className="flex flex-wrap items-center justify-between gap-2">
						<h4 className="min-w-0 break-words text-sm font-medium">{task.goal}</h4>
						<span className="rounded-full border border-border px-2 py-0.5 text-xs">
							{TASK_STATE_LABELS[task.state]}
						</span>
					</div>
					<p className="mt-1 text-xs text-ink-dim">
						{task.id === view.activeTaskId ? "当前任务 · " : ""}已执行 {task.budget.calls} 步
						{task.waitMs >= 60000 ? ` · 等你 ${Math.floor(task.waitMs / 60000)} 分钟` : ""}
					</p>
					<p className="mt-1 text-xs text-ink-dim">更新于 {task.updatedAt}</p>
					<div className="mt-3 rounded-lg border border-border bg-surface p-3" data-testid="task-remaining">
						<h5 className="text-sm font-medium">交付进度</h5>
						<p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed">
							{task.remainingSummary ||
								`已验收 ${task.milestones.filter((m) => m.state === "completed").length}/${task.milestones.length} 项。这是较早的记录，没写剩下为什么没完成；先核对一下已有结果——没标完成不一定是没做出来。`}
						</p>
						{!TERMINAL_TASK_STATES.has(task.state) && (
							<button
								type="button"
								disabled={disabled}
								className={`${primaryButton} mt-3`}
								onClick={() => act(task.id, "progress")}
							>
								继续做剩下的
							</button>
						)}
						{!TERMINAL_TASK_STATES.has(task.state) && (
							<p className="mt-2 text-[11px] text-ink-dim">
								会先弹一个确认框告诉你接下来做什么；取消不影响任务。
							</p>
						)}
					</div>
					{task.reason && (
						<p className="mt-1 text-xs" data-testid="task-reason">
							{explainTaskReason(task.reason)}
						</p>
					)}
					{/* 停住的任务：恢复入口原先只藏在「手动操作」折叠里，默认收起 → 用户找不到。
					    这里提到顶部固定成一行主操作。授权块有 milestones 前提，覆盖不到这种情况。 */}
					{!task.authorizationRequired && (task.state === "waiting_user" || task.state === "blocked") && (
						<div className="mt-3 border-t border-border pt-3">
							<button
								type="button"
								disabled={disabled}
								className={primaryButton}
								onClick={() => act(task.id, "resume")}
							>
								<CheckIcon size={15} />
								继续执行
							</button>
							<p className="mt-2 text-[11px] text-ink-dim">任务停在这里了，点一下从停下的地方接着做</p>
						</div>
					)}
					{!!task.milestones.length && !task.executionConsent && !TERMINAL_TASK_STATES.has(task.state) && (
						<div className="mt-3 rounded-lg border border-border bg-surface p-3" data-testid="task-consent">
							<h5 className="text-sm font-medium">
								{t(task.executionConsent ? "taskConsent.active" : "taskConsent.title")}
							</h5>
							<p className="mt-2 whitespace-pre-wrap text-sm">{task.authorizationSummary || task.goal}</p>
							<p className="mt-2 text-xs text-ink-dim">
								{t("taskConsent.limits", { calls: view.limits.totalCalls })}
							</p>
							<p className="mt-2 text-xs">{t("taskConsent.directories")}</p>
							{task.writeRoots?.length ? (
								<ul className="mt-1 space-y-1 text-xs">
									{task.writeRoots.map((root) => (
										<li key={root} className="break-all">
											<code>{root}</code>
										</li>
									))}
								</ul>
							) : (
								<p className="mt-1 text-xs text-ink-dim">{t("taskConsent.noDirectories")}</p>
							)}
							<p className="mt-2 text-xs text-ink-dim">{t("taskConsent.boundary")}</p>
							{!task.executionConsent && (
								<button
									type="button"
									disabled={disabled}
									className={`${button} mt-3`}
									onClick={() => act(task.id, "authorize-task")}
								>
									确认并开始执行
								</button>
							)}
						</div>
					)}
					<details className="mt-3 text-xs">
						<summary className="cursor-pointer text-ink-dim">{t("taskConsent.manual")}</summary>
						<div className="mt-3 flex flex-wrap gap-2">
							<button
								type="button"
								disabled={disabled}
								className={button}
								onClick={() => act(task.id, "select")}
							>
								选择此任务
							</button>
							<button
								type="button"
								disabled={disabled}
								className={button}
								onClick={() => act(task.id, "refresh")}
							>
								核对已有结果
							</button>
							<button
								type="button"
								disabled={disabled || TERMINAL_TASK_STATES.has(task.state)}
								className={button}
								onClick={() => act(task.id, "resume")}
							>
								从上次停的地方继续
							</button>
							{!task.executionConsent && !task.authorizationRequired && (
								<button
									type="button"
									disabled={disabled || TERMINAL_TASK_STATES.has(task.state)}
									className={button}
									onClick={() => act(task.id, "next-stage")}
								>
									确认继续下一阶段
								</button>
							)}
							<button
								type="button"
								disabled={disabled || TERMINAL_TASK_STATES.has(task.state)}
								className={button}
								onClick={() => act(task.id, "cancel")}
							>
								取消任务
							</button>
							{task.state !== "archived" && (
								<button
									type="button"
									disabled={disabled || !canArchiveTask(task)}
									className={button}
									title="归档表示这个任务彻底结束。记录太多时最早归档的会被清掉，重要的先导出"
									onClick={() => act(task.id, "archive")}
								>
									归档任务
								</button>
							)}
						</div>
					</details>
					<TaskArtifactLinks task={task} sessionId={sessionId} />
					<details open={!stale && task.actions.some((a) => a.state === "pending")} className="mt-3 text-xs">
						<summary className="cursor-pointer text-ink-dim">完成标准和操作记录</summary>
						{!!task.milestones.length && (
							<div className="mt-3">
								<h5 className="font-medium">完成标准{!task.planApproved && "（待你确认）"}</h5>
								<ol className="mt-2 space-y-2">
									{task.milestones.map((m) => (
										<li key={m.id} className="rounded border border-border p-2">
											<span>
												{m.state === "completed" ? "✓" : "○"} {m.title}
											</span>
											<div className="mt-1 break-all text-ink-dim">
												{m.acceptance.kind} {m.acceptance.path} {m.acceptance.doi}{" "}
												{m.acceptance.libraryId && ` · Library ${m.acceptance.libraryId}`}{" "}
												{m.acceptance.collection && ` · Collection ${m.acceptance.collection}`}
												{m.dependsOn.length > 0 && ` · 依赖 ${m.dependsOn.join(", ")}`}
											</div>
											{m.evidence?.kind && (
												<span className="text-ink-dim">依据：{m.evidence.kind}（不等于科学正确）</span>
											)}
										</li>
									))}
								</ol>
							</div>
						)}
						{task.actions
							.filter((a) => a.state === "pending")
							.map((a) => (
								<div
									key={a.id}
									className="mt-3 rounded-lg border border-border p-3"
									data-testid="task-user-action"
								>
									<h5 className="font-medium">需要你：{a.title}</h5>
									<p className="mt-1 text-ink-dim">{a.reason}</p>
									{a.expected.doi && <p className="mt-1 break-all">DOI：{a.expected.doi}</p>}
									{a.url && (
										<button
											type="button"
											className={`${button} mt-2`}
											onClick={() => getPi().openExternal(a.url || "")}
										>
											打开浏览器页面
										</button>
									)}
									{["download", "file"].includes(a.kind) && (
										<div className="mt-2">
											<label className="block">
												工作区内的文件路径
												<input
													aria-label={`文件路径：${a.title}`}
													className="mt-1 block w-full rounded border border-border bg-canvas p-2"
													value={paths[a.id] || ""}
													onChange={(e) => setPaths((p) => ({ ...p, [a.id]: e.target.value }))}
													placeholder="例如 results/data.csv；不会扫描个人目录"
												/>
											</label>
											<button
												type="button"
												disabled={disabled || !paths[a.id]}
												className={`${button} mt-2`}
												onClick={() => act(task.id, "file", { actionId: a.id, path: paths[a.id] || "" })}
											>
												核对这个文件
											</button>
											{a.file && (
												<p className="mt-2 break-all">
													文件已检查：{a.file.path} · {a.file.identity} · {a.file.bytes} 字节
													<br />
													SHA-256：{a.file.sha256}
													<br />
													格式／身份匹配不等于内容已审阅。
												</p>
											)}
										</div>
									)}
									{a.kind === "authorization" ? (
										<div className="mt-2">
											<p className="text-ink-dim">通过 ask_user 确认，关闭或取消不会授予权限。</p>
											<button
												type="button"
												className={`${button} mt-2`}
												disabled={disabled}
												onClick={() => act(task.id, "ask-authorization", { actionId: a.id })}
											>
												打开 ask_user 授权请求
											</button>
										</div>
									) : (
										<button
											type="button"
											disabled={disabled || (["file", "download"].includes(a.kind) && !a.file)}
											className={`${button} mt-2`}
											onClick={() => act(task.id, "acknowledge", { actionId: a.id })}
										>
											我已核对这一事项
										</button>
									)}
									{a.kind === "review" && (
										<button
											type="button"
											className={`${button} ml-2`}
											disabled={disabled}
											onClick={() => sessionId && getPi().prompt(sessionId, "/obsidian-review")}
										>
											打开 Wiki 审核入口
										</button>
									)}
									<button
										type="button"
										className={`${button} ml-2`}
										disabled={disabled}
										onClick={() => act(task.id, "dismiss", { actionId: a.id })}
									>
										暂不处理／取消
									</button>
								</div>
							))}
						{!!task.operations.length && (
							<div className="mt-3">
								<h5 className="font-medium">宿主操作账本</h5>
								<ul className="mt-2 space-y-2">
									{task.operations.slice(-12).map((o) => (
										<li key={o.id} className="break-words rounded border border-border p-2">
											<div>
												{o.tool} · {o.state} · {o.checkedAt || o.at}
											</div>
											{o.artifact && (
												<p className="break-all text-ink-dim">
													{o.artifact.path} · {o.artifact.bytes} 字节
												</p>
											)}
											{o.candidateId && <p>候选 {o.candidateId}：须从 Wiki 审核入口处理，保存不等于发布。</p>}
											{["unknown", "returned"].includes(o.state) && (
												<div className="mt-2">
													<p className="text-ink-dim">
														先查询目标系统或日志；下面仅记录你的核对声明，不执行重试、不提供科学证明。
													</p>
													<button
														type="button"
														disabled={disabled}
														className={`${button} mt-1`}
														onClick={() => act(task.id, "confirm-outcome", { operationId: o.id })}
													>
														通过 ask_user 记录结果核对
													</button>
												</div>
											)}
										</li>
									))}
								</ul>
							</div>
						)}
					</details>
				</article>
			))}
			{stale && (
				<p className="p-3 text-xs text-ink-dim">这是历史快照。请使用最新任务卡或重新查看任务状态。</p>
			)}
			{error && (
				<p role="alert" className="break-words p-3 text-xs text-red-500">
					{error}
				</p>
			)}
		</section>
	);
}
