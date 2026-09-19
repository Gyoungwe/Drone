import type { TaskMilestone } from "@drone/shared";
import { translateOptional, useI18nStore } from "../../i18n";
import type { SlotPropsMap, UI_SLOTS } from "../../plugins/slots";
import { useSessionsStore } from "../../stores/sessions";
import { CARD_TONE_CLASS, followCardLink, toneForStatus } from "../panel/card-links";

const CORE_KINDS = new Set(["file", "human_review"]);
const CORE_FIELDS = new Set(["kind", "path", "sha256"]);

/** 槽位 fallback：宿主默认渲染 */
export function DefaultMilestoneEvidence({ renderDefault }: SlotPropsMap[typeof UI_SLOTS.MilestoneEvidence]) {
	return <>{renderDefault()}</>;
}

/**
 * 扩展验收器（zotero_item / wiki_review / …）里程碑的证据行（挂钩 2 / 4 的宿主默认渲染）：
 * 状态记号或验收器给的一句话摘要 + 附注 + 声明字段（DOI 等）+ 动作链接。
 * 核心不认识任何领域：Zotero / Wiki 的措辞与链接都来自扩展写进 evidence 的 summary / note / links。
 */
export function MilestoneEvidence({ milestone }: { milestone: TaskMilestone }) {
	// 核心验收种类（file / human_review）没有扩展证据行：不订阅任何 store，直接不渲染
	if (CORE_KINDS.has(milestone.acceptance.kind)) return null;
	return <ExtensionEvidence milestone={milestone} />;
}

function ExtensionEvidence({ milestone }: { milestone: TaskMilestone }) {
	const language = useI18nStore((s) => s.language);
	const cwd = useSessionsStore((s) => s.cwd);
	const { acceptance, evidence } = milestone;
	const state = milestone.state === "completed" ? "found" : evidence?.state || "pending";
	const text =
		evidence?.summary ||
		(state === "pending" ? null : translateOptional(language, `flow.status.${state}`)) ||
		(state === "pending" ? translateOptional(language, "flow.status.pending") : null) ||
		state;
	const fields = Object.entries(acceptance).filter(
		([key, value]) => !CORE_FIELDS.has(key) && typeof value === "string" && value,
	);
	return (
		<div className="ml-5 mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-ink-dim">
			<span className={CARD_TONE_CLASS[toneForStatus(state)]}>{text}</span>
			{evidence?.note ? <span className="text-ink-faint">{evidence.note}</span> : null}
			{state !== "found" && evidence?.reason && !evidence.summary ? (
				<span className="text-ink-faint">{evidence.reason}</span>
			) : null}
			{fields.map(([key, value]) => (
				<code key={key} className="break-all text-ink-faint" title={key}>
					{value}
				</code>
			))}
			{evidence?.links?.map((link) =>
				link.kind === "note" ? null : (
					<button
						key={`${link.kind}:${link.target}`}
						type="button"
						className="text-accent hover:underline"
						onClick={() => followCardLink(link, { cwd, label: milestone.title })}
					>
						{(link.i18n ? translateOptional(language, link.i18n) : null) ?? link.label}
					</button>
				),
			)}
		</div>
	);
}
