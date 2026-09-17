import { MAX_AUTO_RESUMES } from "./consent.mjs";

/**
 * 回合结束时，任务是否值得主动弹窗问用户。
 *
 * 背景：agent_end 里只有一条自动续作路径（knowledgePublication blocked），
 * 其余情况一律只刷新一张状态卡就结束。于是「授权过、干到一半、
 * 因为 tool-failure 之类原因停下」的任务会彻底静默——用户不点开侧栏
 * 就不知道它停了，而 reserveContinuation 的可恢复原因白名单又不含这些。
 *
 * 判据（全部满足才弹）：
 * - 已授权：用户说过"执行到交付"，才有资格打断他问"要不要继续"
 * - 有未验收里程碑：没有剩余项就没什么好问的
 * - 非终态：completed/cancelled/archived 已收尾
 * - 本回合有进展：progressCount 比上次续作时高，防止模型原地打转反复弹
 * - 未超自动续作配额：沿用 MAX_AUTO_RESUMES，弹窗也是一种打断，不能无限
 * - 无待处理动作：那种情况自有各自的确认入口，不在这里抢
 */
export function shouldAskToContinue(task) {
	if (!task?.executionConsent) return false;
	if (["completed", "cancelled", "archived"].includes(task.state)) return false;
	const milestones = task.milestones || [];
	if (!milestones.length) return false;
	if (!milestones.some((m) => m.state !== "completed")) return false;
	if ((task.actions || []).some((a) => a.state === "pending")) return false;
	if ((task.budget?.autoResumes || 0) >= MAX_AUTO_RESUMES) return false;
	return (task.progressCount || 0) > (task.lastResumeProgress || 0);
}
