import { create } from "zustand";

export type AppView = "chat" | "projects";

/** chip → 侧栏跳转目标（nonce 保证重复跳同文件也重触发） */
export interface ResourcePreviewTarget {
	href: string;
	label?: string;
	cwd?: string;
}

export interface DiffFocus {
	/** 目标文件卡的首个 section key（TurnFileChange.sections[0].toolCallKey） */
	sectionKey: string;
	nonce: number;
}

interface UiStore {
	view: AppView;
	setView: (view: AppView) => void;
	/** todo 面板展开态（按会话，切换会话互不影响；不含持久化） */
	todoExpanded: Record<string, boolean>;
	toggleTodoExpanded: (sessionId: string) => void;
	/** 右侧资源/变更栏开关（内存态，不持久化——重启统一关闭） */
	diffSidebarOpen: boolean;
	/** 当前资源预览；null 表示展示 Git Diff。 */
	resourcePreview: ResourcePreviewTarget | null;
	setDiffSidebarOpen: (open: boolean) => void;
	showDiffSidebar: () => void;
	openResourcePreview: (target: ResourcePreviewTarget) => void;
	clearResourcePreview: () => void;
	toggleDiffSidebar: () => void;
	/** chip 跳转侧栏的聚焦目标（侧栏消费后清除） */
	diffFocus: DiffFocus | null;
	setDiffFocus: (sectionKey: string) => void;
	clearDiffFocus: () => void;
}

export const useUiStore = create<UiStore>((set) => ({
	view: "chat",
	setView: (view) => set({ view }),
	todoExpanded: {},
	toggleTodoExpanded: (sessionId) =>
		set((state) => ({
			todoExpanded: { ...state.todoExpanded, [sessionId]: !state.todoExpanded[sessionId] },
		})),
	diffSidebarOpen: false,
	resourcePreview: null,
	setDiffSidebarOpen: (open) => set({ diffSidebarOpen: open }),
	showDiffSidebar: () => set({ diffSidebarOpen: true, resourcePreview: null }),
	openResourcePreview: (target) => set({ diffSidebarOpen: true, resourcePreview: target }),
	clearResourcePreview: () => set({ resourcePreview: null }),
	toggleDiffSidebar: () =>
		set((state) =>
			state.diffSidebarOpen && state.resourcePreview === null
				? { diffSidebarOpen: false }
				: { diffSidebarOpen: true, resourcePreview: null },
		),
	diffFocus: null,
	setDiffFocus: (sectionKey) =>
		set((state) => ({ diffFocus: { sectionKey, nonce: (state.diffFocus?.nonce ?? 0) + 1 } })),
	clearDiffFocus: () => set({ diffFocus: null }),
}));
