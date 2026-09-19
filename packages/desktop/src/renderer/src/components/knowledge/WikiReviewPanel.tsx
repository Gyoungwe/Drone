import type { KnowledgePage, WikiReviewItem, WikiReviewPreview } from "@drone/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getPi } from "../../api";
import { useKnowledgeStore } from "../../stores/knowledge";
import { Button } from "../ui/Button";
import { useKnowledgeText } from "./copy";
import { KnowledgeNoteViewer } from "./KnowledgeNoteViewer";
import { knowledgeLineDiff } from "./line-diff";
import { WikiModelReview } from "./WikiModelReview";
export function WikiReviewPanel({
	cwd,
	revision,
	initialId,
}: {
	cwd: string | null;
	revision: number;
	initialId?: string;
}) {
	const t = useKnowledgeText(),
		nonce = useKnowledgeStore((s) => s.revision);
	const [page, setPage] = useState<KnowledgePage<WikiReviewItem> | null>(null),
		[offset, setOffset] = useState(0),
		[loading, setLoading] = useState(false);
	const [selected, setSelected] = useState(initialId || ""),
		[preview, setPreview] = useState<WikiReviewPreview | null>(null),
		[previewNonce, setPreviewNonce] = useState(-1),
		[pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null),
		[result, setResult] = useState<string | null>(null),
		[checked, setChecked] = useState(false),
		[expired, setExpired] = useState(false),
		[view, setView] = useState<"diff" | "both" | "protected">("diff"),
		[readPath, setReadPath] = useState<string | null>(null);
	const request = useRef(0);
	useEffect(() => {
		setSelected(initialId || "");
		setPreview(null);
		setOffset(0);
		setError(null);
		setResult(null);
		setReadPath(null);
		request.current++;
	}, [initialId]);
	useEffect(() => {
		let live = true;
		setLoading(true);
		void getPi()
			.getKnowledgeReviews({ cwd, revision, offset, limit: 12 })
			.then(
				(value) => {
					if (live) setPage(value);
				},
				(e) => {
					if (live) setError(String(e.message || e));
				},
			)
			.finally(() => {
				if (live) setLoading(false);
			});
		return () => {
			live = false;
		};
	}, [cwd, revision, offset]);
	const load = useCallback(
		async (id: string) => {
			if (!cwd) return;
			const seq = ++request.current;
			setSelected(id);
			setPreview(null);
			setChecked(false);
			setError(null);
			setExpired(false);
			setReadPath(null);
			setPending(true);
			try {
				const value = await getPi().previewKnowledgeReview({ cwd, id, revision });
				if (seq === request.current) {
					setPreview(value);
					setPreviewNonce(useKnowledgeStore.getState().revision);
				}
			} catch (e) {
				if (seq === request.current) setError(e instanceof Error ? e.message : String(e));
			} finally {
				if (seq === request.current) setPending(false);
			}
		},
		[cwd, revision],
	);
	useEffect(() => {
		if (initialId && cwd) void load(initialId);
		return () => {
			request.current++;
		};
	}, [cwd, initialId, load]);
	useEffect(() => {
		if (!preview) return;
		const delay = Math.min(preview.expiresAt, preview.tokenExpiresAt) - Date.now();
		if (delay <= 0) {
			setExpired(true);
			return;
		}
		const timer = window.setTimeout(() => setExpired(true), delay);
		return () => window.clearTimeout(timer);
	}, [preview]);
	const lines = useMemo(() => knowledgeLineDiff(preview?.before || "", preview?.after || ""), [preview]);
	const stale = !!preview && previewNonce !== nonce;
	async function decide(decision: "apply" | "reject") {
		if (!cwd || !preview || pending) return;
		setPending(true);
		setError(null);
		setResult(null);
		try {
			const value = await getPi().decideKnowledgeReview({ cwd, token: preview.reviewToken, decision });
			const text =
				value.status === "rejected"
					? t("rejected")
					: value.indexed === false || value.reviewRecorded === false
						? `${t("savedPartial")} ${value.indexError || value.recordError || ""}`
						: t("applied");
			setResult(text);
			setPreview(null);
			setSelected("");
			setChecked(false);
			useKnowledgeStore.getState().invalidate();
			useKnowledgeStore.getState().apply({
				kind: "notice",
				id: String(Date.now()),
				sessionId: null,
				severity: value.indexed === false ? "warning" : "info",
				text,
			});
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
			setChecked(false);
			setExpired(true);
		} finally {
			setPending(false);
		}
	}
	return (
		<div className="space-y-3" data-testid="wiki-review-panel">
			<p className="text-[11px] leading-relaxed text-ink-dim">{t("originProject")}</p>
			{!cwd && <p className="text-xs text-warn">{t("selectProject")}</p>}
			{result && (
				<p role="status" className="rounded-lg bg-hover p-3 text-xs">
					{result}
				</p>
			)}
			{error && (
				<div role="alert" className="rounded-lg border border-border p-3 text-xs text-err">
					{error}
					{selected && (
						<Button size="sm" disabled={pending} onClick={() => void load(selected)}>
							{t("refreshPreview")}
						</Button>
					)}
				</div>
			)}
			<div className="grid gap-4 min-[950px]:grid-cols-[240px_minmax(0,1fr)]">
				<aside>
					<div className="flex items-center justify-between text-xs">
						<span>
							{t("reviews")} · {page?.total ?? "—"}
						</span>
						{loading && <span role="status">{t("loading")}</span>}
					</div>
					<div className="mt-2 max-h-60 space-y-1 overflow-auto min-[950px]:max-h-[52vh]">
						{page?.items.map((item) => (
							<button
								key={item.id}
								type="button"
								disabled={pending}
								onClick={() => void load(item.id)}
								className={`w-full rounded-lg border p-2.5 text-left transition-colors ${selected === item.id ? "border-accent bg-accent/5" : "border-border hover:bg-hover"}`}
							>
								<span className="block break-words text-xs font-medium">{item.title}</span>
								<span className="mt-1 block break-all font-mono text-[11px] text-ink-dim">{item.path}</span>
								{(item.expired || item.bindingChanged) && (
									<span className="mt-1 block text-[11px] text-warn">
										{item.expired ? t("expired") : t("stalePreview")}
									</span>
								)}
							</button>
						))}
						{page && !page.items.length && !loading && (
							<p className="py-5 text-center text-xs text-ink-faint">{t("empty")}</p>
						)}
					</div>
					<div className="mt-2 flex justify-between">
						<Button
							size="sm"
							disabled={!offset || loading}
							onClick={() => setOffset(Math.max(0, offset - 12))}
						>
							{t("previous")}
						</Button>
						<Button
							size="sm"
							disabled={page?.nextOffset == null || loading}
							onClick={() => setOffset(page?.nextOffset ?? 0)}
						>
							{t("next")}
						</Button>
					</div>
					{page?.problems?.length ? (
						<details className="mt-2 text-xs text-warn">
							<summary>{t("problems")}</summary>
							{page.problems.map((p) => (
								<p key={p.id} className="break-words">
									{p.error}
								</p>
							))}
						</details>
					) : null}
				</aside>
				<div className="min-w-0">
					{!preview && (
						<p className="rounded-xl bg-hover p-6 text-center text-xs text-ink-dim" role="status">
							{pending ? t("loading") : t("selectReview")}
						</p>
					)}
					{preview && (
						<div className="space-y-3">
							<div>
								<h3 className="break-words text-sm font-semibold">{preview.title}</h3>
								<p className="mt-1 break-all font-mono text-[11px] text-ink-dim">{preview.path}</p>
								<p className="mt-2 whitespace-pre-wrap break-words text-xs">
									{t("reason")}：{preview.rationale}
								</p>
							</div>
							<p className="rounded-lg bg-hover p-2 text-[11px] text-ink-dim">{t("preserve")}</p>
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
									className="max-h-[38vh] overflow-auto rounded-lg border border-border font-mono text-[11px]"
									aria-label={t("diff")}
								>
									{lines.map((row) => (
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
								</section>
							)}
							{view === "both" && (
								<div className="grid gap-2 min-[1100px]:grid-cols-2">
									{(["before", "after"] as const).map((side) => (
										<div key={side} className="min-w-0">
											<p className="mb-1 text-xs font-medium">{t(side)}</p>
											<pre className="max-h-[38vh] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-hover p-3 text-[11px] leading-relaxed">
												{preview[side] || "—"}
											</pre>
										</div>
									))}
								</div>
							)}
							{view === "protected" && (
								<pre className="max-h-[38vh] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-hover p-3 text-[11px] leading-relaxed">
									{preview.protectedText || "—"}
								</pre>
							)}
							<div>
								<h4 className="mb-2 text-xs font-semibold">{t("sources")}</h4>
								<div className="space-y-1">
									{preview.sources.map((source) => (
										<div
											key={source.path}
											className="flex flex-wrap items-start justify-between gap-1 rounded-lg border border-border px-2 py-1.5"
										>
											<div className="min-w-0">
												<p className="break-all text-[11px]">{source.path}</p>
												<p className="font-mono text-[11px] text-ink-faint">
													L{source.startLine}–{source.endLine} · {source.hash?.slice(0, 12)}
												</p>
												{source.changed && <p className="text-[11px] text-warn">{t("sourceChanged")}</p>}
											</div>
											<Button size="sm" onClick={() => setReadPath(source.path)}>
												{t("openSource")}
											</Button>
										</div>
									))}
								</div>
							</div>
							{readPath && (
								<KnowledgeNoteViewer
									cwd={cwd}
									revision={revision}
									path={readPath}
									onClose={() => setReadPath(null)}
								/>
							)}
							{preview.status === "pending" &&
								(preview.expired || expired || preview.targetChanged || stale) && (
									<p role="alert" className="text-xs text-warn">
										{preview.targetChanged ? t("targetChanged") : stale ? t("stalePreview") : t("expired")}{" "}
										<Button size="sm" disabled={pending} onClick={() => void load(preview.id)}>
											{t("refreshPreview")}
										</Button>
									</p>
								)}
							{cwd && (
								<WikiModelReview
									cwd={cwd}
									preview={preview}
									disabled={pending || !preview.canApply || expired || stale}
									onBusy={setPending}
									onFailure={() => setExpired(true)}
									onComplete={async (value) => {
										setResult(
											value.applied
												? t("modelReviewApplied")
												: value.verdict === "approve"
													? t("modelReviewPass")
													: value.verdict === "reject"
														? t("modelReviewReject")
														: t("modelReviewHuman"),
										);
										await load(preview.id);
									}}
								/>
							)}
							<p className="text-[11px] text-ink-dim">{t("notScience")}</p>
							<label className="flex items-start gap-2 text-xs">
								<input
									type="checkbox"
									checked={checked}
									onChange={(e) => setChecked(e.target.checked)}
									disabled={pending || !preview.canApply || expired || stale}
									className="mt-0.5"
								/>
								{t("confirmReview")}
							</label>
							<div className="flex flex-wrap justify-end gap-2">
								<Button disabled={pending} onClick={() => void decide("reject")}>
									{t("reject")}
								</Button>
								<Button
									variant="primary"
									disabled={pending || !preview.canApply || !checked || expired || stale}
									onClick={() => void decide("apply")}
								>
									{pending ? t("applying") : t("approve")}
								</Button>
							</div>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
