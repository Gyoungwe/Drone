import { type PlanProposal, renderPlanProposalCard } from "./plan-proposal";
/**
 * Pure task-authorization policy shared by host adapters.
 *
 * The `.pi` ask-authorization runtime owns journals, UI and binding checks.
 * This module keeps the deterministic action vocabulary and user-facing card
 * projection free of those runtime concerns so it can be tested in isolation.
 */

import { type ComputeAuthorization, ComputeAuthorizationSchema } from "@drone/shared";
import { Check } from "typebox/value";

export const TASK_AUTHORIZATION_ACTIONS = [
	"authorize-task",
	"approve-plan",
	"next-stage",
	"ask-authorization",
	"confirm-outcome",
] as const;

export type TaskAuthorizationAction = (typeof TASK_AUTHORIZATION_ACTIONS)[number];

export const TASK_AUTHORIZATION_KINDS = ["authorization", "rebind"] as const;
export type TaskAuthorizationKind = (typeof TASK_AUTHORIZATION_KINDS)[number];

export interface AuthorizationAction {
	id?: unknown;
	kind?: unknown;
	state?: unknown;
	milestoneId?: unknown;
	title?: unknown;
	reason?: unknown;
	previous?: unknown;
	expected?: { doi?: unknown; [key: string]: unknown };
	[key: string]: unknown;
}

export interface AuthorizationMilestone {
	id?: unknown;
	title?: unknown;
	[key: string]: unknown;
}

export interface AuthorizationTask {
	goal?: unknown;
	authorizationSummary?: unknown;
	writeRoots?: unknown;
	compute?: ComputeAuthorization | null;
	milestones?: readonly AuthorizationMilestone[];
	proposal?: PlanProposal | null;
	[key: string]: unknown;
}

export interface AuthorizationRequest {
	action?: unknown;
	actionId?: unknown;
	operationId?: unknown;
}

/** Whether a value is one of the task authorization actions understood by the host. */
export function isTaskAuthorizationAction(value: unknown): value is TaskAuthorizationAction {
	return typeof value === "string" && (TASK_AUTHORIZATION_ACTIONS as readonly string[]).includes(value);
}

/** Whether an action is still pending and can be selected for authorization. */
export function isPendingAuthorizationAction(
	action: AuthorizationAction | null | undefined,
	actionId: unknown,
): action is AuthorizationAction & { kind: TaskAuthorizationKind; state: "pending" } {
	return Boolean(
		action &&
			action.id === actionId &&
			typeof action.kind === "string" &&
			(TASK_AUTHORIZATION_KINDS as readonly string[]).includes(action.kind) &&
			action.state === "pending",
	);
}

/** Deterministic in-flight key used to merge duplicate authorization prompts. */
export function authorizationRequestKey(
	scope: unknown,
	taskId: unknown,
	revision: unknown,
	input: AuthorizationRequest,
): string {
	return `${String(scope ?? "")}:${String(taskId ?? "")}:${String(revision ?? "")}:${String(input.action ?? "")}:${String(input.actionId ?? input.operationId ?? "")}`;
}

/** Keep the stable ask_user anchor while varying the title by the requested action. */
export function authorizationTitle(action: AuthorizationRequest["action"], rebind = false): string {
	if (action === "next-stage") return "ask_user · 继续下一阶段？";
	if (action === "confirm-outcome") return "ask_user · 确认这一步的结果";
	if (rebind) return "ask_user · 更换这一项对应的文献？";
	return "ask_user · 开始执行这个任务？";
}

const displayText = (value: unknown): string => String(value ?? "");

export function buildProposalAuthorizationDetails(
	task: AuthorizationTask,
	action: AuthorizationAction | null | undefined,
	rebind: AuthorizationAction | null | undefined,
	proposal: PlanProposal,
	acceptanceLabel: (milestone: AuthorizationMilestone) => string = () => "已核对",
): string {
	return buildAuthorizationDetails(task, action, rebind, acceptanceLabel, proposal);
}

