import type { CapabilityId } from "./capabilities";
import { getSkillCategory, type SkillCategory } from "./skill-catalog";
import { WORKFLOW_PROFILES, type WorkflowDirection, workflowProfile } from "./workflow-catalog";

/**
 * 能力 → 技能（workflow direction）的显式映射。
 * Explicit capability → skill-direction mapping. Each workflow skill belongs to exactly one capability,
 * so loading a capability exposes only its own skills and several loaded capabilities expose their union.
 */
export const CAPABILITY_SKILL_DIRECTIONS: Partial<Record<CapabilityId, WorkflowDirection>> = {
	visualization: "presentation",
	analysis: "analysis",
	literature: "evidence",
	writing: "writing",
	planning: "planning",
	coding: "engineering",
};

/** Sub-capabilities split out of `research`; each one also activates the research tool pack. */
export const RESEARCH_SKILL_CAPABILITIES: readonly CapabilityId[] = [
	"analysis",
	"literature",
	"writing",
	"planning",
];

/** Max skills listed per loaded capability (kept equal to the router's RESEARCH_SKILL_LIMIT). */
export const CAPABILITY_SKILL_LIMIT = 6;

export function capabilityForDirection(direction: string | undefined): CapabilityId | undefined {
	if (!direction) return undefined;
	for (const [id, dir] of Object.entries(CAPABILITY_SKILL_DIRECTIONS))
		if (dir === direction) return id as CapabilityId;
	return undefined;
}

/** Workflow capability that owns a skill, or undefined for internal / non-workflow skills. */
export function capabilityForSkill(name: string): CapabilityId | undefined {
	return capabilityForDirection(workflowProfile(name)?.direction);
}

/** All catalogued workflow skills owned by a capability (catalog order, unranked, unlimited). */
export function skillsForCapability(id: CapabilityId): string[] {
	const direction = CAPABILITY_SKILL_DIRECTIONS[id];
	if (!direction) return [];
	return WORKFLOW_PROFILES.filter((p) => p.direction === direction).map((p) => p.name);
}

/** Non-workflow skills (e.g. ~/.agents/skills) are grouped by catalog category into one capability. */
export const CATEGORY_CAPABILITY: Record<SkillCategory, CapabilityId> = {
	knowledge: "knowledge",
	research: "analysis",
	writing: "writing",
	presentation: "visualization",
	engineering: "coding",
	setup: "coding",
	collaboration: "external",
	support: "external",
	other: "external",
};

/** Owning capability of any skill: workflow direction first, then catalog category. */
export function skillCapability(name: string): CapabilityId | undefined {
	if (workflowProfile(name)) return capabilityForSkill(name);
	return CATEGORY_CAPABILITY[getSkillCategory(name)];
}
