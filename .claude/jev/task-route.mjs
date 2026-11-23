/**
 * Jev tool point at UserPromptSubmit (paper §VII, tiered disclosure): Jev classifies the prompt into one
 * task kind; code maps the kind to the skills worth naming. Only skill names and a one-line reason are
 * injected (tier 1); the model reads the one SKILL.md it needs. An unsure answer names nothing, and
 * without a key the keyword heuristic in skill-hints.mjs stays in charge.
 */
import { decision } from "./decision.mjs";
import { UI_SKILLS } from "./skill-hints.mjs";

/** The chosen kind must carry at least this probability before anything is injected. */
export const TASK_THRESHOLD = 0.6;

export const KIND_SKILLS = {
	plugin_change: { skills: ["drone-plugin-dev"], why: "插件改动" },
	host_plugin_wiring: { skills: ["drone-plugin-dev", "drone-maintenance"], why: "宿主接插件/跨仓" },
	slimming: { skills: ["drone-slimming"], why: "删旧轨/合包/拆大文件" },
	ui: { skills: UI_SKILLS, why: "UI 改动" },
	host_other: { skills: [], why: "" },
	no_code: { skills: [], why: "" },
};

/** `answer` is Jev's `task_kind` Choice; `hasSkill(name)` says whether the checkout has that skill. */
export function taskHint(answer, hasSkill) {
	const p = answer.probabilities?.[answer.choice] ?? 0;
	const kind = KIND_SKILLS[answer.choice];
	const entry = decision("skills", answer.choice, "jev-task-kind", Number(p.toFixed(2)));
	if (kind === undefined || p < TASK_THRESHOLD) return { entry: { ...entry, answer: "unsure" }, text: null };
	const skills = kind.skills.filter(hasSkill);
	if (skills.length === 0) return { entry, text: null };
	return {
		entry,
		text: `[jev] 任务判为${kind.why}（p=${p.toFixed(2)}）：先读 .agents/skills/ 下 ${skills.join("、")} 中需要的那份 SKILL.md。`,
	};
}
