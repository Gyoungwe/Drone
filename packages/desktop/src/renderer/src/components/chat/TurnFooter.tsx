import type { RunInspectorTurn, TurnChanges, TurnTiming, UsageDisplayTotal } from "@drone/shared";
import { useEffect, useReducer } from "react";
import { useT } from "../../i18n";
import { compactNumber, formatDuration } from "../../lib/format";
import { useUiStore } from "../../stores/ui";
import { ClockIcon } from "../icons";

/**
 * 轮次计时：轮开始即出现，运行中 1s 心跳实时跳动；run 结束定格（timing.endedAt）。
 */
function TurnTimer({ timing, running }: { timing: TurnTiming; running: boolean }) {
	const t = useT();
	const [, tick] = useReducer((n: number) => n + 1, 0);
	useEffect(() => {
		if (!running) return;
		const id = window.setInterval(tick, 1000);
		return () => window.clearInterval(id);
	}, [running]);
	const elapsed = running
		? Math.max(0, Date.now() - timing.startedAt)
		: timing.endedAt !== undefined
			? Math.max(0, timing.endedAt - timing.startedAt)
			: null;
	if (elapsed === null) return null;
	return (
		<span
			role="timer"
			className={`turn-diff-timer${running ? " turn-diff-timer-live" : ""}`}
			aria-label={t("diff.workedFor", { duration: formatDuration(elapsed) })}
		>
			<ClockIcon size={12} />
			<span className="turn-diff-timer-num">{formatDuration(elapsed)}</span>
		</span>
	);
}

/**
 * 轮末页脚：一行讲完「用了多久 · 改了什么 · 花了多少 · 干了几步」，原 TurnDiffChip + UsageSettlement +
 * RunInspector 三张卡合一。明细一律去右侧面板：文件 chip → 「变更」页签并定位首个文件卡；
 * 工具 chip → 「过程」页签定位到本轮。运行中的轮只显示计时（数据未定稿不出账）。
 */
export function TurnFooter({
	turnIndex,
	changes,
	timing,
	usage,
	run,
	running,
	entering,
}: {
	turnIndex: number;
	changes?: TurnChanges;
	timing?: TurnTiming;
	usage?: UsageDisplayTotal;
	run?: RunInspectorTurn;
	running: boolean;
	entering: boolean;
}) {
	const t = useT();
	const setDiffFocus = useUiStore((s) => s.setDiffFocus);
	const showDiffSidebar = useUiStore((s) => s.showDiffSidebar);
	const focusProcessTurn = useUiStore((s) => s.focusProcessTurn);
	const fileCount = changes?.files.length ?? 0;
	const toolCount = run?.tools.length ?? 0;
	const responses = run?.models.reduce((n, m) => n + m.responses, 0) ?? 0;
	const errors = run?.errors ?? 0;
	const usageTitle = usage
		? `in ${compactNumber(usage.input)} · out ${compactNumber(usage.output)} · cache ${compactNumber(
				usage.cacheRead,
			)}${usage.cost != null ? ` · $${usage.cost.toFixed(4)}` : ""}`
		: undefined;

	return (
		<div className={`turn-footer${entering ? " turn-diff-enter" : ""}`} data-testid="turn-footer">
			{timing && <TurnTimer timing={timing} running={running} />}
			{changes && fileCount > 0 && (
				<button
					type="button"
					className="turn-footer-chip"
					onClick={() => {
						const first = changes.files[0]?.sections[0]?.toolCallKey;
						if (first) setDiffFocus(first);
						else showDiffSidebar();
					}}
					title={changes.files.map((f) => f.path).join("\n")}
				>
					<span>{t("turnFooter.files", { count: fileCount })}</span>
					<span className="turn-diff-added">+{changes.totalAdded}</span>
					<span className="turn-diff-removed">−{changes.totalRemoved}</span>
				</button>
			)}
			{!running && usage && usage.total > 0 && (
				<span className="turn-footer-stat" title={usageTitle}>
					{compactNumber(usage.total)} tok
					{usage.cacheRate != null && usage.cacheRate > 0
						? ` · ${(usage.cacheRate * 100).toFixed(0)}% cache`
						: ""}
				</span>
			)}
			{!running && run && (toolCount > 0 || responses > 0) && (
				<button
					type="button"
					className={`turn-footer-chip${errors > 0 ? " has-error" : ""}`}
					onClick={() => focusProcessTurn(turnIndex)}
					title={t("turnFooter.inPanel")}
				>
					{toolCount > 0 && <span>{t("turnFooter.tools", { count: toolCount })}</span>}
					{toolCount > 0 && responses > 0 && <span className="turn-footer-sep">·</span>}
					{responses > 0 && <span>{t("turnFooter.responses", { count: responses })}</span>}
					{errors > 0 && <span className="turn-footer-err">{t("turnFooter.errors", { count: errors })}</span>}
				</button>
			)}
		</div>
	);
}
