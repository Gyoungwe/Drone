import { create } from "zustand";
import { getPi } from "../api";

export type AgentModeId = "single" | "lead" | "swarm";
export const AGENT_MODE_IDS: readonly AgentModeId[] = ["single", "lead", "swarm"];

/** P18：每个会话的模式（默认主从，与后端默认一致）；切换结果（工具增减）留给 UI 提示。 */
interface AgentModeStore {
	bySession: Record<string, AgentModeId>;
	lastChange: { sessionId: string; mode: AgentModeId; added: string[]; removed: string[] } | null;
	modeOf: (sessionId: string | null) => AgentModeId;
	setMode: (sessionId: string, mode: AgentModeId) => Promise<void>;
	clearChange: () => void;
}

export const useAgentModeStore = create<AgentModeStore>((set, get) => ({
	bySession: {},
	lastChange: null,
	modeOf: (sessionId) => (sessionId ? (get().bySession[sessionId] ?? "lead") : "lead"),
	setMode: async (sessionId, mode) => {
		const prev = get().modeOf(sessionId);
		if (prev === mode) return;
		set((s) => ({ bySession: { ...s.bySession, [sessionId]: mode } }));
		try {
			const diff = await getPi().setAgentMode(sessionId, mode);
			set({ lastChange: { sessionId, mode, ...diff } });
		} catch (error) {
			set((s) => ({ bySession: { ...s.bySession, [sessionId]: prev } }));
			throw error;
		}
	},
	clearChange: () => set({ lastChange: null }),
}));
