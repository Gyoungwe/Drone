import {
	CAPABILITY_SKILL_DIRECTIONS,
	type CapabilityId,
	capabilityForDirection,
	capabilityForSkill,
	skillCapability,
	WORKFLOW_OWNER_NAMES,
	WORKFLOW_PROFILES,
	workflowProfile,
	workflowStage,
	workflowStageForSkill,
} from "@drone/shared";

import {
	ACADEMIC,
	type ResearchTopic,
	STAGE_PRIORITY,
	STOP_WORDS,
	TOPIC_SKILLS,
	TOPICS,
} from "./research-skill-topics";

export type { ResearchTopic } from "./research-skill-topics";
export interface ResearchSkillIntent {
	topics: ResearchTopic[];
	named: string[];
	primary?: string;
	comparison?: boolean;
}
export const EMPTY_RESEARCH_INTENT: ResearchSkillIntent = { topics: [], named: [] };
export function normalizeResearchIntent(value: unknown): ResearchSkillIntent {
	const v = value as Partial<ResearchSkillIntent> | null;
	const named = Array.isArray(v?.named)
		? [...new Set(v.named.filter((name) => typeof name === "string" && !!workflowProfile(name)))].slice(0, 24)
		: [];
	return {
		topics: Array.isArray(v?.topics)
			? [...new Set(v.topics.filter((id) => typeof id === "string" && Object.hasOwn(TOPICS, id)))].slice(
					0,
					24,
				)
			: [],
		named,
		...(typeof v?.primary === "string" && workflowProfile(v.primary) ? { primary: v.primary } : {}),
		...(v?.comparison === true ? { comparison: true } : {}),
	};
}
const namePatterns = WORKFLOW_PROFILES.map(({ name }) => ({
	name,
	pattern: new RegExp(`(?<![a-z0-9-])${name.replace(/-/g, "[- ]")}(?![a-z0-9-])`, "gi"),
}));
export function detectResearchIntent(text: string): ResearchSkillIntent {
	const direct = text.trim().match(/^\/skill:([a-z0-9-]+)(?:\s+([\s\S]*))?$/i);
	const directName = direct?.[1];
	const primary = directName && workflowProfile(directName) ? directName : undefined;
	const bounded = (direct ? (direct[2] ?? "") : text).slice(0, 16000);
	const matches = namePatterns.flatMap(({ name, pattern }) =>
		[...bounded.matchAll(pattern)].map((m) => ({ name, start: m.index, end: m.index + m[0].length })),
	);
	matches.sort((a, b) => a.start - b.start || b.end - a.end);
	let end = -1;
	const named: string[] = primary ? [primary] : [];
	for (const match of matches)
		if (match.start >= end) {
			named.push(match.name);
			end = match.end;
		}
	let topics = Object.entries(TOPICS)
		.filter(([, pattern]) => pattern.test(bounded))
		.map(([id]) => id) as ResearchTopic[];
	// A reply/revision is not a request to run another reviewer panel.
	if (topics.includes("response")) topics = topics.filter((t) => t !== "review" && t !== "writing");
	if (topics.includes("polishing")) topics = topics.filter((t) => t !== "writing");
	return normalizeResearchIntent({
		topics,
		named,
		primary,
		comparison: !primary && named.length > 1 && /比较|对比|区别|\bcompare\b|\bdifferences?\b/i.test(bounded),
	});
}
/** A new task/stage replaces old owners AND specialists. Bare continuation retains the checkpoint. */
export function changesResearchWorkflow(intent: ResearchSkillIntent): boolean {
	return (
		!!intent.primary ||
		intent.topics.length > 0 ||
		intent.named.some((n) => workflowProfile(n)?.direction !== "internal")
	);
}
export function mergeResearchIntent(a: ResearchSkillIntent, b: ResearchSkillIntent): ResearchSkillIntent {
	return changesResearchWorkflow(b) ? normalizeResearchIntent(b) : normalizeResearchIntent(a);
}
function topicCapability(topic: ResearchTopic): CapabilityId | undefined {
	const stage = workflowStage(topic);
	return capabilityForDirection(
		stage?.direction ?? workflowProfile(TOPIC_SKILLS[topic]?.[0] ?? "")?.direction,
	);
}
function topicSkills(topic: ResearchTopic): string[] {
	const stage = workflowStage(topic);
	const fromStage = stage?.commands.filter((n) => n.startsWith("skill:")).map((n) => n.slice(6)) ?? [];
	return [...new Set([...(TOPIC_SKILLS[topic] ?? []), ...fromStage])];
}
/** Skill capabilities requested by an intent (topics, named skills, explicit command). */
export function intentCapabilities(intent: ResearchSkillIntent): CapabilityId[] {
	const found = new Set<CapabilityId>();
	for (const topic of intent.topics) {
		const id = topicCapability(topic);
		if (id) found.add(id);
	}
	for (const name of [...intent.named, ...(intent.primary ? [intent.primary] : [])]) {
		const id = capabilityForDirection(workflowProfile(name)?.direction);
		if (id) found.add(id);
	}
	return [...found];
}
/**
 * `research` is now an umbrella: on its own it owns no workflow skills, but a research task adds the
 * skill capabilities its intent asks for. Sub-capabilities are always kept as loaded.
 */
