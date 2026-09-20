import type { SubagentPanelRun } from "@drone/shared";
import { useState } from "react";
import { useT } from "../../i18n";
import { COMPOSER_FOCUS_EVENT, useDraftStore } from "../../stores/drafts";
import type { SubagentRunUi } from "../../stores/transcript";
import { ChevronDownIcon } from "../icons";
import { citeRunText } from "../panel/subagents-form";
import { Button } from "../ui/Button";
import { InlineSubagentTranscript } from "./InlineSubagentTranscript";
import { SubagentAvatar } from "./SubagentAvatar";

function formatTokens(value: number): string {
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
	if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
	return String(value);
}

function formatDuration(ms: number): string {
	const seconds = Math.max(0, Math.floor(ms / 1000));
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	const rest = seconds % 60;
	if (minutes < 60) return `${minutes}m ${rest}s`;
	return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function formatClock(ts: number): string {
	const d = new Date(ts);
	return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * 面板派发运行的结果卡（聊天里同一张卡在完成时换成这张）：头像眯眼笑 + 摘要 + 引用到输入框 +
 * 展开记录 + followUp 状态（已交给主模型 / 等待进入上下文 / 未交给主模型）。主模型可见的只是
 * followUp 文本，不是整份子会话记录。
 */
export function SubagentResultCard({ run, panel }: { run: SubagentRunUi; panel: SubagentPanelRun }) {
	const t = useT();
	const [expanded, setExpanded] = useState(false);
	const duration = panel.startedAt && panel.endedAt ? formatDuration(panel.endedAt - panel.startedAt) : null;
	const summary = (panel.content ?? "").trim();
	const cite = () => {
		const text = citeRunText(
			panel,
			t("panel.subagents.citeHeader", {
				agent: panel.agent,
				time: formatClock(panel.endedAt ?? panel.createdAt),
			}),
		);
		useDraftStore.getState().updateDraft(panel.parentSessionId, (entry) => ({
			...entry,
			text: entry.text ? `${entry.text.replace(/\s+$/, "")}\n\n${text}\n` : `${text}\n`,
		}));
		window.dispatchEvent(new Event(COMPOSER_FOCUS_EVENT));
	};
	const contextLabel = !panel.followUp
		? t("message.subagent.noFollowUp")
		: panel.contextState === "delivered"
			? t("message.subagent.followUpDelivered")
			: t("message.subagent.followUpPending");
	return (
		<div
			className="overflow-hidden rounded-xl border border-border/70 bg-surface/40"
			data-testid="subagent-result-card"
			data-context-state={panel.contextState}
		>
			<div className="px-3 py-2.5">
				<div className="flex min-w-0 items-center gap-2">
					<SubagentAvatar name={panel.agent} source={panel.source} size="lg" state="done" />
					<span className="truncate text-[13px] font-semibold text-ink">
						{t("message.subagent.result", { agent: panel.agent })}
					</span>
					<span className="ml-auto flex shrink-0 items-center gap-2 text-[11px] text-ink-faint">
						{duration && <span>{duration}</span>}
						{panel.tokens != null && panel.tokens > 0 && (
							<span>{t("message.subagent.tokens", { n: formatTokens(panel.tokens) })}</span>
						)}
					</span>
				</div>
				{summary ? (
					<div
						className={`mt-2 whitespace-pre-wrap text-[12px] leading-relaxed text-ink-2 ${expanded ? "" : "line-clamp-6"}`}
					>
						{summary}
					</div>
				) : (
					<div className="mt-2 text-[11px] text-ink-faint">{t("message.subagent.noTranscript")}</div>
				)}
				{panel.sessionFile && (
					<div className="mt-1.5 truncate font-mono text-[10.5px] text-ink-faint" title={panel.sessionFile}>
						{panel.sessionFile}
					</div>
				)}
				<div className="mt-2 flex flex-wrap items-center gap-1.5">
					<Button size="sm" onClick={cite} data-testid="subagent-result-cite">
						{t("message.subagent.cite")}
					</Button>
					{(run.sessionFile || summary.length > 0) && (
						<Button size="sm" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
							{expanded ? t("message.subagent.collapseRecord") : t("message.subagent.expandRecord")}
							<ChevronDownIcon
								className={`ml-1 inline transition-transform ${expanded ? "rotate-180" : ""}`}
							/>
						</Button>
					)}
					<span
						className={`ml-auto flex items-center gap-1 text-[11px] ${
							panel.followUp && panel.contextState === "delivered" ? "text-ok" : "text-ink-faint"
						}`}
						data-testid="subagent-result-context"
					>
						{panel.followUp && panel.contextState === "delivered" ? "✓ " : ""}
						{contextLabel}
					</span>
				</div>
			</div>
			{expanded && run.sessionFile && <InlineSubagentTranscript run={run} />}
		</div>
	);
}
