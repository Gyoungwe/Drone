import { useEffect, useRef, useState } from "react";
import { useT } from "../../i18n";
import { AGENT_MODE_IDS, useAgentModeStore } from "../../stores/agent-mode";
import { isDraftSessionId, useSessionsStore } from "../../stores/sessions";
import { CheckIcon, ChevronDownIcon } from "../icons";

/** 模式 pill（P18）：单体 / 主从 / 集群，带说明；切换后提示工具变化与提示缓存重置。 */
export function ModePicker() {
	const t = useT();
	const sessionId = useSessionsStore((s) => s.activeSessionId);
	const mode = useAgentModeStore((s) => (sessionId ? (s.bySession[sessionId] ?? "lead") : "lead"));
	const setMode = useAgentModeStore((s) => s.setMode);
	const change = useAgentModeStore((s) => (s.lastChange?.sessionId === sessionId ? s.lastChange : null));
	const clearChange = useAgentModeStore((s) => s.clearChange);
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!open) return;
		const onDown = (e: PointerEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
		};
		window.addEventListener("pointerdown", onDown);
		return () => window.removeEventListener("pointerdown", onDown);
	}, [open]);
	useEffect(() => {
		if (!change) return;
		const id = setTimeout(clearChange, 6000);
		return () => clearTimeout(id);
	}, [change, clearChange]);
	const disabled = !sessionId || isDraftSessionId(sessionId);
	const diffText = change
		? [
				change.added.length ? `+${change.added.join(", ")}` : "",
				change.removed.length ? `−${change.removed.join(", ")}` : "",
			]
				.filter(Boolean)
				.join(" ")
		: "";
	return (
		<div ref={ref} className="relative">
			<button
				type="button"
				className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-ink-dim transition-colors hover:bg-hover hover:text-ink disabled:opacity-50"
				onClick={() => setOpen((v) => !v)}
				disabled={disabled}
				data-testid="mode-picker"
			>
				<span>{t(`composer.mode.${mode}`)}</span>
				<ChevronDownIcon className={open ? "rotate-180 transition-transform" : "transition-transform"} />
			</button>
			{change && !open && (
				<div className="mode-change-note" role="status">
					{t("composer.mode.changed", { mode: t(`composer.mode.${change.mode}`) })}
					{diffText ? ` ${diffText}` : ""} · {t("composer.mode.cacheReset")}
				</div>
			)}
			{open && (
				<div className="absolute bottom-full left-0 z-30 mb-2 w-72 overflow-hidden rounded-xl border border-border bg-surface p-1.5 shadow-pop">
					<p className="px-2.5 pt-1.5 pb-1 text-[11px] text-ink-faint">{t("composer.mode.title")}</p>
					{AGENT_MODE_IDS.map((id) => (
						<button
							key={id}
							type="button"
							className={`flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left text-xs transition-colors ${
								id === mode ? "bg-hover text-ink" : "text-ink-2 hover:bg-hover"
							}`}
							onClick={() => {
								setOpen(false);
								if (sessionId) void setMode(sessionId, id).catch(() => {});
							}}
						>
							<span className="flex flex-col gap-0.5">
								<span className="font-medium">{t(`composer.mode.${id}`)}</span>
								<span className="text-[11px] leading-snug text-ink-dim">{t(`composer.mode.${id}Hint`)}</span>
							</span>
							{id === mode && <CheckIcon size={13} className="shrink-0 text-accent" />}
						</button>
					))}
				</div>
			)}
		</div>
	);
}
