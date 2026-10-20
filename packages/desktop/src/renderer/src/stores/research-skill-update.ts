import type { ResearchSkillUpdateState } from "@drone/shared";
import { create } from "zustand";
import { getPi } from "../api";

interface ResearchSkillUpdateStore {
	state: ResearchSkillUpdateState | null;
	/** Explicit user action; no startup/timer check is performed by the store. */
	check: () => Promise<void>;
}

export const useResearchSkillUpdateStore = create<ResearchSkillUpdateStore>()(() => ({
	state: null,
	check: () => getPi().checkResearchSkills(),
}));

let subscribed = false;

export function initResearchSkillUpdateStore(): void {
	if (subscribed) return;
	subscribed = true;
	getPi().onResearchSkillUpdateEvent((state) => useResearchSkillUpdateStore.setState({ state }));
}
