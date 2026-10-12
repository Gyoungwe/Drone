import { create } from "zustand";

/** 每个会话待答问询数（App 维护问询队列，侧栏「进行中」分组读取）。 */
interface AskCountsState {
	bySession: Record<string, number>;
	setFromRequests: (requests: ReadonlyArray<{ sessionId: string }>) => void;
}

export const useAskCountsStore = create<AskCountsState>((set) => ({
	bySession: {},
	setFromRequests: (requests) => {
		const bySession: Record<string, number> = {};
		for (const r of requests) bySession[r.sessionId] = (bySession[r.sessionId] ?? 0) + 1;
		set({ bySession });
	},
}));
