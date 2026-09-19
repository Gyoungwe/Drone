import type {
	KnowledgeFlowCard,
	SubagentRunUi,
	TaskMilestone,
	UIToolCall,
	WorkbenchTask,
} from "@drone/shared";
import type { ReactNode } from "react";

/**
 * 槽位目录 v1：槽位名与 props 契约的单一来源（spec §4）。
 * 槽位名单与 shared 的 KNOWN_UI_SLOTS 对齐（main 进程校验 manifest.slots 用同一份），
 * 由 registry.test.ts 断言两者一致，避免两端漂移。
 */
export const UI_SLOTS = {
	ToolCallCard: "chat.tool-call-card",
	SubagentCard: "chat.subagent-card",
	/** 待办卡：现渲染在右侧上下文面板「任务」页签内（TasksPane），不再是聊天区悬浮胶囊 */
	TodoPanel: "chat.todo-panel",
	/** 产物页签里的一张通用回执卡（挂钩 4）：插件可按 card.kind 换成领域渲染，其余交回 renderDefault() */
	ArtifactsCard: "panel.artifacts.card",
	/** 任务卡里程碑的证据行（挂钩 4）：核心只做通用渲染（状态 / 摘要 / 字段 / 链接） */
	MilestoneEvidence: "panel.task.milestone-evidence",
} as const;
export type SlotName = (typeof UI_SLOTS)[keyof typeof UI_SLOTS];

/**
 * 区域目录 v1（spec §15）：往页面加挂新组件的挂载点。
 * 与 shared 的 KNOWN_UI_REGIONS 对齐（main 进程校验 manifest.contributions 用同一份），
 * 由 registry.test.ts 断言两者一致，避免两端漂移。
 */
export const UI_REGIONS = {
	AppBackground: "app.background",
	AppOverlay: "app.overlay",
	CornerTopLeft: "chat.corner.top-left",
	CornerTopRight: "chat.corner.top-right",
	CornerBottomLeft: "chat.corner.bottom-left",
	CornerBottomRight: "chat.corner.bottom-right",
	/** 变更区域：现挂在右侧上下文面板「变更」页签底部（ChangesPane） */
	DiffSidebar: "chat.diff-sidebar",
	SettingsPanel: "settings.panel",
	/** 右侧上下文面板新增页签：每个贡献一个页签，title 作标签（挂钩 4） */
	PanelTab: "panel.tab",
	/** 左侧导航新增全屏视图：每个贡献一个入口，title 作标签（挂钩 4） */
	RailView: "rail.view",
} as const;
export type RegionName = (typeof UI_REGIONS)[keyof typeof UI_REGIONS];

/** 每个槽位的 props 契约：插件组件与 fallback 组件都按此签名 */
export interface SlotPropsMap {
	[UI_SLOTS.ToolCallCard]: { tool: UIToolCall };
	[UI_SLOTS.SubagentCard]: { runs: SubagentRunUi[] };
	[UI_SLOTS.TodoPanel]: Record<string, never>;
	[UI_SLOTS.ArtifactsCard]: {
		card: KnowledgeFlowCard;
		sessionId: string | null;
		/** 宿主默认渲染（插件只想接管某些 kind 时，其余调用它） */
		renderDefault: () => ReactNode;
	};
	[UI_SLOTS.MilestoneEvidence]: {
		milestone: TaskMilestone;
		task: WorkbenchTask;
		sessionId: string | null;
		renderDefault: () => ReactNode;
	};
}

/** 贡献型区域的页签 / 视图 id（写进 ui store 的 panelTab / view） */
export const pluginTabId = (pluginName: string, id: string) => `plugin:${pluginName}:${id}` as const;
