import type { KnowledgeFlow, KnowledgeUiEvent } from "@percho/shared";
import { create } from "zustand";
export interface KnowledgeDialogContext { cwd: string | null; sessionId: string | null; tab: "overview" | "reviews" | "maintenance"; id?: string; note?: string; noteRevision?: number }
interface State {
 flows: Record<string, KnowledgeFlow>; revision: number; dialog: KnowledgeDialogContext | null;
 notice: Extract<KnowledgeUiEvent, { kind: "notice" }> | null;
 apply: (event: KnowledgeUiEvent) => void; invalidate: () => void;
 open: (context: KnowledgeDialogContext) => void; close: () => void; dismiss: () => void;
}
export const useKnowledgeStore = create<State>((set) => ({
 flows: {}, revision: 0, dialog: null, notice: null,
 apply: event => {
  if (event.kind === "flow") set(state => {
   const previous = state.flows[event.flow.sessionId];
   if (previous && previous.updatedAt > event.flow.updatedAt) return state;
   const flows = { ...state.flows, [event.flow.sessionId]: event.flow };
   const ids = Object.keys(flows);
   if (ids.length > 64) { const oldest=ids.sort((a,b) => (flows[a]?.updatedAt??0)-(flows[b]?.updatedAt??0))[0]; if(oldest)delete flows[oldest]; }
   return { flows };
  });
  if (event.kind === "notice") set({ notice: event });
 },
 invalidate: () => set(state => ({ revision: state.revision + 1 })),
 open: dialog => set({ dialog }), close: () => set({ dialog: null }), dismiss: () => set({ notice: null }),
}));
