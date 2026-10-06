import { create } from "zustand";

/** 主区视图：聊天 / 空间（项目）/ 知识库（全屏视图，不再是弹窗）/ 插件贡献的全屏视图（rail.view，挂钩 4） */
export type AppView = "chat" | "projects" | "knowledge" | `plugin:${string}`;

/**
 * 右侧上下文面板页签：任务 / 过程 / 产物 常驻；子智能体、计算按需出现（ContextPanel 决定可见性）
 * + 插件贡献的页签（panel.tab，挂钩 4）。文件变更并入「过程」页签（processView = "changes"）。
 */
export type CorePanelTab = "tasks" | "process" | "artifacts" | "subagents" | "compute";
export type PanelTab = CorePanelTab | `plugin:${string}`;
export const PANEL_TABS: readonly CorePanelTab[] = ["tasks", "process", "artifacts", "subagents", "compute"];

/** 常驻页签之外，子智能体 / 计算 只在需要时出现（调用方决定 show 条件） */
export function visiblePanelTabs(show: { subagents: boolean; compute: boolean }): readonly CorePanelTab[] {
	return PANEL_TABS.filter(
		(key) => (key !== "subagents" || show.subagents) && (key !== "compute" || show.compute),
	);
}

/** 「过程」页签内的两个视图：运行过程泳道 / 文件变更 */
export type ProcessView = "lanes" | "changes";

/** chip → 面板跳转目标（nonce 保证重复跳同文件也重触发） */
export interface ResourcePreviewTarget {
	href: string;
	fragment?: string;
	label?: string;
	cwd?: string;
}

export interface DiffFocus {
	/** 目标文件卡的首个 section key（TurnFileChange.sections[0].toolCallKey） */
	sectionKey: string;
	nonce: number;
}

/** 过程页签内定位到某一轮（TurnFooter「N 次工具」点击） */
export interface ProcessFocus {
	turnIndex: number;
	nonce: number;
}

const STORAGE_OPEN = "drone.panel.idleOpen";
const STORAGE_TAB = "drone.panel.tab";

function readStorage(key: string): string | null {
	try {
		return typeof localStorage === "undefined" ? null : localStorage.getItem(key);
	} catch {
		return null;
	}
}
function writeStorage(key: string, value: string): void {
	try {
		if (typeof localStorage !== "undefined") localStorage.setItem(key, value);
	} catch {
		// 隐私模式 / 配额：偏好不持久化即可
	}
}
function isPanelTab(value: string | null): value is PanelTab {
	return value !== null && ((PANEL_TABS as readonly string[]).includes(value) || value.startsWith("plugin:"));
}

interface UiStore {
	view: AppView;
	setView: (view: AppView) => void;

	/**
	 * 右侧上下文面板（固定三栏，取消悬浮层）。
	 * - panelOpen：当前是否展开；
	 * - idleOpen：空闲态的用户选择（持久化）。运行开始自动展开，运行结束回到 idleOpen；
	 *   空闲时用户手动开关即更新 idleOpen，运行中手动开关只作用于本次运行。
	 */
	panelOpen: boolean;
	idleOpen: boolean;
	panelTab: PanelTab;
	processView: ProcessView;
	setProcessView: (view: ProcessView) => void;
	/** 用户手动开关（区分空闲/运行由调用方传入 agentActive） */
	togglePanel: (agentActive?: boolean) => void;
	setPanelOpen: (open: boolean, agentActive?: boolean) => void;
	setPanelTab: (tab: PanelTab) => void;
	/** 打开面板并切到指定页签（chip/导航跳转用；不改动 idleOpen） */
	openPanel: (tab: PanelTab) => void;
	/** 运行边界：开始 → 自动展开；结束 → 回到空闲选择 */
	onRunStart: () => void;
	onRunEnd: () => void;

	/** 当前资源预览；null 表示「过程 · 变更」显示 Git Diff */
	resourcePreview: ResourcePreviewTarget | null;
	openResourcePreview: (target: ResourcePreviewTarget) => void;
	clearResourcePreview: () => void;
	/** 兼容旧调用：打开「过程 · 变更」 */
	showDiffSidebar: () => void;

	/** chip 跳转「过程 · 变更」的聚焦目标（面板消费后清除） */
	diffFocus: DiffFocus | null;
	setDiffFocus: (sectionKey: string) => void;
	clearDiffFocus: () => void;

	/** TurnFooter → 「过程」页签定位某轮 */
	processFocus: ProcessFocus | null;
	focusProcessTurn: (turnIndex: number) => void;
	clearProcessFocus: () => void;
}

const storedIdleOpen = readStorage(STORAGE_OPEN);
const storedTab = readStorage(STORAGE_TAB);

export const useUiStore = create<UiStore>((set, get) => ({
	view: "chat",
	setView: (view) => set({ view }),

	panelOpen: storedIdleOpen !== "0",
	idleOpen: storedIdleOpen !== "0",
	panelTab: storedTab === "changes" ? "process" : isPanelTab(storedTab) ? storedTab : "tasks",
	processView: storedTab === "changes" ? "changes" : "lanes",
	setProcessView: (processView) => set({ processView }),
	togglePanel: (agentActive = false) => get().setPanelOpen(!get().panelOpen, agentActive),
	setPanelOpen: (open, agentActive = false) => {
		if (agentActive) {
			set({ panelOpen: open });
			return;
		}
		writeStorage(STORAGE_OPEN, open ? "1" : "0");
		set({ panelOpen: open, idleOpen: open });
	},
	setPanelTab: (tab) => {
		writeStorage(STORAGE_TAB, tab);
		set({ panelTab: tab });
	},
	openPanel: (tab) => {
		writeStorage(STORAGE_TAB, tab);
		set({ panelOpen: true, panelTab: tab });
	},
	onRunStart: () => set({ panelOpen: true }),
	onRunEnd: () => set((state) => ({ panelOpen: state.idleOpen })),

	resourcePreview: null,
	openResourcePreview: (target) =>
		set({ panelOpen: true, panelTab: "process", processView: "changes", resourcePreview: target }),
	clearResourcePreview: () => set({ resourcePreview: null }),
	showDiffSidebar: () =>
		set({ panelOpen: true, panelTab: "process", processView: "changes", resourcePreview: null }),

	diffFocus: null,
	setDiffFocus: (sectionKey) =>
		set((state) => ({
			panelOpen: true,
			panelTab: "process",
			processView: "changes",
			resourcePreview: null,
			diffFocus: { sectionKey, nonce: (state.diffFocus?.nonce ?? 0) + 1 },
		})),
	clearDiffFocus: () => set({ diffFocus: null }),

	processFocus: null,
	focusProcessTurn: (turnIndex) =>
		set((state) => ({
			panelOpen: true,
			panelTab: "process",
			processView: "lanes",
			processFocus: { turnIndex, nonce: (state.processFocus?.nonce ?? 0) + 1 },
		})),
	clearProcessFocus: () => set({ processFocus: null }),
}));
