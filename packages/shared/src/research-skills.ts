import sources from "./research-skill-sources.json";
import type { SkillCategory } from "./skill-catalog";

/** Data only: importing this catalog never installs a package or grants tool permissions. */
export const RESEARCH_SKILL_SOURCES = sources.sources;
export type ResearchSkillSource = "nature" | "scientific" | "academic";
const profiles = new Map(sources.sources.flatMap((source) => source.skills.map((skill) => [skill.name, { ...skill, source: source.id as ResearchSkillSource }] as const)));
export function researchSkillProfile(name: string) {
	return profiles.get(name.replace(/^skill:/, ""));
}
const presentation = new Set(["nature-figure", "nature-image2ppt", "nature-paper2ppt", "scientific-visualization", "scientific-schematics", "scientific-slides", "latex-posters", "pptx-posters", "infographics", "generate-image", "seaborn", "matplotlib", "markdown-mermaid-writing"]);
const writing = new Set(["nature-writing", "nature-polishing", "nature-response", "nature-reviewer", "nature-citation", "nature-paper-to-patent", "researchwrite", "scientific-writing", "peer-review", "citation-management", "research-grants", "venue-templates", "academic-paper", "academic-paper-reviewer"]);
export function researchSkillCategory(name: string): SkillCategory | undefined {
	if (!researchSkillProfile(name)) return undefined;
	if (name === "nature-shared") return "support";
	if (name === "nature-experiment-log") return "knowledge";
	return presentation.has(name) ? "presentation" : writing.has(name) ? "writing" : "research";
}
