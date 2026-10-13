import { useEffect, useRef, useState } from "react";
import { useT } from "../../i18n";
import { clampThinkingLevel, THINKING_LEVELS } from "../../lib/thinking";
import { useAgentModeStore } from "../../stores/agent-mode";
import { useSessionsStore } from "../../stores/sessions";
import { ChevronDownIcon, CloseIcon } from "../icons";
import { ModelPicker } from "./ModelPicker";
import { ModePicker } from "./ModePicker";
import { ThinkingPicker } from "./ThinkingPicker";

/**
 * 合并的「模型 · 模式 · 强度」按钮（ClawsGO 式）：底栏只占一个 pill，点开是三行菜单，
 * 每行向右展开原有的选择列表（ModePicker / ModelPicker / ThinkingPicker 的 row 变体，逻辑不复制）。
 */
/** 模式切换提示：常驻在底栏按钮上方，直到手动关闭或下一次发送（use-composer-send 清除） */
function ModeChangeNote() {
	const t = useT();
	const sessionId = useSessionsStore((s) => s.activeSessionId);
	const change = useAgentModeStore((s) => (s.lastChange?.sessionId === sessionId ? s.lastChange : null));
	const clearChange = useAgentModeStore((s) => s.clearChange);
	if (!change) return null;
	const diffText = [
		change.added.length ? `+${change.added.join(", ")}` : "",
		change.removed.length ? `−${change.removed.join(", ")}` : "",
	]
		.filter(Boolean)
		.join(" ");
	return (
		<div
			className="mode-change-note"
			role="status"
			title={diffText ? `${t("composer.mode.cacheReset")}\n${diffText}` : t("composer.mode.cacheReset")}
			data-testid="mode-change-note"
		>
			<span className="truncate">
				{t("composer.mode.changed", { mode: t(`composer.mode.${change.mode}`) })} ·{" "}
				{t("composer.mode.cacheReset")}
			</span>
			<button
				type="button"
				className="mode-change-note-close"
				onClick={clearChange}
				aria-label={t("common.close")}
			>
				<CloseIcon size={10} />
			</button>
		</div>
	);
}

export function RunConfigPicker() {
	const t = useT();
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	const sessionId = useSessionsStore((s) => s.activeSessionId);
	const models = useSessionsStore((s) => s.models);
	const currentModel = useSessionsStore((s) => s.currentModel);
	const globalThinking = useSessionsStore((s) => s.thinkingLevel);
	const activeSession = useSessionsStore((s) => s.sessions.find((x) => x.sessionId === s.activeSessionId));
	const mode = useAgentModeStore((s) => (sessionId ? (s.bySession[sessionId] ?? "lead") : "lead"));

	useEffect(() => {
		if (!open) return;
		const onPointerDown = (e: PointerEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
		};
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") setOpen(false);
		};
		window.addEventListener("pointerdown", onPointerDown);
		window.addEventListener("keydown", onKeyDown);
		return () => {
			window.removeEventListener("pointerdown", onPointerDown);
			window.removeEventListener("keydown", onKeyDown);
		};
	}, [open]);

	const effective = activeSession?.model ?? currentModel;
	const model = effective
		? models.find((m) => m.provider === effective.provider && m.id === effective.modelId)
		: null;
	const modelLabel =
		model?.label ?? (effective ? `${effective.provider}/${effective.modelId}` : t("composer.modelDefault"));
	const supported = model?.thinkingLevels?.length ? model.thinkingLevels : [...THINKING_LEVELS];
	const level = clampThinkingLevel(activeSession?.thinkingLevel ?? globalThinking, supported);
	const levelText = (THINKING_LEVELS as readonly string[]).includes(level)
		? t(`thinkingLevels.${level as (typeof THINKING_LEVELS)[number]}`)
		: level;

	return (
		<div ref={ref} className="relative flex min-w-0 items-center gap-1" data-testid="run-config-picker">
			{!open && <ModeChangeNote />}
			<button
				type="button"
				className="flex max-w-[260px] items-center gap-2 rounded-lg px-2 py-1 text-xs text-ink-dim transition-colors hover:bg-hover hover:text-ink"
				onClick={() => setOpen((v) => !v)}
				aria-expanded={open}
				title={t("composer.modelGroupHint")}
			>
				<span className="truncate text-ink-2">{modelLabel}</span>
				<span aria-hidden="true">·</span>
				<span className="shrink-0">{t(`composer.mode.${mode}`)}</span>
				<span aria-hidden="true">·</span>
				<span className="shrink-0">{levelText}</span>
				<ChevronDownIcon className={open ? "rotate-180 transition-transform" : "transition-transform"} />
			</button>
			{open && (
				<div className="absolute right-0 bottom-full z-30 mb-2 w-64 rounded-xl border border-border bg-surface p-2 shadow-pop">
					<ModePicker row={t("composer.config.mode")} />
					<ModelPicker row={t("composer.config.model")} />
					<ThinkingPicker row={t("composer.config.effort")} />
				</div>
			)}
		</div>
	);
}
