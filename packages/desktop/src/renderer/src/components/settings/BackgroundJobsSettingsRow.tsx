import type { P5BackgroundStatus } from "@drone/shared";
import { useEffect, useState } from "react";
import { useT } from "../../i18n";
import { useSessionsStore } from "../../stores/sessions";
import { Switch } from "../ui/Switch";
import { SettingsRow } from "./SettingsRow";

export function parseDailyLimitInput(text: string): number | null {
	const trimmed = text.trim();
	if (/^[0-9]+$/.test(trimmed) === false) return null;
	const limit = Number(trimmed);
	return Number.isSafeInteger(limit) && limit >= 1 ? limit : null;
}

function DailyLimitInput({
	label,
	status,
	onSetLimit,
}: {
	label: string;
	status: P5BackgroundStatus | null;
	onSetLimit: (limit: number) => void;
}) {
	const [draft, setDraft] = useState(() => status?.dailyTokenLimit.toString() ?? "");
	useEffect(() => {
		setDraft(status?.dailyTokenLimit.toString() ?? "");
	}, [status]);

	function commitDraft() {
		if (status === null) return;
		const limit = parseDailyLimitInput(draft);
		if (limit === null || limit === status.dailyTokenLimit) {
			setDraft(String(status.dailyTokenLimit));
			return;
		}
		onSetLimit(limit);
	}

	return (
		<input
			aria-label={label}
			className="w-32 rounded-md border border-border bg-surface px-2 py-1 text-xs text-ink disabled:opacity-50"
			type="number"
			min={1}
			step={1}
			disabled={status === null}
			value={draft}
			onChange={(event) => setDraft(event.currentTarget.value)}
			onBlur={commitDraft}
			onKeyDown={(event) => {
				if (event.key === "Enter") {
					event.preventDefault();
					event.currentTarget.blur();
				}
			}}
		/>
	);
}

export function BackgroundJobsSettingsView({
	status,
	onToggle,
	onSetLimit,
}: {
	status: P5BackgroundStatus | null;
	onToggle: (enabled: boolean) => void;
	onSetLimit: (limit: number) => void;
}) {
	const t = useT();
	const toggleLabel = t("settings.backgroundJobs.toggle");
	const budgetLabel = t("settings.backgroundJobs.budget");
	const warning = status?.unknownUsage
		? t("settings.backgroundJobs.unknownUsage")
		: status?.exhausted
			? t("settings.backgroundJobs.exhausted")
			: null;
	return (
		<>
			<h3 className="settings-row-title">{t("settings.backgroundJobs.section")}</h3>
			<SettingsRow title={toggleLabel} hint={t("settings.backgroundJobs.toggleHint")}>
				<Switch
					aria-label={toggleLabel}
					checked={status?.enabled === true}
					disabled={status === null}
					onCheckedChange={onToggle}
				/>
			</SettingsRow>
			<SettingsRow title={budgetLabel} hint={t("settings.backgroundJobs.budgetHint")}>
				<DailyLimitInput label={budgetLabel} status={status} onSetLimit={onSetLimit} />
			</SettingsRow>
			{status && (
				<div className="py-2 text-xs text-ink-faint">
					<p>
						{t("settings.backgroundJobs.usage", {
							used: status.usedTokens.toLocaleString(),
							limit: status.dailyTokenLimit.toLocaleString(),
						})}
					</p>
					{warning && <p>{warning}</p>}
				</div>
			)}
		</>
	);
}

function WorkspaceBackgroundJobsSettings({ cwd }: { cwd: string }) {
	const [status, setStatus] = useState<P5BackgroundStatus | null>(null);
	useEffect(() => {
		let live = true;
		void window.pi.getBackgroundJobsStatus(cwd).then((next) => live && setStatus(next));
		return () => {
			live = false;
		};
	}, [cwd]);

	return (
		<BackgroundJobsSettingsView
			status={status}
			onToggle={(enabled) => void window.pi.setBackgroundJobsEnabled(cwd, enabled).then(setStatus)}
			onSetLimit={(limit) => void window.pi.setBackgroundJobsDailyLimit(cwd, limit).then(setStatus)}
		/>
	);
}

export function BackgroundJobsSettingsRow() {
	const cwd = useSessionsStore((state) => state.cwd);
	return cwd ? <WorkspaceBackgroundJobsSettings key={cwd} cwd={cwd} /> : null;
}