export function effectiveSkillCapabilities(
	capabilities: ReadonlySet<CapabilityId>,
	intent: ResearchSkillIntent,
): Set<CapabilityId> {
	const out = new Set<CapabilityId>();
	for (const id of capabilities) if (CAPABILITY_SKILL_DIRECTIONS[id]) out.add(id);
	if (capabilities.has("research")) for (const id of intentCapabilities(intent)) out.add(id);
	return out;
}
export const RESEARCH_SKILL_LIMIT = 6;
export const RESEARCH_DISCOVERY_BYTES = 6000;
export interface RoutableSkill {
	name: string;
	description: string;
	filePath?: string;
	disableModelInvocation?: boolean;
}
export interface ResearchSkillSelection {
	names: string[];
	reasons: Record<string, string>;
	discoveryBytes: number;
	primaryWorkflow?: string;
	stage?: string;
	direction?: string;
	contract?: string;
	unavailableStage?: string;
}
export function selectResearchSkills(
	skills: readonly RoutableSkill[],
	capabilities: ReadonlySet<CapabilityId>,
	intent: ResearchSkillIntent,
	options: { academicEnabled?: boolean } = {},
): ResearchSkillSelection {
	const result: ResearchSkillSelection = { names: [], reasons: {}, discoveryBytes: 0 };
	const owned = effectiveSkillCapabilities(capabilities, intent);
	if (!owned.size) return result;
	// The primary stage is the highest-priority topic whose owning capability is loaded.
	const stageId = STAGE_PRIORITY.find((t) => {
		if (!intent.topics.includes(t)) return false;
		const owner = topicCapability(t);
		return !owner || owned.has(owner);
	});
	// Strict ownership: a workflow skill is a candidate only when its own capability is loaded (no cross-leak).
	const candidates = new Map(
		skills
			.filter((s) => {
				const profile = workflowProfile(s.name);
				if (
					!profile ||
					profile.direction === "internal" ||
					(s.disableModelInvocation && intent.primary !== s.name)
				)
					return false;
				if (profile.source === "academic" && !options.academicEnabled) return false;
				const owner = capabilityForDirection(profile.direction);
				return !!owner && owned.has(owner);
			})
			.map((s) => [s.name, s]),
	);
	const perCapability = new Map<CapabilityId, { count: number; bytes: number }>();
	const add = (name: string, reason: string, supporting = false) => {
		const skill = candidates.get(name);
		if (!skill || result.names.includes(name)) return false;
		if (!supporting && !intent.comparison && result.primaryWorkflow && WORKFLOW_OWNER_NAMES.has(name))
			return false;
		if (result.names.length >= RESEARCH_SKILL_LIMIT && !supporting) return false;
		const owner = capabilityForDirection(workflowProfile(name)?.direction) as CapabilityId;
		const used = perCapability.get(owner) ?? { count: 0, bytes: 0 };
		const bytes =
			Buffer.byteLength(
				JSON.stringify({ name, description: skill.description, location: skill.filePath ?? "" }),
			) + 96;
		if (
			used.count >= RESEARCH_SKILL_LIMIT ||
			(supporting ? used.bytes : result.discoveryBytes) + bytes > RESEARCH_DISCOVERY_BYTES
		)
			return false;
		perCapability.set(owner, { count: used.count + 1, bytes: used.bytes + bytes });
		result.names.push(name);
		result.reasons[name] = reason;
		result.discoveryBytes += bytes;
		return true;
	};
	const setPrimary = (name: string) => {
		if (intent.comparison || result.primaryWorkflow || !result.names.includes(name)) return;
		result.primaryWorkflow = name;
		const stage = workflowStageForSkill(name);
		result.stage = stage?.id;
		result.direction = workflowProfile(name)?.direction;
		result.contract = stage?.contract;
	};
	if (intent.primary && add(intent.primary, "explicit-command")) setPrimary(intent.primary);
	for (const name of intent.named)
		if (add(name, intent.comparison ? "comparison-reference" : "named-in-task")) setPrimary(name);
	// Exact/native choices are authoritative; do not start a second broad workflow from words in their arguments.
	if (result.names.length || intent.primary || intent.comparison) return result;
	// 1) One primary workflow owner from the highest-priority stage (keeps the stage contract).
	if (stageId) {
		const names = topicSkills(stageId);
		const academic = ACADEMIC[stageId];
		if (options.academicEnabled && academic) names.unshift(academic);
		for (const name of names)
			if (add(name, `topic:${stageId}`)) {
				setPrimary(name);
				break;
			}
		if (!result.names.length) result.unavailableStage = stageId;
	}
	// 2) Mixed requests (analysis/writing + figure): one supporting skill from the other side (visualization
	//    vs. the primary's capability), so the figure skill is not squeezed out by the analysis/writing owner.
	const primaryCapability = capabilityForSkill(result.primaryWorkflow ?? "");
	for (const topic of STAGE_PRIORITY) {
		if (!intent.topics.includes(topic) || topic === stageId) continue;
		const owner = topicCapability(topic);
		if (!owner || owner === primaryCapability || !owned.has(owner)) continue;
		// Companions: the figure side of analysis/writing + plot, and public bio databases next to an analysis.
		if (
			owner !== "visualization" &&
			primaryCapability !== "visualization" &&
			topic !== "bioDb" &&
			stageId !== "bioDb"
		)
			continue;
		if (result.names.some((n) => capabilityForSkill(n) === owner)) continue;
		for (const name of topicSkills(topic)) if (add(name, `topic:${topic}`, true)) break;
	}
	return result;
}
/**
 * Visible workflow skills: the routed owner + supporting skills, then each loaded capability filled up to
 * RESEARCH_SKILL_LIMIT by task relevance (catalog order as tie-break). Never crosses capability ownership.
 */
