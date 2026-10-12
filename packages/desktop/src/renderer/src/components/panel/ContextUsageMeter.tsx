import { type ContextUsageInfo, contextLevel } from "@drone/shared";
import { getPi } from "../../api";
import { useContextUsage } from "../../hooks/use-context-usage";
import { useT } from "../../i18n";
import { selectTranscript, useTranscriptStore } from "../../stores/transcript";

function fmt(n: number): string {
	return n >= 1000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : String(n);
}

/** 右栏常驻上下文用量计 + 压缩按钮（P16）。 */
export function ContextUsageView({
	usage,
	compacting,
	disabled,
	onCompact,
}: {
	usage: ContextUsageInfo | null;
	compacting: boolean;
	disabled: boolean;
	onCompact: () => void;
}) {
	const t = useT();
	const percent = usage?.percent ?? null;
	const level = contextLevel(percent);
	const pct = Math.max(0, Math.min(100, percent ?? 0));
	return (
		<div className={`context-usage context-usage--${level}`} data-testid="context-usage">
			<div className="context-usage-head">
				<span>{t("panel.contextUsage.title")}</span>
				<span className="font-mono">
					{usage?.tokens != null
						? `${fmt(usage.tokens)} / ${fmt(usage.contextWindow)}`
						: t("panel.contextUsage.unknown")}
				</span>
			</div>
			<div className="context-usage-bar" aria-hidden="true">
				<span style={{ width: `${pct}%` }} />
			</div>
			<div className="context-usage-foot">
				<span>
					{level === "high" ? t("panel.contextUsage.high") : percent != null ? `${pct.toFixed(0)}%` : ""}
				</span>
				<button type="button" className="panel-action" disabled={disabled || compacting} onClick={onCompact}>
					{compacting ? t("panel.contextUsage.compacting") : t("panel.contextUsage.compact")}
				</button>
			</div>
		</div>
	);
}

export function ContextUsageMeter({ sessionId }: { sessionId: string | null }) {
	const usage = useContextUsage(sessionId);
	const entry = useTranscriptStore((s) => selectTranscript(s, sessionId));
	if (!sessionId) return null;
	return (
		<ContextUsageView
			usage={usage}
			compacting={entry.compacting}
			disabled={entry.agentActive || entry.messages.length === 0}
			onCompact={() => void getPi().compact(sessionId)}
		/>
	);
}
