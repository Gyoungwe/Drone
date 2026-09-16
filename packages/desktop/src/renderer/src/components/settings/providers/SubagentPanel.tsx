import {
	PROTECTED_KNOWLEDGE_AGENTS,
	SUBAGENT_THINKING_LEVELS,
	type SubagentThinkingLevel,
} from "@drone/shared";
import { useT } from "../../../i18n";
import { useSessionsStore } from "../../../stores/sessions";
import { useSettingsStore } from "../../../stores/settings";

const PROTECTED = new Map<string, (typeof PROTECTED_KNOWLEDGE_AGENTS)[number]>(
	PROTECTED_KNOWLEDGE_AGENTS.map((agent) => [agent.name, agent]),
);

/** User-controlled model/thinking policy. Protected identities keep immutable host-owned permissions. */
export function SubagentPanel() {
	const t = useT();
	const loading = useSettingsStore((s) => s.loading);
	const subagents = useSettingsStore((s) => s.subagents);
	const prefs = useSettingsStore((s) => s.modelPrefs);
	const setSubagentModel = useSettingsStore((s) => s.setSubagentModel);
	const setSubagentThinking = useSettingsStore((s) => s.setSubagentThinking);
	const models = useSessionsStore((s) => s.models);

	if (loading && prefs === null)
		return <p className="py-8 text-center text-[13px] text-ink-faint">{t("settings.loading")}</p>;
	if (subagents.length === 0)
		return (
			<p className="py-4 text-center text-[13px] text-ink-faint">{t("settings.models.subagentsEmpty")}</p>
		);

	return (
		<div>
			<p className="mb-3 text-[11px] leading-relaxed text-ink-faint">{t("settings.models.subagentHint")}</p>
			<div className="grid gap-3" data-testid="subagent-settings-cards">
				{subagents.map((agent) => {
					const selected = prefs?.subagentModels[agent.name] ?? "";
					const selectedThinking = prefs?.subagentThinking[agent.name] ?? "";
					const selectedModel = models.find((model) => `${model.provider}/${model.id}` === selected);
					const hasSelectedModel = !selected || !!selectedModel;
					const protectedProfile = PROTECTED.get(agent.name);
					const supportedThinking = selectedModel?.thinkingLevels?.length
						? selectedModel.thinkingLevels
						: SUBAGENT_THINKING_LEVELS;
					return (
						<section
							key={agent.name}
							className="rounded-xl border border-border bg-surface p-3"
							data-agent={agent.name}
						>
							<div className="flex items-start justify-between gap-3">
								<div className="min-w-0">
									<p className="truncate text-[13px] font-medium text-ink">
										{protectedProfile?.label ?? agent.name}
									</p>
									<p className="break-all font-mono text-[10px] text-ink-faint">{agent.name}</p>
								</div>
								<span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[9px] text-ink-faint">
									{protectedProfile ? t("settings.models.protected") : agent.source}
								</span>
							</div>
							{agent.description && (
								<p className="mt-1.5 text-[11px] leading-relaxed text-ink-dim">{agent.description}</p>
							)}
							<div className="mt-3 grid gap-2 sm:grid-cols-2">
								<label className="text-[10px] text-ink-faint">
									<span className="mb-1 block">{t("settings.models.agentModel")}</span>
									<select
										className="w-full rounded-lg border border-border bg-bg px-2.5 py-1.5 text-[12px] text-ink outline-none focus:border-ink-faint"
										value={selected}
										onChange={(event) => void setSubagentModel(agent.name, event.target.value || null)}
									>
										<option value="">{t("settings.models.inherit")}</option>
										{selected && !hasSelectedModel && (
											<option value={selected}>
												{selected} · {t("settings.models.unavailable")}
											</option>
										)}
										{models.map((model) => (
											<option key={`${model.provider}/${model.id}`} value={`${model.provider}/${model.id}`}>
												{model.providerName} · {model.label}
											</option>
										))}
									</select>
								</label>
								<label className="text-[10px] text-ink-faint">
									<span className="mb-1 block">{t("settings.models.agentThinking")}</span>
									<select
										className="w-full rounded-lg border border-border bg-bg px-2.5 py-1.5 text-[12px] text-ink outline-none focus:border-ink-faint"
										value={selectedThinking}
										onChange={(event) =>
											void setSubagentThinking(
												agent.name,
												(event.target.value || null) as SubagentThinkingLevel | null,
											)
										}
									>
										<option value="">{t("settings.models.inheritThinking")}</option>
										{selectedThinking && !supportedThinking.includes(selectedThinking) && (
											<option value={selectedThinking}>
												{selectedThinking} · {t("settings.models.unavailable")}
											</option>
										)}
										{SUBAGENT_THINKING_LEVELS.filter((level) => supportedThinking.includes(level)).map(
											(level) => (
												<option key={level} value={level}>
													{level}
												</option>
											),
										)}
									</select>
								</label>
							</div>
							{protectedProfile && (
								<div className="mt-3 rounded-lg bg-hover p-2 text-[10px] text-ink-faint">
									<div>
										{t("settings.models.permissions")}:{" "}
										<span className="font-mono">{protectedProfile.permissions.join(" · ")}</span>
									</div>
									<div className="mt-1">
										{t("settings.models.budget")}: {protectedProfile.maxTurns} turns ·{" "}
										{protectedProfile.maxTokens.toLocaleString()} output tokens ·{" "}
										{t("settings.models.protectedHint")}
									</div>
								</div>
							)}
						</section>
					);
				})}
			</div>
		</div>
	);
}
