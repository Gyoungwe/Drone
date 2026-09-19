import type { WikiModelReviewResult, WikiReviewPreview } from "@drone/shared";
import { useEffect, useRef, useState } from "react";
import { getPi } from "../../api";
import { useSessionsStore } from "../../stores/sessions";
import { useSettingsStore } from "../../stores/settings";
import { Button } from "../ui/Button";
import { useKnowledgeText } from "./copy";

function compactTokens(value: number): string {
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
	if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
	return Math.round(value).toLocaleString();
}

export function WikiModelReview({
	cwd,
	preview,
	disabled,
	onBusy,
	onComplete,
	onFailure,
	adviceOnly = false,
	defaultExpanded = false,
}: {
	cwd: string;
	preview: WikiReviewPreview;
	disabled: boolean;
	onBusy: (v: boolean) => void;
	onComplete: (v: WikiModelReviewResult) => Promise<void>;
	onFailure: () => void;
	adviceOnly?: boolean;
	defaultExpanded?: boolean;
}) {
	const t = useKnowledgeText(),
		sessionId = useSessionsStore((s) => s.activeSessionId),
		sessions = useSessionsStore((s) => s.sessions);
	const chosen = sessions.find((s) => s.sessionId === sessionId && s.cwd === cwd);
	const pref = useSettingsStore((s) => s.modelPrefs?.subagentModels?.["knowledge-wiki-reviewer"]);
	const [expanded, setExpanded] = useState(defaultExpanded || adviceOnly),
		[ack, setAck] = useState(false),
		[auto, setAuto] = useState(false),
		[busy, setBusy] = useState(false),
		[error, setError] = useState<string | null>(null);
	const [report, setReport] = useState<WikiModelReviewResult | null>(preview.modelReview || null);
	const active = useRef<{ sessionId: string; requestId: string } | null>(null),
		generation = useRef(0);
	useEffect(() => {
		generation.current++;
		setAck(false);
		setAuto(false);
		setExpanded(defaultExpanded || adviceOnly);
		setReport(preview.modelReview || null);
		setError(null);
		return () => {
			generation.current++;
			if (active.current) {
				void getPi()
					.cancelKnowledgeModelReview(active.current)
					.catch(() => {});
				active.current = null;
			}
		};
	}, [preview.modelReview, adviceOnly, defaultExpanded]);
	async function review() {
		if (!ack || !chosen || !sessionId || busy || disabled) return;
		const epoch = generation.current;
		const request = { sessionId, requestId: crypto.randomUUID() };
		active.current = request;
		setBusy(true);
		onBusy(true);
		setError(null);
		try {
			const value = await getPi().reviewKnowledgeWithModel({
				cwd,
				...request,
				token: preview.reviewToken,
				acknowledged: true,
				autoApply: adviceOnly ? false : auto,
			});
			if (epoch !== generation.current) return;
			setReport(value);
			setExpanded(false);
			setAck(false);
			await onComplete(value);
		} catch (e) {
			if (epoch === generation.current) {
				setError(String((e as Error).message || e));
				onFailure();
			}
		} finally {
			if (active.current === request) active.current = null;
			setBusy(false);
			onBusy(false);
		}
	}
	return (
		<section className="space-y-2 rounded-xl border border-border p-3" data-testid="wiki-model-review">
			<div className="flex flex-wrap items-center justify-between gap-2">
				{adviceOnly ? (
					<p className="text-xs font-medium">{t("modelReviewPreflight")}</p>
				) : (
					<Button
						disabled={disabled || busy || preview.status !== "pending"}
						onClick={() => setExpanded(!expanded)}
					>
						{t("modelReviewButton")}
					</Button>
				)}
				<span className="break-all text-[11px] text-ink-dim">
					{t("modelReviewModel")}：{pref || t("modelReviewInherit")}
				</span>
			</div>
			{!chosen && <p className="text-[11px] text-warn">{t("modelReviewSession")}</p>}
			{(adviceOnly || expanded) && (
				<div className="space-y-2 text-xs">
					<p className="leading-relaxed text-ink-dim">
						{adviceOnly ? t("modelReviewAdviceHint") : t("modelReviewHint")}
					</p>
					<label className="flex items-start gap-2">
						<input type="checkbox" checked={ack} disabled={busy} onChange={(e) => setAck(e.target.checked)} />
						{t("modelReviewAck")}
					</label>
					{!adviceOnly && (
						<label className="flex items-start gap-2">
							<input
								type="checkbox"
								checked={auto}
								disabled={busy}
								onChange={(e) => setAuto(e.target.checked)}
							/>
							{t("modelReviewAutoApply")}
						</label>
					)}
					<p className="text-[11px] text-ink-dim">
						{adviceOnly ? t("modelReviewNotHuman") : t("modelReviewWriteHint")}
					</p>
					<div className="flex gap-2">
						<Button disabled={!ack || !chosen || busy || disabled} onClick={() => void review()}>
							{t("modelReviewStart")}
						</Button>
						<Button disabled={busy} onClick={() => setExpanded(false)}>
							{t("cancel")}
						</Button>
					</div>
				</div>
			)}
			{busy && (
				<div className="flex items-center gap-2">
					<span role="status" className="text-xs">
						{t("modelReviewRunning")}
					</span>
					<Button
						onClick={() => {
							if (active.current) void getPi().cancelKnowledgeModelReview(active.current);
						}}
					>
						{t("cancel")}
					</Button>
				</div>
			)}
			{error && (
				<p role="alert" className="break-words text-xs text-err">
					{error}
				</p>
			)}
			{report && (
				<div className="space-y-2 text-xs" data-testid="wiki-model-review-result">
					<strong>
						{report.applied
							? t("modelReviewApplied")
							: report.verdict === "approve"
								? t("modelReviewPass")
								: report.verdict === "reject"
									? t("modelReviewReject")
									: t("modelReviewHuman")}
					</strong>
					<p className="whitespace-pre-wrap break-words">{report.summary}</p>
					{[...new Set(report.cautions)].map((item) => (
						<p key={item} className="text-warn">
							{item}
						</p>
					))}
					{(report.applyError || report.auditSaveError) && (
						<p className="text-warn">{report.applyError || report.auditSaveError}</p>
					)}
					<p className="text-[11px] text-ink-dim">
						{t("modelReviewNotHuman")} · {report.model}
					</p>
					{report.usage && (
						<details
							className="rounded-lg border border-border px-2.5 py-1.5 text-[11px] text-ink-dim"
							data-testid="wiki-model-review-usage"
						>
							<summary className="cursor-pointer list-none tabular-nums">
								<span className="font-medium text-ink-2">{t("modelReviewUsage")}</span>
								{" · "}
								{compactTokens(report.usage.inputTokens + report.usage.outputTokens)} tokens{" · "}
								{report.usage.cost > 0 ? `$${report.usage.cost.toFixed(4)}` : t("modelReviewCostUnknown")}
							</summary>
							<div className="mt-2 grid grid-cols-2 gap-2 border-t border-border pt-2 tabular-nums">
								<span>
									{t("modelReviewInput")} {report.usage.inputTokens.toLocaleString()}
								</span>
								<span>
									{t("modelReviewOutput")} {report.usage.outputTokens.toLocaleString()}
								</span>
							</div>
							<p className="mt-1 leading-relaxed">{t("modelReviewUsageHint")}</p>
						</details>
					)}
					<details>
						<summary className="cursor-pointer text-[11px]">{t("modelReviewAudit")}</summary>
						<p className="break-all font-mono text-[11px]">{report.auditId}</p>
						<p>{new Date(report.completedAt).toLocaleString()}</p>
						{Object.entries(report.checks).map(([key, value]) => (
							<p key={key}>
								{value ? "✓" : "!"} {t(`reviewCheck_${key}` as Parameters<typeof t>[0])}
							</p>
						))}
					</details>
				</div>
			)}
		</section>
	);
}
