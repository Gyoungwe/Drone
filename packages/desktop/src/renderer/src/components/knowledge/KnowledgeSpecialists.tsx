import {
	KNOWLEDGE_SPECIALISTS,
	type KnowledgeSpecialistMode,
	type KnowledgeSpecialistSettings,
} from "@percho/shared";
import { useState } from "react";
import { getPi } from "../../api";
import { useKnowledgeStore } from "../../stores/knowledge";
import { useSettingsStore } from "../../stores/settings";
import { Button } from "../ui/Button";
import { useKnowledgeText } from "./copy";
export function KnowledgeSpecialists({
	settings,
	bindingRevision,
	permitted,
	refresh,
}: {
	settings?: KnowledgeSpecialistSettings;
	bindingRevision: number;
	permitted: boolean;
	refresh: () => Promise<unknown>;
}) {
	const t = useKnowledgeText(),
		[busy, setBusy] = useState(false),
		[error, setError] = useState<string | null>(null);
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
					disabled={busy || !settings}
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
			<details className="mt-3 text-xs">
				<summary className="cursor-pointer">{t("specialistPermissions")}</summary>
				{KNOWLEDGE_SPECIALISTS.map((agent) => (
					<div key={agent.name} className="mt-2 rounded-lg bg-hover p-2">
						<strong>{t(`specialist_${agent.role}`)}</strong>
						<p className="break-all font-mono text-[10px] text-ink-faint">{agent.name}</p>
						<p className="mt-1 text-[11px]">{t(`specialist_${agent.role}_hint`)}</p>
						<p className="mt-1 font-mono text-[10px] text-ink-faint">{agent.permissions.join(" · ")}</p>
					</div>
				))}
			</details>
			<p className="mt-2 text-[10px] text-ink-dim">{t("specialistLimits")}</p>
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
