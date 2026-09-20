import type { SubagentPanelRunStatus, SubagentPanelSource } from "@drone/shared";

/** 头像表情 = 状态：待命 / 排队 / 运行 / 等待（审批或回复）/ 完成 / 失败 / 已中止 */
export type SubagentAvatarState = "idle" | "queued" | "running" | "waiting" | "done" | "error" | "aborted";
export type SubagentAvatarSize = "lg" | "md" | "sm";

/** 8 色板槽位数（色板刻意避开状态色红 / 琥珀 / 绿；深浅主题共用渐变） */
export const SUBAGENT_HUES = 8;

/** djb2：同名任何时刻同色（跨会话 / 跨进程稳定，不依赖注册顺序） */
export function subagentHue(name: string): number {
	let hash = 5381;
	for (let i = 0; i < name.length; i++) hash = ((hash << 5) + hash + name.charCodeAt(i)) | 0;
	return Math.abs(hash) % SUBAGENT_HUES;
}

/** 来源角标：D = 内置（Drone）/ U = 用户 / P = 项目 */
export function subagentSourceBadge(source: SubagentPanelSource | undefined): "D" | "U" | "P" {
	if (source === "user") return "U";
	if (source === "project") return "P";
	return "D";
}

/** 面板运行状态 → 表情 */
export function avatarStateForPanelStatus(status: SubagentPanelRunStatus): SubagentAvatarState {
	switch (status) {
		case "queued":
			return "queued";
		case "running":
			return "running";
		case "needs_reply":
		case "waiting_approval":
			return "waiting";
		case "done":
			return "done";
		case "error":
			return "error";
		case "aborted":
			return "aborted";
	}
}

/** 模型调用的运行卡（无面板记录）：运行中 / 完成 / 失败；有上级请求待回复时抬眼 */
export function avatarStateForRunUi(
	status: "running" | "done" | "error",
	options: { expectsReply?: boolean } = {},
): SubagentAvatarState {
	if (status === "running") return options.expectsReply ? "waiting" : "running";
	return status;
}

/** 头像 class（纯函数，单测断言稳定性） */
export function subagentAvatarClassName(name: string, size: SubagentAvatarSize, extra = ""): string {
	return `sa-av ${size} h${subagentHue(name)}${extra ? ` ${extra}` : ""}`;
}
