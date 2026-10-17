import type { ResearchSkillSource } from "./research-skills";

export type BuiltinResearchSkillSource = Exclude<ResearchSkillSource, "academic">;

export interface ResearchSkillUpdatePack {
	id: BuiltinResearchSkillSource;
	currentCommit: string;
	latestCommit: string;
}

export type ResearchSkillUpdateState =
	| { phase: "checking" }
	| { phase: "available"; packs: ResearchSkillUpdatePack[] }
	| { phase: "downloading"; packs: ResearchSkillUpdatePack[]; percent: number }
	| { phase: "ready"; packs: ResearchSkillUpdatePack[] }
	| { phase: "up-to-date" }
	| { phase: "error"; message: string };
