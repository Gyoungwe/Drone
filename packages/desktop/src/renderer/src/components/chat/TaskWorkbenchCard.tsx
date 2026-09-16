import { TASK_STATE_LABELS, type TaskView, taskActionCommand } from "@percho/shared";
import { useState } from "react";
import { getPi } from "../../api";
import { selectTranscript, useTranscriptStore } from "../../stores/transcript";

export function TaskWorkbenchCard({ view, sessionId }: { view: TaskView; sessionId: string | null }) {
	const [busy, setBusy] = useState(false),
		[error, setError] = useState("");
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
	return (
		<section
			data-testid="task-workbench"
			className="my-3 overflow-hidden rounded-xl border border-border bg-surface/50 text-ink"
		>
			<header className="flex items-center justify-between gap-3 border-b border-border p-4">
				<div>
					<h3 className="text-sm font-semibold">任务工作台</h3>
					<p className="mt-1 text-xs text-ink-dim">执行、验收与待你处理 · 不代表科研结论已验证</p>
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
					导出检查点 · v{view.revision}
				</button>
			</header>
			{view.selectionRequired && (
				<p role="status" className="border-b border-border p-3 text-sm">
					有多个任务可以继续。请选择一个，不会自动猜测或启动写操作。
				</p>
			)}
			{view.tasks.length === 0 && (
				<p className="p-4 text-sm text-ink-dim">尚无任务。发送具体需求后会建立宿主任务记录。</p>
			)}
			{view.tasks.map((task) => (
				<article key={task.id} data-task-id={task.id} className="border-b border-border p-4 last:border-0">
					<div className="flex flex-wrap items-center justify-between gap-2">
						<h4 className="min-w-0 break-words text-sm font-medium">{task.goal}</h4>
						<span className="rounded-full border border-border px-2 py-0.5 text-xs">
							{TASK_STATE_LABELS[task.state]}
						</span>
					</div>
					<p className="mt-1 text-xs text-ink-dim">
						{task.id === view.activeTaskId ? "当前任务 · " : ""}阶段 {task.stage} · 调用 {task.budget.calls}/
						{view.limits.totalCalls} · 等待 {Math.floor(task.waitMs / 60000)} 分钟
					</p>
					<p className="mt-1 text-xs text-ink-dim">
						上次记录：{task.updatedAt} {task.reason && ` · ${task.reason}`}
					</p>
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
							只读核对产物
						</button>
						<button
							type="button"
							disabled={disabled || ["completed", "cancelled"].includes(task.state)}
							className={button}
							onClick={() => act(task.id, "resume")}
						>
							从检查点继续
						</button>
						<button
							type="button"
							disabled={disabled || ["completed", "cancelled"].includes(task.state)}
							className={button}
							onClick={() => act(task.id, "next-stage")}
						>
							确认下一阶段预算
						</button>
						<button
							type="button"
							disabled={disabled || ["completed", "cancelled"].includes(task.state)}
							className={button}
							onClick={() => act(task.id, "cancel")}
						>
							取消任务
						</button>
					</div>
					<details open={task.id === view.activeTaskId} className="mt-3 text-xs">
						<summary className="cursor-pointer text-ink-dim">验收、人工介入与操作账本</summary>
						{!!task.milestones.length && (
							<div className="mt-3">
								<h5 className="font-medium">验收条件{!task.planApproved && "（模型提案，待你确认）"}</h5>
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
								{!task.planApproved && (
									<button
										type="button"
										disabled={disabled}
										className={`${button} mt-2`}
										onClick={() => act(task.id, "approve-plan")}
									>
										确认这些验收条件
									</button>
								)}
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
										<p className="mt-2 text-ink-dim">
											请使用现有权限提示或设置入口。本卡片不能授权，取消也不会默认同意。
										</p>
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
														我已在目标系统核对该操作结果
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
