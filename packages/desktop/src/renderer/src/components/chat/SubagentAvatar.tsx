import type { SubagentPanelSource } from "@drone/shared";
import {
	type SubagentAvatarSize,
	type SubagentAvatarState,
	subagentAvatarClassName,
	subagentSourceBadge,
} from "./subagent-avatar";

/**
 * 子智能体专属形象：无人机脸（两只眼睛）+ 名称哈希定色 + 来源角标；表情 = 状态（data-state 驱动
 * 纯 CSS 动画，见 styles/subagents.css；prefers-reduced-motion 时全部静止）。主模型与用户没有形象——
 * 它只属于子智能体，聊天 / 面板 / 审批坞里同一只头像构成它在会话里的「行踪」。
 */
export function SubagentAvatar({
	name,
	source,
	state = "idle",
	size = "md",
	className = "",
	title,
}: {
	name: string;
	source?: SubagentPanelSource;
	state?: SubagentAvatarState;
	size?: SubagentAvatarSize;
	className?: string;
	title?: string;
}) {
	return (
		<span
			className={subagentAvatarClassName(name, size, className)}
			data-state={state}
			data-testid="subagent-avatar"
			aria-hidden="true"
			title={title}
		>
			<span className="sa-av-c">{subagentSourceBadge(source)}</span>
		</span>
	);
}
