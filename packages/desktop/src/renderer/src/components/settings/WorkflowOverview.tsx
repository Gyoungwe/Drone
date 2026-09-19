import {
	type LoadedSkill,
	WORKFLOW_DIRECTIONS,
	WORKFLOW_STAGES,
	workflowProfile,
	resolveWorkflowStage,
	type WorkflowDirection,
} from "@drone/shared";
import { useState } from "react";
import { useI18nStore, useT } from "../../i18n";
import { useSettingsStore } from "../../stores/settings";

/** A browse view only. Expanding a direction never activates skills or executes a workflow. */
export function WorkflowOverview({
	skills,
	onInspect,
}: {
	skills: LoadedSkill[];
	onInspect: (id: WorkflowDirection) => void;
}) {
	const t = useT();
	const language = useI18nStore((s) => s.language);
	const [direction, setDirection] = useState<WorkflowDirection | null>(null);
	const commands = skills.map((s) => ({ name: `skill:${s.name}`, supported: true }));
	const active = useSettingsStore((s) => s.capabilities);
	return (
		<section data-testid="workflow-overview">
			<h3 className="text-sm font-medium text-ink">{t("workflows.title")}</h3>
			<p className="mt-1 text-xs leading-relaxed text-ink-faint">{t("workflows.hint")}</p>
			<div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
				{WORKFLOW_DIRECTIONS.map((d) => {
					const count = skills.filter((s) => workflowProfile(s.name)?.direction === d.id).length;
					return (
						<button
							type="button"
							key={d.id}
							data-workflow-direction={d.id}
							aria-expanded={direction === d.id}
							className={`rounded-xl border p-3 text-left focus-visible:outline focus-visible:outline-accent ${direction === d.id ? "border-accent bg-accent/10" : "border-border bg-hover/30 hover:bg-hover"}`}
							onClick={() => setDirection((previous) => (previous === d.id ? null : d.id))}
						>
							<span className="block text-sm font-medium text-ink">{d.label[language]}</span>
							<span className="mt-1 block text-xs text-ink-faint">{t("workflows.count", { count })}</span>
						</button>
					);
				})}
			</div>
			{direction && (
				<div className="mt-3 rounded-xl border border-border p-3">
					<p className="mb-2 text-xs text-ink-faint">{t("workflows.stageHint")}</p>
					<ul className="divide-y divide-border">
						{WORKFLOW_STAGES.filter((s) => s.direction === direction).map((stage) => {
							const resolved = resolveWorkflowStage(stage, commands);
							// Slash templates require the real SDK command catalog, not a guessed installed skill.
							const template = stage.commands.some((c) => !c.startsWith("skill:"));
							return (
								<li key={stage.id} className="py-2">
									<span className="text-xs text-ink">{stage.label[language]}</span>
									<span className="ml-2 text-[11px] text-ink-faint">
										{resolved
											? `/${resolved.name}`
											: t(template ? "workflows.checkCommand" : "workflows.unavailable")}
									</span>
								</li>
							);
						})}
					</ul>
					<button
						type="button"
						className="mt-2 text-xs text-accent hover:underline"
						onClick={() => onInspect(direction)}
					>
						{t("workflows.inspect")}
					</button>
				</div>
			)}
			{active && (
				<p className="mt-2 text-xs text-ink-faint">
					{t("workflows.visible", { count: active.visibleSkills.length })}
				</p>
			)}
		</section>
	);
}
