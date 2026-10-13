import { useEffect, useRef, useState } from "react";
import { useT } from "../../i18n";
import { AGENT_MODE_IDS, useAgentModeStore } from "../../stores/agent-mode";
import { isDraftSessionId, useSessionsStore } from "../../stores/sessions";
import { CheckIcon, ChevronDownIcon, ChevronRightIcon } from "../icons";

/** 模式 pill（P18）：单体 / 主从 / 集群，带说明；切换后提示工具变化与提示缓存重置。 */
export function ModePicker({ row }: { row?: string } = {}) {
	const t = useT();
	const sessionId = useSessionsStore((s) => s.activeSessionId);
	const mode = useAgentModeStore((s) => (sessionId ? (s.bySession[sessionId] ?? "lead") : "lead"));
	const setMode = useAgentModeStore((s) => s.setMode);
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
	const disabled = !sessionId || isDraftSessionId(sessionId);
	return (
		<div ref={ref} className={row ? "relative w-full" : "relative"}>
			<button
				type="button"
				className={
					row
						? "flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-[13px] text-ink transition-colors hover:bg-hover disabled:opacity-50"
						: "flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-ink-dim transition-colors hover:bg-hover hover:text-ink disabled:opacity-50"
				}
				onClick={() => setOpen((v) => !v)}
				disabled={disabled}
				data-testid="mode-picker"
			>
				{row ? (
					<>
						<span>{row}</span>
						<span className="flex min-w-0 items-center gap-1 text-ink-dim">
							<span className="truncate">{t(`composer.mode.${mode}`)}</span>
							<ChevronRightIcon size={12} />
						</span>
					</>
				) : (
					<>
						<span>{t(`composer.mode.${mode}`)}</span>
						<ChevronDownIcon className={open ? "rotate-180 transition-transform" : "transition-transform"} />
					</>
				)}
			</button>
			{open && (
				<div
					className={`absolute ${row ? "left-full bottom-0 ml-2 z-40" : "bottom-full left-0 z-30 mb-2"} w-72 overflow-hidden rounded-xl border border-border bg-surface p-2 shadow-pop`}
				>
					<p className="px-3 pt-2 pb-1 text-[11px] text-ink-faint">{t("composer.mode.title")}</p>
					{AGENT_MODE_IDS.map((id) => (
						<button
							key={id}
							type="button"
							className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-xs transition-colors ${
								id === mode ? "bg-hover text-ink" : "text-ink-2 hover:bg-hover"
							}`}
							onClick={() => {
								setOpen(false);
								if (sessionId) void setMode(sessionId, id).catch(() => {});
							}}
						>
							<span className="flex flex-col gap-0.5">
								<span className="font-medium">{t(`composer.mode.${id}`)}</span>
								<span className="text-xs leading-snug text-ink-dim">{t(`composer.mode.${id}Hint`)}</span>
							</span>
							{id === mode && <CheckIcon size={13} className="shrink-0 text-accent" />}
						</button>
					))}
				</div>
			)}
		</div>
	);
}
