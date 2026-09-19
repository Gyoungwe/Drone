import { deriveRunInspectors, deriveTurnTimings, deriveTurnUsage, type UIMessage } from "@drone/shared";
import { useEffect, useMemo, useRef } from "react";
import { useT } from "../../i18n";
import { compactNumber, formatDuration } from "../../lib/format";
import { selectTranscript, useTranscriptStore } from "../../stores/transcript";
import { useUiStore } from "../../stores/ui";
import { RunInspector } from "../chat/RunInspector";
import { SessionUsageFooter } from "../chat/UsageSettlement";

/**
 * 「过程」页签：会话累计用量 → 每轮运行记录（最新在上；模型/工具/阶段/来源/诊断全在这里，
 * 消息流里只留一行页脚）。
 */
export function ProcessPane({ sessionId }: { sessionId: string | null }) {
	const t = useT();
	const transcript = useTranscriptStore((s) => selectTranscript(s, sessionId));
	const messages = transcript.messages;
	const inspectors = useMemo(() => deriveRunInspectors(messages), [messages]);
	const timings = useMemo(
		() => deriveTurnTimings(messages, transcript.runEndedAt),
		[messages, transcript.runEndedAt],
	);
	const usages = useMemo(() => deriveTurnUsage(messages), [messages]);
	const prompts = useMemo(
		() =>
			messages.filter((m): m is Extract<UIMessage, { kind: "user" }> => m.kind === "user").map((m) => m.text),
		[messages],
	);
	const focus = useUiStore((s) => s.processFocus);
	const clearFocus = useUiStore((s) => s.clearProcessFocus);
	const listRef = useRef<HTMLDivElement>(null);

	// TurnFooter → 定位某轮：展开并滚到该卡
	useEffect(() => {
		if (!focus) return;
		const card = listRef.current?.querySelector(`[data-turn="${focus.turnIndex}"]`);
		if (card instanceof HTMLElement) {
			const details = card.querySelector("details");
			if (details instanceof HTMLDetailsElement) details.open = true;
			card.scrollIntoView({
				block: "start",
				behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
			});
			card.classList.remove("jump-flash");
			void card.offsetWidth;
			card.classList.add("jump-flash");
			setTimeout(() => card.classList.remove("jump-flash"), 1200);
		}
		clearFocus();
	}, [focus, clearFocus]);

	const turnCount = Math.max(inspectors.length, timings.length);
	const turns = Array.from({ length: turnCount }, (_, i) => i).reverse();

	if (!sessionId || messages.length === 0) return <p className="panel-empty">{t("panel.processEmpty")}</p>;

	return (
		<div className="context-pane" ref={listRef}>
			<SessionUsageFooter sessionId={sessionId} />
			{turns.map((i) => {
				const timing = timings[i];
				const usage = usages[i];
				const run = inspectors[i];
				const running = transcript.agentActive && i === turnCount - 1;
				const duration = timing
					? timing.endedAt
						? formatDuration(timing.endedAt - timing.startedAt)
						: running
							? t("panel.status.working")
							: "—"
					: "—";
				return (
					<section key={i} className="panel-card" data-turn={i}>
						<header className="flex items-baseline gap-2 text-[11px] text-ink-dim">
							<span className="shrink-0 font-medium text-ink">{t("panel.turn", { n: i + 1 })}</span>
							<span className="shrink-0 tabular-nums">{duration}</span>
							{usage && (
								<span className="shrink-0 tabular-nums">
									{compactNumber(usage.total)} tok
									{usage.cacheRate != null ? ` · ${(usage.cacheRate * 100).toFixed(0)}% cache` : ""}
								</span>
							)}
						</header>
						{prompts[i] && (
							<p className="mt-1 line-clamp-2 text-[12px] leading-5 text-ink-2" title={prompts[i]}>
								{prompts[i]}
							</p>
						)}
						{run ? (
							<RunInspector
								run={run}
								timing={timing}
								usage={usage}
								defaultOpen={i === turnCount - 1}
								embedded
							/>
						) : (
							<p className="mt-1 text-[11px] text-ink-faint">{running ? t("panel.status.working") : "—"}</p>
						)}
					</section>
				);
			})}
		</div>
	);
}