export interface CapabilitySkillOptions {
	academicEnabled?: boolean;
	/** Capabilities explicitly loaded through capability_load: their workflow skills are filled up to the limit. */
	fill?: ReadonlySet<CapabilityId>;
	/** Raw task / prompt text, used only in memory to rank fill candidates (never persisted). */
	taskText?: string;
	/** Skills pinned by `alwaysWith` are the always-on base and never count toward a capability. */
	isPinned?: (skill: RoutableSkill) => boolean;
}
export interface CapabilitySkillList {
	/** Ordered: primary → companion (routed) → fill. */
	names: string[];
	primary?: string;
	companions: string[];
}
/**
 * Visible skills: the routed owner + companion skills, then every active capability filled up to
 * RESEARCH_SKILL_LIMIT by task relevance. Workflow skills are only filled for explicitly loaded capabilities;
 * non-workflow skills (catalog category, e.g. ~/.agents) obey the same per-capability limit.
 */
export function orderedCapabilitySkills(
	skills: readonly RoutableSkill[],
	capabilities: ReadonlySet<CapabilityId>,
	intent: ResearchSkillIntent,
	options: CapabilitySkillOptions = {},
): CapabilitySkillList {
	const routed = selectResearchSkills(skills, capabilities, intent, options);
	const primary = routed.primaryWorkflow;
	const head = { names: [...routed.names], primary, companions: routed.names.filter((n) => n !== primary) };
	// An explicit /skill: or named choice stays authoritative: do not pad it with other skills.
	if (intent.primary || intent.comparison || (routed.names.length && intent.named.length)) return head;
	const owned = effectiveSkillCapabilities(capabilities, intent);
	const fill = new Set<CapabilityId>(options.fill ?? capabilities);
	const names = head.names;
	const count = new Map<CapabilityId, number>();
	for (const n of names) {
		const id = capabilityForSkill(n);
		if (id) count.set(id, (count.get(id) ?? 0) + 1);
	}
	const words = taskWords(intent, options.taskText);
	const groups = new Set<CapabilityId>([...owned]);
	for (const id of capabilities) groups.add(id);
	// coding as a tool pack (shell for an analysis): no engineering skill page unless the task is engineering.
	const toolOnlyCoding =
		!intentCapabilities(intent).includes("coding") &&
		[...groups].some((g) => g !== "coding" && !!CAPABILITY_SKILL_DIRECTIONS[g]);
	for (const id of groups) {
		if (id === "coding" && toolOnlyCoding) continue;
		const ranked = skills
			.filter((s) => {
				if (s.disableModelInvocation || options.isPinned?.(s)) return false;
				const profile = workflowProfile(s.name);
				if (profile) {
					if (!fill.has(id) || capabilityForDirection(profile.direction) !== id) return false;
					return profile.source !== "academic" || !!options.academicEnabled;
				}
				return skillCapability(s.name) === id;
			})
			.map((s, index) => ({
				s,
				index,
				score: relevance(s, words) + (workflowProfile(s.name) ? 0.5 : 0),
			}))
			.sort((a, b) => b.score - a.score || a.index - b.index);
		for (const { s } of ranked) {
			if ((count.get(id) ?? 0) >= RESEARCH_SKILL_LIMIT) break;
			if (names.includes(s.name)) continue;
			names.push(s.name);
			count.set(id, (count.get(id) ?? 0) + 1);
		}
	}
	return head;
}
/** Ranking tokens: routed topic skill names + task words (latin ≥3 chars, CJK bigrams). */
function taskWords(intent: ResearchSkillIntent, taskText = ""): string[] {
	const words = intent.topics.flatMap((t) => topicSkills(t)).flatMap((n) => n.split("-"));
	const text = taskText.toLowerCase().slice(0, 2000);
	for (const m of text.matchAll(/[a-z][a-z0-9]{2,}/g)) words.push(m[0]);
	for (const run of text.match(/[\u4e00-\u9fff]+/g) ?? [])
		for (let i = 0; i + 1 < run.length; i++) words.push(run.slice(i, i + 2));
	return [...new Set(words.filter((w) => w.length >= 2 && !STOP_WORDS.has(w)))];
}
function relevance(skill: RoutableSkill, words: string[]): number {
	if (!words.length) return 0;
	const text = `${skill.name} ${skill.description}`.toLowerCase();
	return words.filter((w) => text.includes(w)).length;
}
