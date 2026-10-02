// Uses the same desktop AskGate/AskDialog as ask_user, without a model request.
// Only an exact host-owned choice can authorize the displayed immutable revision.
import { describeAcceptance, effectiveAcceptance } from "./acceptance";

function computeAuthorizationDetails(compute: any): string | null {
	if (!compute || typeof compute !== "object") return null;
	const hosts =
		Array.isArray(compute.hosts) && compute.hosts.every((host) => typeof host === "string")
			? compute.hosts
			: null;
	const remoteRead =
		Array.isArray(compute.remoteRead) && compute.remoteRead.every((path) => typeof path === "string")
			? compute.remoteRead
			: null;
	const remoteWrite =
		Array.isArray(compute.remoteWrite) && compute.remoteWrite.every((path) => typeof path === "string")
			? compute.remoteWrite
			: null;
	const budget = compute.budget;
	if (!hosts || !remoteRead || !remoteWrite || !budget || typeof budget !== "object") return null;
	if (
		![budget.maxCoreHours, budget.maxWalltimeMinutes, budget.maxConcurrentJobs, budget.maxDiskGb].every(
			(value) => typeof value === "number" && Number.isFinite(value) && value >= 0,
		) ||
		![budget.maxWalltimeMinutes, budget.maxConcurrentJobs, budget.maxDiskGb].every(
			(value) => typeof value === "number" && Number.isInteger(value) && value > 0,
		)
	)
		return null;
	return `计算范围：主机 ${hosts.join(", ")}；远程读取 ${remoteRead.join(", ") || "未声明"}；远程写入 ${remoteWrite.join(", ") || "未声明"}；最多 ${budget.maxCoreHours} 核时、单作业 ${budget.maxWalltimeMinutes} 分钟、${budget.maxConcurrentJobs} 个并发作业、${budget.maxDiskGb} GiB。${compute.agentCode === true ? "允许沙箱中的 Agent 模块。" : "不允许 Agent 编写模块。"}`;
}

export function createTaskAuthorization(journal: any, checkBinding: any = async () => null) {
	const pending = new Map();
	return async function ask(input: any, ctx: any, signal = ctx.signal) {
		const view = journal.view();
		const task = view.tasks.find((t) => t.id === input.taskId);
		if (!task || view.revision !== input.revision)
			throw new Error("Task changed. Refresh before requesting authorization.");
		if (["completed", "cancelled", "archived"].includes(task.state))
			throw new Error("Task is no longer awaiting authorization.");
		const action =
			input.action === "ask-authorization"
				? task.actions.find(
						(a) =>
							a.id === input.actionId &&
							["authorization", "rebind"].includes(a.kind) &&
							a.state === "pending",
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
			const rebind = action?.kind === "rebind" ? action : null;
			const title =
				input.action === "next-stage"
					? "ask_user · 继续下一阶段？"
					: input.action === "confirm-outcome"
						? "ask_user · 确认这一步的结果"
						: rebind
							? "ask_user · 更换这一项对应的文献？"
							: "ask_user · 开始执行这个任务？";
			// 验收标准文案：核心 file / human_review + 扩展登记的验收器 label（挂钩 2）；含运行期已绑定的身份
			const acceptanceLabel = (m) => describeAcceptance(effectiveAcceptance(m));
			const rebindTarget = rebind ? task.milestones.find((m) => m.id === rebind.milestoneId) : null;
			const computeDetails = computeAuthorizationDetails(task.compute);
			const details = [
				`要做的事：${task.goal}`,
				rebind
					? [
							`${action.title}\n${action.reason}`,
							`要改的交付项：${rebindTarget?.title || rebind.milestoneId}`,
							`原来的 DOI：${rebind.previous || "（计划里没有写死，之前也没绑定）"}`,
							`换成的 DOI：${rebind.expected?.doi}`,
							"同意后：这一项改按新 DOI 核对，旧的核对结果作废；新 DOI 与计划里点名的文献同等对待（写入时不再另外弹窗）。已经写进 Zotero 的旧条目不会被删除或移动，需要的话请你自己整理。",
						].join("\n")
					: action
						? `${action.title}\n${action.reason}`
						: task.authorizationSummary || task.goal,
				(task.writeRoots || []).length
					? `会写入这些文件夹（包括子文件夹）：\n${task.writeRoots.map((r) => `- ${r}`).join("\n")}`
					: "不会新增可写文件夹；改动文件仍按你现有的权限设置逐项确认。",
				computeDetails || "不包含远程计算范围；计算工具只能做只读探测。",
				`做完的标准：\n${task.milestones.map((m) => `- ${m.title}：${acceptanceLabel(m)}`).join("\n")}`,
				input.action === "confirm-outcome"
					? "这里只记录你已核对过这一步的结果，不会重新执行它。"
					: rebind
						? "这只改变这一项按哪篇文献核对，不扩大可写目录或其它权限。"
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
