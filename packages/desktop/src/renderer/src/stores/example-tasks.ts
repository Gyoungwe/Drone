import { create } from "zustand";

/**
 * Example-task dialog state: which built-in example is open. Opened from the 任务 tab empty state
 * and from the `/` menu direction layer; the dialog itself lives once in App.
 */
interface ExampleTaskUiState {
	openId: string | null;
	open: (id: string) => void;
	close: () => void;
}

export const useExampleTaskStore = create<ExampleTaskUiState>((set) => ({
	openId: null,
	open: (id) => set({ openId: id }),
	close: () => set({ openId: null }),
}));
