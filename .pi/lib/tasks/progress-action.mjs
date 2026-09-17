import { remainingExplanation } from "./remaining.mjs";
import { explainReason } from "./workbench.mjs";
/** Native AskGate quick entry. Choices coordinate work; they never bypass consent or evidence. */
export function createTaskProgression(
	journal,
	{ askAuthorization, checkBinding, continueAuthorized, prepareRemaining, send, getGeneration = () => 0 },
) {
	const pending = new Map();
	return async (input, ctx) => {
		const key = `${journal.scope()}:${input.taskId}:${input.revision}`;
		if (pending.has(key)) return pending.get(key);
		const run = (async () => {
			const generation = getGeneration();
			const scope = journal.scope(),
				binding = await checkBinding();
			const validate = async () => {
				const view = journal.view(),
					task = view.tasks.find((t) => t.id === input.taskId);
				if (
					!task ||
					view.revision !== input.revision ||
					journal.scope() !== scope ||
					getGeneration() !== generation ||
					(await checkBinding()) !== binding ||
					ctx.signal?.aborted ||
					(ctx.isIdle && !ctx.isIdle())
				)
					throw new Error("任务或权限上下文已变化，请刷新后再推进。");
				if (["completed", "cancelled", "archived"].includes(task.state))
					throw new Error("任务已结束，不会重新执行；请查看已交付结果。");
				return task;
			};
			const task = await validate();
			if (!ctx.ui?.select) return;
			if (!task.executionConsent && task.milestones.length) {
				if (await askAuthorization({ ...input, action: "authorize-task" }, ctx)) {
					send("已确认任务范围，继续完成剩余交付项。");
					continueAuthorized(ctx);
				}
				return;
			}
			const action = task.actions.find((a) => a.state === "pending");
			if (action?.kind === "authorization") {
				if (await askAuthorization({ ...input, action: "ask-authorization", actionId: action.id }, ctx)) {
					journal.command({ taskId: task.id, revision: journal.view().revision, action: "select" });
					send("新增范围已确认，继续核对并推进剩余事项。");
					continueAuthorized(ctx);
				}
				return;
			}
			const report = `ask_user · 推进剩余事项\n\n${remainingExplanation(task)}\n\n${task.reason ? `当前状态原因：${explainReason(task.reason)}\n` : ""}仅处理当前任务，不改验收标准、不提高预算、不重做已完成操作。`;
			const uncertain = task.operations.some((o) => ["started", "unknown"].includes(o.state));
			const file = action && ["file", "download"].includes(action.kind) && !uncertain;
			const review =
				action?.kind === "review" &&
				task.milestones.find((m) => m.id === action.milestoneId)?.acceptance.kind === "human_review" &&
				!uncertain;
			const proceed = file
				? "提交所需文件"
				: review
					? "我已完成所列人工审阅"
					: uncertain
						? "只读核对不确定的操作结果"
						: "按原范围继续完成剩余事项";
			const unsupportedReview =
				(action?.kind === "review" && !review) || ["binding-changed", "total-budget"].includes(task.reason);
			const choices = unsupportedReview
				? ["暂不处理", "仅核对已有产物"]
				: ["暂不处理", "仅核对已有产物", proceed];
			const selected = await ctx.ui.select(report, choices, { signal: ctx.signal });
			if (!choices.includes(selected) || selected === "暂不处理" || ctx.signal?.aborted) return;
			await validate();
			let path;
			if (file && selected === proceed) {
				path = await ctx.ui.input(
					`ask_user · 提交文件\n\n${action.title}\n${action.reason}\n请输入已有文件的完整路径。提交表示你确认它是此事项所需的文件；程序仍会检查当前读取权限与文件身份。`,
					"完整文件路径",
					{ signal: ctx.signal },
				);
				if (!path?.trim() || ctx.signal?.aborted) return;
				await validate();
			}
			journal.command({ ...input, action: "select" });
			const command = (extra) => ({ taskId: task.id, revision: journal.view().revision, ...extra });
			if (path) {
				await journal.acceptFile(
					command({ action: "file", actionId: action.id, path: path.trim() }),
					ctx.cwd,
				);
				journal.command(command({ action: "acknowledge", actionId: action.id }));
			}
			if (review && selected === proceed)
				journal.command(command({ action: "acknowledge", actionId: action.id }));
			await journal.reconcile(ctx.cwd);
			// Reconciliation can await file I/O. A newer selection/input must cancel this handoff.
			if (
				journal.scope() !== scope ||
				journal.snapshot()?.id !== task.id ||
				getGeneration() !== generation ||
				ctx.signal?.aborted ||
				(await checkBinding()) !== binding
			)
				return;
			send();
			if (selected === "仅核对已有产物" || uncertain || journal.snapshot()?.state === "completed") return;
			if (journal.authorization()) continueAuthorized(ctx);
			else if (!task.milestones.length) await prepareRemaining();
		})();
		pending.set(key, run);
		try {
			return await run;
		} finally {
			pending.delete(key);
		}
	};
}
