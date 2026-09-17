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
					throw new Error("任务的情况刚发生了变化，请刷新看一下最新状态再操作。");
				if (["completed", "cancelled", "archived"].includes(task.state))
					throw new Error("这个任务已经结束了，去看看交付的结果吧；想再做类似的事就重新描述一次需求。");
				return task;
			};
			const task = await validate();
			if (!ctx.ui?.select) return;
			if (!task.executionConsent && task.milestones.length) {
				if (await askAuthorization({ ...input, action: "authorize-task" }, ctx)) {
					send("你已确认，接着完成剩下的交付。");
					continueAuthorized(ctx);
				}
				return;
			}
			const action = task.actions.find((a) => a.state === "pending");
			if (action?.kind === "authorization") {
				if (await askAuthorization({ ...input, action: "ask-authorization", actionId: action.id }, ctx)) {
					journal.command({ taskId: task.id, revision: journal.view().revision, action: "select" });
					send("你已同意这项新增的内容，继续往下做。");
					continueAuthorized(ctx);
				}
				return;
			}
			const report = `ask_user · 推进剩余事项\n\n${remainingExplanation(task)}\n\n${task.reason ? `目前的情况：${explainReason(task.reason)}\n` : ""}只处理这个任务剩下的部分；已经做完的不会重做，完成标准也不会变。`;
			const uncertain = task.operations.some((o) => ["started", "unknown"].includes(o.state));
			const file = action && ["file", "download"].includes(action.kind) && !uncertain;
			const review =
				action?.kind === "review" &&
				task.milestones.find((m) => m.id === action.milestoneId)?.acceptance.kind === "human_review" &&
				!uncertain;
			const proceed = file
				? "提交所需文件"
				: review
					? "我已亲自看过这些内容"
					: uncertain
						? "先核对上次没结果的操作"
						: "接着做完剩下的";
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
					`ask_user · 提交文件\n\n${action.title}\n${action.reason}\n请把文件的完整路径填在下面。程序会自己核对这份文件对不对，不会盲目采用。`,
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
