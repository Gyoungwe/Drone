import type { SessionMeta } from "@percho/shared";
import { isDailyCwd } from "../../lib/daily";
import { useTranscriptStore } from "../../stores/transcript";

/** 会话状态（优先级递减）：等待审批 > 工作中 > 完成未读 > 空闲。顶栏胶囊与左侧轨道共用 */
export type SessionStatus = "attention" | "working" | "done" | "idle";

/** 订阅单个会话的运行状态（selector 返回字符串原始值，引用稳定不触发多余渲染） */
export function useSessionStatus(sessionId: string): SessionStatus {
	return useTranscriptStore((s): SessionStatus => {
		const entry = s.bySession[sessionId];
		if (!entry) return "idle";
		if (entry.pendingPermissions.length > 0) return "attention";
		if (entry.agentActive) return "working";
		if (entry.unseenCompletion) return "done";
		return "idle";
	});
}

/**
 * 该会话的 agent 运行是否存活：SDK 事件驱动的权威态 `agentActive`
 * （agent_start→true，agent_end/agent_settled→false）。id 为空 → false。
 * 多个组件（呼吸灯/转圈/话题面板）此前各自内联同一 selector，统一到此一处读取。
 */
export function useAgentActive(sessionId: string | null): boolean {
	return useTranscriptStore((s) => (sessionId ? (s.bySession[sessionId]?.agentActive ?? false) : false));
}

/** 会话显示标题：用户设置/自动生成名 → 项目目录末级（日常空间 → 本地化「日常」）→ 未命名占位 */
export function sessionTitle(session: SessionMeta, untitledLabel: string, dailyLabel?: string): string {
	return (
		session.name ??
		(isDailyCwd(session.cwd) ? dailyLabel : undefined) ??
		session.cwd.split("/").filter(Boolean).pop() ??
		untitledLabel
	);
}

/** 项目目录末级名（空串 = 无，如 cwd 为根路径） */
export function sessionProjectDir(session: SessionMeta): string {
	return session.cwd.split("/").filter(Boolean).pop() ?? "";
}

/** 头像字母 = 项目名（cwd 最后一段）首字母，与会话标题无关 */
export function sessionLetter(session: SessionMeta): string {
	return sessionProjectDir(session)[0] ?? "P";
}
