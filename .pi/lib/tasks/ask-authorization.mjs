// Uses the same desktop AskGate/AskDialog as ask_user, without a model request.
// Only an exact host-owned choice can authorize the displayed immutable revision.
export function createTaskAuthorization(journal, checkBinding = async () => null) {
	const pending = new Map();
	return async function ask(input, ctx, signal = ctx.signal) {
		const view = journal.view();
		const task = view.tasks.find((t) => t.id === input.taskId);
		if (!task || view.revision !== input.revision)
			throw new Error("Task changed. Refresh before requesting authorization.");
		if (["completed", "cancelled", "archived"].includes(task.state))
			throw new Error("Task is no longer awaiting authorization.");
		const action =
			input.action === "ask-authorization"
				? task.actions.find(
						(a) => a.id === input.actionId && a.kind === "authorization" && a.state === "pending",
					)
				: null;
		if (input.action === "ask-authorization" && !action)
			throw new Error("Authorization action is no longer pending.");
		if (
			!["authorize-task", "approve-plan", "next-stage", "ask-authorization", "confirm-outcome"].includes(
				input.action,
			)
		)
			throw new Error("Unknown authorization request.");
		const scope = journal.scope();
		const key = `${scope}:${task.id}:${view.revision}:${input.action}:${input.actionId || input.operationId || ""}`;
		if (pending.has(key)) return pending.get(key);
		const operation = (async () => {
			if (!ctx.ui?.select || signal?.aborted) return false;
			const binding = await checkBinding();
			const allow = "同意本次请求",
				deny = "暂不授权";
			const title =
				input.action === "next-stage"
					? "ask_user · 确认下一阶段预算"
					: input.action === "confirm-outcome"
						? "ask_user · 核对操作结果"
						: "ask_user · 任务授权";
			const details = [
				`任务：${task.goal}`,
				`版本：${view.revision} · 任务 ID：${task.id}`,
				action ? `${action.title}\n${action.reason}` : task.authorizationSummary || task.goal,
				`可写目录：${(task.writeRoots || []).join("、") || "未授予目录写入"}`,
				`任务调用上限：${view.limits.totalCalls}；已用 ${task.budget.calls}。不提高绝对预算。`,
				`完成标准：\n${task.milestones.map((m) => `- ${m.title} (${m.acceptance.kind}: ${m.acceptance.path || m.acceptance.doi || "人工核对"})`).join("\n")}`,
				input.action === "confirm-outcome"
					? `仅记录你对操作 ${input.operationId} 的核对声明；不重试、不代表科学验证。`
					: "只同意所示任务范围。敏感操作、显式拒绝、外部发布、Wiki 人工内容和费用边界仍由各自权限检查保护。",
				"关闭、取消、自定义文字都不视为同意。",
			].join("\n\n");
			const selected = await ctx.ui.select(`${title}\n\n${details}`, [deny, allow], { signal });
			if (selected !== allow || signal?.aborted) return false;
			if (journal.scope() !== scope || (await checkBinding()) !== binding)
				throw new Error("Task context or knowledge binding changed; ask again in the current context.");
			// Do NOT refresh to a newer revision after the question: only the shown contract can be approved.
			journal.command({ ...input, action: action ? "acknowledge" : input.action });
			return true;
		})();
		pending.set(key, operation);
		try {
			return await operation;
		} finally {
			pending.delete(key);
		}
	};
}
