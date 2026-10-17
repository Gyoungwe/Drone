import type { ResearchSkillUpdateState } from "@drone/shared";
import { create } from "zustand";
import { getPi } from "../api";

interface ResearchSkillUpdateStore {
	state: ResearchSkillUpdateState | null;
}

export const useResearchSkillUpdateStore = create<ResearchSkillUpdateStore>()(() => ({ state: null }));

let subscribed = false;

export function initResearchSkillUpdateStore(): void {
	if (subscribed) return;
	subscribed = true;
	getPi().onResearchSkillUpdateEvent((state) => useResearchSkillUpdateStore.setState({ state }));
}
