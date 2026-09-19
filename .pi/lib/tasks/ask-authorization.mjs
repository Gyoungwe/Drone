// Uses the same desktop AskGate/AskDialog as ask_user, without a model request.
// Only an exact host-owned choice can authorize the displayed immutable revision.
import { describeAcceptance } from "./acceptance.mjs";

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
			// ask_user·AskGate 兼容锚点：标题保留 "ask_user" 供审计与测试识别弹窗来源，
			// 但正文全部用用户视角的语言，不出现 UUID/revision/预算等内部记账概念。
			const title =
				input.action === "next-stage"
					? "ask_user · 继续下一阶段？"
					: input.action === "confirm-outcome"
						? "ask_user · 确认这一步的结果"
						: "ask_user · 开始执行这个任务？";
			// 验收标准文案：核心 file / human_review + 扩展登记的验收器 label（挂钩 2）
			const acceptanceLabel = (m) => describeAcceptance(m.acceptance);
			const details = [
				`要做的事：${task.goal}`,
				action ? `${action.title}\n${action.reason}` : task.authorizationSummary || task.goal,
				(task.writeRoots || []).length
					? `会写入这些文件夹（包括子文件夹）：\n${task.writeRoots.map((r) => `- ${r}`).join("\n")}`
					: "不会新增可写文件夹；改动文件仍按你现有的权限设置逐项确认。",
				`做完的标准：\n${task.milestones.map((m) => `- ${m.title}：${acceptanceLabel(m)}`).join("\n")}`,
				input.action === "confirm-outcome"
					? "这里只记录你已核对过这一步的结果，不会重新执行它。"
					: "同意后它会自己做完这些事，中途不再反复问你；做别的、删东西或碰敏感文件仍会先征得你同意。你随时可以停止。",
				"不想继续就选“暂不授权”或直接关掉，都不会开始执行。",
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