/**
 * Render the immutable, user-facing authorization contract shown by ask_user.
 * `acceptanceLabel` is injected by the host so extension acceptance kinds can
 * describe themselves without this package importing the acceptance registry.
 */
export function buildAuthorizationDetails(
	task: AuthorizationTask,
	action: AuthorizationAction | null | undefined,
	rebind: AuthorizationAction | null | undefined,
	acceptanceLabel: (milestone: AuthorizationMilestone) => string = () => "已核对",
	proposal: PlanProposal | null | undefined = task.proposal,
): string {
	const milestones = Array.isArray(task.milestones) ? task.milestones : [];
	const writeRoots = Array.isArray(task.writeRoots)
		? task.writeRoots.filter((root): root is string => typeof root === "string")
		: [];
	const compute = Check(ComputeAuthorizationSchema, task.compute)
		? (task.compute as ComputeAuthorization)
		: null;
	const computeDetails = compute
		? `计算范围：主机 ${compute.hosts.join(", ")}；远程读取 ${compute.remoteRead.join(", ") || "未声明"}；远程写入 ${compute.remoteWrite.join(", ") || "未声明"}；最多 ${compute.budget.maxCoreHours} 核时、单作业 ${compute.budget.maxWalltimeMinutes} 分钟、${compute.budget.maxConcurrentJobs} 个并发作业、${compute.budget.maxDiskGb} GiB。${compute.agentCode ? "允许沙箱中的 Agent 模块。" : "不允许 Agent 编写模块。"}`
		: null;
	const rebindTarget = rebind
		? milestones.find((milestone) => milestone.id === rebind.milestoneId)
		: undefined;
	const taskSpecificDetails = rebind
		? [
				`${displayText(rebind.title)}\n${displayText(rebind.reason)}`,
				`要改的交付项：${displayText(rebindTarget?.title || rebind.milestoneId)}`,
				`原来的 DOI：${displayText(rebind.previous) || "（计划里没有写死，之前也没绑定）"}`,
				`换成的 DOI：${displayText(rebind.expected?.doi)}`,
				"同意后：这一项改按新 DOI 核对，旧的核对结果作废；新 DOI 与计划里点名的文献同等对待（写入时不再另外弹窗）。已经写进 Zotero 的旧条目不会被删除或移动，需要的话请你自己整理。",
			].join("\n")
		: action
			? `${displayText(action.title)}\n${displayText(action.reason)}`
			: displayText(task.authorizationSummary || task.goal);
	const proposalDetails = proposal
		? `\n\n方案提案（批准仍需你明确同意）\n\n${renderPlanProposalCard(proposal)}`
		: "";
	return (
		[
			`要做的事：${displayText(task.goal)}`,
			taskSpecificDetails,
			writeRoots.length
				? `会写入这些文件夹（包括子文件夹）：\n${writeRoots.map((root) => `- ${root}`).join("\n")}`
				: "不会新增可写文件夹；改动文件仍按你现有的权限设置逐项确认。",
			computeDetails ?? "不包含远程计算范围；计算工具只能做只读探测。",
			`做完的标准：\n${milestones.map((milestone) => `- ${displayText(milestone.title)}：${acceptanceLabel(milestone)}`).join("\n")}`,
			inputActionNote(action, rebind),
			"不想继续就选“暂不授权”或直接关掉，都不会开始执行。",
		].join("\n\n") + proposalDetails
	);
}

function inputActionNote(
	action: AuthorizationAction | null | undefined,
	rebind: AuthorizationAction | null | undefined,
): string {
	if (action?.kind === "rebind" || rebind) return "这只改变这一项按哪篇文献核对，不扩大可写目录或其它权限。";
	return "同意后它会自己做完这些事，中途不再反复问你；做别的、删东西或碰敏感文件仍会先征得你同意。你随时可以停止。";
}
