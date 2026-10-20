import type { ResearchSkillSource } from "./research-skills";

export type BuiltinResearchSkillSource = Exclude<ResearchSkillSource, "academic">;

export interface ResearchSkillUpdatePack {
	id: BuiltinResearchSkillSource;
	/**
	 * Public update identity intentionally stays source-level.  The updater
	 * keeps commit/archive hashes private to its integrity gate; the renderer
	 * only needs to know which repository has a staged change.
	 */
	repository?: string;
}

export type ResearchSkillUpdateState =
	| { phase: "checking" }
	| { phase: "available"; packs: ResearchSkillUpdatePack[]; checkedAt: string }
	| { phase: "downloading"; packs: ResearchSkillUpdatePack[]; percent: number }
	| { phase: "ready"; packs: ResearchSkillUpdatePack[] }
	| { phase: "up-to-date"; checkedAt: string }
	| { phase: "error"; message: string; checkedAt?: string };
