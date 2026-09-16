import type { WikiReviewPreview } from "@drone/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getPi } from "../../api";
import { useKnowledgeStore } from "../../stores/knowledge";
import { Button } from "../ui/Button";
import { useKnowledgeText } from "./copy";
import { knowledgeLineDiff } from "./line-diff";
import { WikiModelReview } from "./WikiModelReview";

const overlayClass = "fixed inset-0 z-[70] flex items-center justify-center bg-ink/25 p-6";
const sheetClass =
	"flex max-h-[82vh] w-[min(680px,92vw)] flex-col overflow-hidden rounded-2xl border border-border bg-surface text-ink shadow-dialog";

/** Focused Wiki apply/reject popup. Esc / 稍后 closes without rejecting. */
export function WikiReviewDialog({
	cwd,
	id,
	queued,
	onLater,
}: {
	cwd: string;
	id: string;
	queued: number;
	onLater: () => void;
}) {
	const t = useKnowledgeText();
	const box = useRef<HTMLDivElement>(null);
	const revision = useKnowledgeStore((s) => s.revision);
	const [preview, setPreview] = useState<WikiReviewPreview | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const [tick, setTick] = useState(0);
	const [view, setView] = useState<"diff" | "both" | "protected">("diff");
	const [reviewing, setReviewing] = useState(false);
	const [verdict, setVerdict] = useState<string | null>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: reload when the binding invalidates or the user retries
	useEffect(() => {
		let live = true;
		setPreview(null);
		setError(null);
		setView("diff");
		setReviewing(false);
		setVerdict(null);
		setPending(true);
		void getPi()
			.getKnowledgeOverview({ cwd })
			.then((overview) => {
				const binding = overview.binding?.revision;
				if (binding == null) throw new Error("not-bound");
				if (id) return getPi().previewKnowledgeReview({ cwd, id, revision: binding });
				return getPi()
					.getKnowledgeReviews({ cwd, revision: binding, offset: 0, limit: 1 })
					.then((page) => {
						const first = page.items[0];
						if (!first) throw new Error("empty");
						return getPi().previewKnowledgeReview({ cwd, id: first.id, revision: binding });
					});
			})
			.then(
				(value) => {
					if (live) setPreview(value);
				},
				(cause) => {
					if (!live) return;
					setError(cause instanceof Error ? cause.message : String(cause));
				},
			)
			.finally(() => {
				if (live) setPending(false);
			});
		return () => {
			live = false;
		};
	}, [cwd, id, revision, tick]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: refocus when preview or error content arrives
	useEffect(() => {
		const node = box.current?.querySelector<HTMLElement>("button:not([disabled])");
		node?.focus();
	}, [preview, error]);
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			if (pending && preview) return;
			event.preventDefault();
			onLater();
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [onLater, pending, preview]);
	const lines = useMemo(() => knowledgeLineDiff(preview?.before || "", preview?.after || ""), [preview]);
	const visible = lines.slice(0, 200);
	async function decide(decision: "apply" | "reject") {
		if (!preview || pending) return;
		setPending(true);
		setError(null);
		try {
			const value = await getPi().decideKnowledgeReview({ cwd, token: preview.reviewToken, decision });
			const text =
				value.status === "rejected"
					? t("rejected")
					: value.indexed === false || value.reviewRecorded === false
						? `${t("savedPartial")} ${value.indexError || value.recordError || ""}`
						: t("applied");
			useKnowledgeStore.getState().invalidate();
			useKnowledgeStore.getState().apply({
				kind: "notice",
				id: String(Date.now()),
				sessionId: null,
				severity: value.indexed === false ? "warning" : "info",
				text,
			});
			onLater();
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
			setPending(false);
		}
	}
	const blocked = !preview?.canApply || preview.expired || preview.targetChanged;
	const errorText = error === "not-bound" ? t("notBound") : error === "empty" ? t("empty") : error;
	return createPortal(
		<div
			className={overlayClass}
			role="dialog"
			aria-modal
			aria-label={t("reviewTitle")}
			data-testid="wiki-review-dialog"
		>
			<div ref={box} className={sheetClass}>
				<div className="shrink-0 border-b border-border px-5 py-4">
					<p className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-faint">
						Obsidian · {t("reviews")}
					</p>
					<h3 className="mt-1 text-base font-semibold text-ink">{preview?.title || t("reviewTitle")}</h3>
					{preview && (
						<p className="mt-1 break-all font-mono text-[11px] text-ink-dim select-text">{preview.path}</p>
					)}
				</div>
				<div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
					{pending && !preview && <p className="text-xs text-ink-dim">{t("loading")}</p>}
					{errorText && (
						<div role="alert" className="rounded-lg border border-border p-3 text-xs text-err">
							<p>{errorText}</p>
							<Button size="sm" className="mt-2" disabled={pending} onClick={() => setTick((n) => n + 1)}>
								{t("retry")}
							</Button>
						</div>
					)}
					{preview && (
						<>
							<p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-ink">
								{t("reason")}：{preview.rationale}
							</p>
							<p className="rounded-lg bg-hover px-3 py-2 text-[11px] leading-relaxed text-ink-dim">
								{t("preserve")}
							</p>
							<div className="flex flex-wrap gap-1" role="tablist" aria-label={t("reviewTitle")}>
								{(["diff", "both", "protected"] as const).map((tab) => (
									<button
										key={tab}
										type="button"
										role="tab"
										aria-selected={view === tab}
										onClick={() => setView(tab)}
										className={`rounded-lg px-2.5 py-1.5 text-xs ${view === tab ? "bg-ink text-on-ink" : "text-ink-dim hover:bg-hover"}`}
									>
										{t(tab)}
									</button>
								))}
							</div>
							{view === "diff" && (
								<section
									className="max-h-[32vh] overflow-auto rounded-lg border border-border font-mono text-[11px]"
									aria-label={t("diff")}
								>
									{visible.map((row) => (
										<div
											key={`${row.kind}:${row.oldLine}:${row.newLine}:${row.text}`}
											className={`flex gap-2 px-2 leading-6 ${row.kind === "add" ? "bg-ok/10" : row.kind === "remove" ? "bg-err/8" : "text-ink-dim"}`}
										>
											<span className="w-12 shrink-0 select-none text-right text-ink-faint">
												{row.oldLine || ""} {row.newLine || ""}
											</span>
											<span title={row.kind} className="w-3 shrink-0">
												{row.kind === "add" ? "+" : row.kind === "remove" ? "−" : " "}
											</span>
											<span className="min-w-0 whitespace-pre-wrap break-words">{row.text || " "}</span>
										</div>
									))}
									{lines.length > 200 && (
										<p className="px-2 py-2 text-[10px] text-ink-faint">{t("truncated")}</p>
									)}
								</section>
							)}
							{view === "both" && (
								<div className="grid gap-2">
									{(["before", "after"] as const).map((side) => (
										<div key={side} className="min-w-0">
											<p className="mb-1 text-xs font-medium">{t(side)}</p>
											<pre className="max-h-[22vh] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-hover p-3 text-[11px] leading-relaxed">
												{preview[side] || "—"}
											</pre>
										</div>
									))}
								</div>
							)}
							{view === "protected" && (
								<pre className="max-h-[32vh] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-hover p-3 text-[11px] leading-relaxed">
									{preview.protectedText || "—"}
								</pre>
							)}
							<div>
								<h4 className="mb-2 text-xs font-semibold">
									{t("sources")} · {preview.sources.length}
								</h4>
								<div className="max-h-28 space-y-1 overflow-auto">
									{preview.sources.map((source) => (
										<div key={source.path} className="rounded-lg border border-border px-2 py-1.5">
											<p className="break-all text-[11px]">{source.path}</p>
											<p className="font-mono text-[10px] text-ink-faint">
												L{source.startLine}–{source.endLine}
												{source.hash ? ` · ${source.hash.slice(0, 12)}` : ""}
											</p>
											{source.changed && <p className="text-[11px] text-warn">{t("sourceChanged")}</p>}
										</div>
									))}
								</div>
							</div>
							{(preview.expired || preview.targetChanged) && (
								<p role="alert" className="text-xs text-warn">
									{preview.targetChanged ? t("targetChanged") : t("expired")}{" "}
									<Button size="sm" disabled={pending} onClick={() => setTick((n) => n + 1)}>
										{t("refreshPreview")}
									</Button>
								</p>
							)}
							<WikiModelReview
								cwd={cwd}
								preview={preview}
								adviceOnly
								defaultExpanded
								disabled={pending || blocked || reviewing}
								onBusy={setReviewing}
								onFailure={() => {}}
								onComplete={async (value) => {
									setVerdict(
										value.applied
											? t("modelReviewApplied")
											: value.verdict === "approve"
												? t("modelReviewPass")
												: value.verdict === "reject"
													? t("modelReviewReject")
													: t("modelReviewHuman"),
									);
									if (value.applied) {
										useKnowledgeStore.getState().invalidate();
										useKnowledgeStore.getState().apply({
											kind: "notice",
											id: String(Date.now()),
											sessionId: null,
											severity: "info",
											text: t("modelReviewApplied"),
										});
										onLater();
									}
								}}
							/>
							<p className="text-[11px] text-ink-dim">{t("notScience")}</p>
						</>
					)}
				</div>
				<div className="shrink-0 border-t border-border px-5 py-3">
					<div className="flex items-center justify-between gap-3">
						<p className="min-w-0 truncate text-[10px] text-ink-faint">
							{verdict ||
								(queued > 0 ? t("reviewQueued").replace("{count}", String(queued)) : t("reviewLaterHint"))}
						</p>
						<div className="flex shrink-0 gap-2">
							<Button disabled={pending && !!preview} onClick={onLater}>
								{t("later")}
							</Button>
							<Button
								tone="danger"
								disabled={pending || reviewing || !preview}
								onClick={() => void decide("reject")}
							>
								{t("reject")}
							</Button>
							<Button
								variant="primary"
								disabled={pending || reviewing || !preview || blocked}
								onClick={() => void decide("apply")}
							>
								{pending && preview ? t("applying") : t("apply")}
							</Button>
						</div>
					</div>
				</div>
			</div>
		</div>,
		document.body,
	);
}
