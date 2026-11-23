/**
 * Jev tool point, tier 1 (paper §VII, Fig. 5): most repository skills are UI and animation guides that do
 * not concern host or plugin work. Name them only when the prompt is about UI; the model then reads the
 * one SKILL.md it picks. A keyword match is a heuristic, so the answer carries a lower confidence.
 */
import { decision } from "./decision.mjs";

const UI_TOPIC =
	/\b(?:UI|CSS|animations?|animate|components?|renderer|tailwind|swift|expo|mobile|motion)\b|界面|动画|动效|样式|组件|交互|设计稿|移动端/i;

export const UI_SKILLS = [
	"animate",
	"animate-expo",
	"animation-performance",
	"animation-vocabulary",
	"apple-design",
	"ask-sonner",
	"break-ui",
	"emil-design-eng",
	"find-animation-opportunities",
	"improve-animations",
	"mobile-native",
	"pick-ui-library",
	"prototype",
	"review-animations",
	"write-swift",
];

export function skillHint(prompt) {
	if (!UI_TOPIC.test(prompt)) return null;
	return {
		...decision("skills", "short", "ui-skills", 0.6),
		text: `[jev] 本任务涉及 UI：.agents/skills/ 下有 ${UI_SKILLS.join("、")}；需要时只读选中的那份 SKILL.md。`,
	};
}
