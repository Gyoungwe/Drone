import { create } from "zustand";

/** 主区视图：聊天 / 空间（项目）/ 研究工作台 / 知识库（后两者是全屏视图，不再是弹窗） */
export type AppView = "chat" | "projects" | "research" | "knowledge";

/** 右侧上下文面板页签：任务 / 过程 / 变更 / 产物 */
export type PanelTab = "tasks" | "process" | "changes" | "artifacts";
export const PANEL_TABS: readonly PanelTab[] = ["tasks", "process", "changes", "artifacts"];

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
	return value !== null && (PANEL_TABS as readonly string[]).includes(value);
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
	/** 用户手动开关（区分空闲/运行由调用方传入 agentActive） */
	togglePanel: (agentActive?: boolean) => void;
	setPanelOpen: (open: boolean, agentActive?: boolean) => void;
	setPanelTab: (tab: PanelTab) => void;
	/** 打开面板并切到指定页签（chip/导航跳转用；不改动 idleOpen） */
	openPanel: (tab: PanelTab) => void;
	/** 运行边界：开始 → 自动展开；结束 → 回到空闲选择 */
	onRunStart: () => void;
	onRunEnd: () => void;

	/** 当前资源预览；null 表示「变更」页签显示 Git Diff */
	resourcePreview: ResourcePreviewTarget | null;
	openResourcePreview: (target: ResourcePreviewTarget) => void;
	clearResourcePreview: () => void;
	/** 兼容旧调用：打开「变更」页签 */
	showDiffSidebar: () => void;

	/** chip 跳转「变更」页签的聚焦目标（面板消费后清除） */
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
	panelTab: isPanelTab(storedTab) ? storedTab : "tasks",
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
	openResourcePreview: (target) => set({ panelOpen: true, panelTab: "changes", resourcePreview: target }),
	clearResourcePreview: () => set({ resourcePreview: null }),
	showDiffSidebar: () => set({ panelOpen: true, panelTab: "changes", resourcePreview: null }),

	diffFocus: null,
	setDiffFocus: (sectionKey) =>
		set((state) => ({
			panelOpen: true,
			panelTab: "changes",
			resourcePreview: null,
			diffFocus: { sectionKey, nonce: (state.diffFocus?.nonce ?? 0) + 1 },
		})),
	clearDiffFocus: () => set({ diffFocus: null }),

	processFocus: null,
	focusProcessTurn: (turnIndex) =>
		set((state) => ({
			panelOpen: true,
			panelTab: "process",
			processFocus: { turnIndex, nonce: (state.processFocus?.nonce ?? 0) + 1 },
		})),
	clearProcessFocus: () => set({ processFocus: null }),
}));
