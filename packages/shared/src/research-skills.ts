import { workflowProfile } from "./workflow-catalog";
import sources from "./research-skill-sources.json";
import type { SkillCategory } from "./skill-catalog";

/** Data only: importing this catalog never installs a package or grants tool permissions. */
export const RESEARCH_SKILL_SOURCES = sources.sources;
export type ResearchSkillSource = "nature" | "scientific" | "academic";
const profiles = new Map(
	sources.sources.flatMap((source) =>
		source.skills.map(
			(skill) => [skill.name, { ...skill, source: source.id as ResearchSkillSource }] as const,
		),
	),
);
export function researchSkillProfile(name: string) {
	return profiles.get(name.replace(/^skill:/, ""));
}
export function researchSkillCategory(name: string): SkillCategory | undefined {
	if (!researchSkillProfile(name)) return undefined;
	if (name === "nature-shared") return "support";
	if (name === "nature-experiment-log") return "knowledge";
	const direction = workflowProfile(name)?.direction;
	return direction === "writing"
		? "writing"
		: direction === "presentation"
			? "presentation"
			: direction === "engineering"
				? "engineering"
				: "research";
}
