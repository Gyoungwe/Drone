import type { MemoryProjectStatus } from "@drone/shared";
import { useEffect, useState } from "react";
import { useT } from "../../i18n";
import { useSessionsStore } from "../../stores/sessions";
import { Switch } from "../ui/Switch";
import { SettingsRow } from "./SettingsRow";

/** 当前项目的观察记忆：开关 + 清空（展示层，便于样张与测试直接渲染）。 */
export function MemorySettingsView({
	status,
	onToggle,
	onClear,
}: {
	status: MemoryProjectStatus | null;
	onToggle: (enabled: boolean) => void;
	onClear: () => void;
}) {
	const t = useT();
	return (
		<SettingsRow
			title={t("settings.memory.title")}
			hint={t("settings.memory.hint", { count: status?.count ?? 0 })}
		>
			<div className="flex items-center gap-2" data-testid="memory-settings">
				<button
					type="button"
					className="rounded-md border border-border px-2 py-1 text-[11px] text-ink-2 transition-colors hover:border-border-strong hover:bg-hover disabled:opacity-50"
					disabled={!status?.count}
					onClick={onClear}
				>
					{t("settings.memory.clear")}
				</button>
				<Switch checked={status?.enabled === true} disabled={status === null} onCheckedChange={onToggle} />
			</div>
		</SettingsRow>
	);
}

export function MemorySettingsRow() {
	const cwd = useSessionsStore((s) => s.cwd);
	const [status, setStatus] = useState<MemoryProjectStatus | null>(null);
	useEffect(() => {
		if (!cwd) return;
		let live = true;
		void window.pi.memoryGetStatus(cwd).then((next) => live && setStatus(next));
		return () => {
			live = false;
		};
	}, [cwd]);
	if (!cwd) return null;
	return (
		<MemorySettingsView
			status={status}
			onToggle={(enabled) => void window.pi.memorySetEnabled(cwd, enabled).then(setStatus)}
			onClear={() => void window.pi.memoryClear(cwd).then(setStatus)}
		/>
	);
}
