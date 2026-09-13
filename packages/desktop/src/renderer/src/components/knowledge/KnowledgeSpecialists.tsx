import {
	type KnowledgeSpecialistMode,
	type KnowledgeSpecialistRun,
	type KnowledgeSpecialistSettings,
	PROTECTED_KNOWLEDGE_AGENTS,
	SUBAGENT_THINKING_LEVELS,
	type SubagentThinkingLevel,
} from "@percho/shared";
import { useState } from "react";
import { getPi } from "../../api";
import { useKnowledgeStore } from "../../stores/knowledge";
import { useSessionsStore } from "../../stores/sessions";
import { useSettingsStore } from "../../stores/settings";
import { Button } from "../ui/Button";
import { useKnowledgeText } from "./copy";

export function KnowledgeSpecialists({
	settings,
	bindingRevision,
	permitted,
	refresh,
	runs = [],
}: {
	settings?: KnowledgeSpecialistSettings;
	bindingRevision: number;
	permitted: boolean;
	refresh: () => Promise<unknown>;
	runs?: KnowledgeSpecialistRun[];
}) {
	const t = useKnowledgeText();
	const [busy, setBusy] = useState(false),
		[error, setError] = useState<string | null>(null);
	const prefs = useSettingsStore((s) => s.modelPrefs);
	const setSubagentModel = useSettingsStore((s) => s.setSubagentModel);
	const setSubagentThinking = useSettingsStore((s) => s.setSubagentThinking);
	const models = useSessionsStore((s) => s.models);
	async function change(mode: KnowledgeSpecialistMode) {
		if (!settings) return;
		setBusy(true);
		setError(null);
		try {
			await getPi().setKnowledgeSpecialistSettings({ mode, revision: settings.revision, bindingRevision });
			await refresh();
		} catch (e) {
			setError(String((e as Error).message || e));
		} finally {
			setBusy(false);
		}
	}
	return (
		<section className="rounded-xl border border-border p-4" data-testid="knowledge-specialists-settings">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h3 className="text-xs font-semibold">{t("specialists")}</h3>
				<select
					aria-label={t("specialistMode")}
					value={settings?.mode || "off"}
					disabled={busy || !settings || !permitted}
					onChange={(e) => void change(e.target.value as KnowledgeSpecialistMode)}
					className="rounded-lg border border-border bg-surface px-2 py-1 text-xs"
				>
					<option value="automatic">{t("specialistAuto")}</option>
					<option value="manual">{t("specialistManual")}</option>
					<option value="off">{t("specialistOff")}</option>
				</select>
			</div>
			<p className="mt-2 text-[11px] leading-relaxed text-ink-dim">{t("specialistCost")}</p>
			{!permitted && <p className="mt-2 text-[11px] text-warn">{t("specialistDenied")}</p>}
			{error && (
				<p role="alert" className="mt-2 break-words text-xs text-err">
					{error}
				</p>
			)}
			<div className="mt-3 grid gap-3" data-testid="knowledge-specialist-cards">
				{PROTECTED_KNOWLEDGE_AGENTS.map((agent) => {
					const selected = prefs?.subagentModels[agent.name] ?? "";
					const selectedThinking = prefs?.subagentThinking[agent.name] ?? "";
					const selectedModel = models.find((m) => `${m.provider}/${m.id}` === selected);
					const supportedThinking = selectedModel?.thinkingLevels?.length
						? selectedModel.thinkingLevels
						: SUBAGENT_THINKING_LEVELS;
					const last = [...runs].reverse().find((run) => run.role === agent.role);
					const trigger =
						agent.role === "reviewer"
							? t("specialistTriggerReview")
							: settings?.mode === "automatic"
								? t("specialistAuto")
								: settings?.mode === "manual"
									? t("specialistManual")
									: t("specialistOff");
					return (
						<article key={agent.name} className="rounded-xl border border-border bg-hover/30 p-3">
							<div className="flex items-start justify-between gap-2">
								<div>
									<strong className="text-[12px]">{t(`specialist_${agent.role}`)}</strong>
									<p className="font-mono text-[9px] text-ink-faint">{agent.name}</p>
								</div>
								<span className="rounded-full border border-border px-2 py-0.5 text-[9px] text-ink-faint">
									{trigger}
								</span>
							</div>
							<p className="mt-1 text-[11px] leading-relaxed text-ink-dim">
								{agent.role === "reviewer" ? agent.description : t(`specialist_${agent.role}_hint`)}
							</p>
							<div className="mt-2 grid gap-2 sm:grid-cols-2">
								<label className="text-[9px] text-ink-faint">
									<span className="mb-1 block">{t("specialistModel")}</span>
									<select
										value={selected}
										onChange={(e) => void setSubagentModel(agent.name, e.target.value || null)}
										className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-[11px] text-ink"
									>
										<option value="">{t("specialistFollowMain")}</option>
										{selected && !selectedModel && (
											<option value={selected}>
												{selected} · {t("specialistUnavailable")}
											</option>
										)}
										{models.map((m) => (
											<option key={`${m.provider}/${m.id}`} value={`${m.provider}/${m.id}`}>
												{m.providerName} · {m.label}
											</option>
										))}
									</select>
								</label>
								<label className="text-[9px] text-ink-faint">
									<span className="mb-1 block">{t("specialistThinking")}</span>
									<select
										value={selectedThinking}
										onChange={(e) =>
											void setSubagentThinking(
												agent.name,
												(e.target.value || null) as SubagentThinkingLevel | null,
											)
										}
										className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-[11px] text-ink"
									>
										<option value="">{t("specialistFollowMain")}</option>
										{selectedThinking && !supportedThinking.includes(selectedThinking) && (
											<option value={selectedThinking}>
												{selectedThinking} · {t("specialistUnavailable")}
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
							<div className="mt-2 rounded-lg bg-surface/70 p-2 text-[9px] text-ink-faint">
								<div>
									{t("specialistPermissions")}:{" "}
									<span className="font-mono">{agent.permissions.join(" · ")}</span>
								</div>
								<div className="mt-1">
									{t("specialistBudget")}: {agent.maxTurns} turns · {agent.maxTokens.toLocaleString()} output
									tokens · {settings?.timeoutMs ? `${Math.round(settings.timeoutMs / 1000)}s` : "120s"}
								</div>
							</div>
							<div className="mt-2 text-[9px] text-ink-faint">
								{t("specialistLastRun")}:{" "}
								{last
									? `${t(`worker_${last.status}`)}${last.model ? ` · ${last.model}` : ""}${last.thinkingLevel ? ` · ${last.thinkingLevel}` : ""}${last.totalTokens !== undefined ? ` · ${last.totalTokens.toLocaleString()} tokens` : ""}`
									: t("specialistNeverRun")}
							</div>
						</article>
					);
				})}
			</div>
			<p className="mt-3 text-[10px] text-ink-dim">{t("specialistLimits")}</p>
			<Button
				size="sm"
				className="mt-2"
				onClick={() => {
					useKnowledgeStore.getState().close();
					useSettingsStore.getState().openWith("models");
				}}
			>
				{t("specialistModels")}
			</Button>
		</section>
	);
}
