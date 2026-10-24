import type { KnowledgeGraph as GraphData, KnowledgePage, WikiReviewItem } from "@drone/shared";
import { useEffect, useMemo, useState } from "react";
import { getPi } from "../../api";
import { useI18nStore } from "../../i18n";
import { useKnowledgeStore } from "../../stores/knowledge";
import { useSettingsStore } from "../../stores/settings";
import { Button } from "../ui/Button";
import { useKnowledgeText } from "./copy";
import { DailyIdeas } from "./DailyIdeas";
import { useKnowledgeOverview } from "./hooks";
import { type KnowledgeCategory, KnowledgeSearch } from "./KnowledgeSearch";
import {
	classifyRecentKnowledgeNote,
	deriveKnowledgeCategoryCounts,
	type KnowledgeLeafCategory,
} from "./knowledge-home-model";

const RECENT_LIMIT = 8;
const REVIEW_LIMIT = 4;

/** Same palette as the knowledge network legend, so a type reads the same everywhere. */
const CATEGORY_DOT: Record<KnowledgeLeafCategory, string> = {
	paper: "#3b6fd8",
	method: "#1f8a7a",
	software: "#c9822b",
	idea: "#8a63d2",
	other: "#a3a3a3",
};

function recentTitle(item: { path: string; title?: string }): string {
	const file = item.path.split(/[\\/]/u).pop() || item.path;
	const title = item.title?.trim();
	return title && title !== file && title !== file.replace(/\.md$/u, "") ? title : file.replace(/\.md$/u, "");
}

function recentFolder(path: string): string {
	const parts = path.split(/[\\/]/u);
	return parts.length > 1 ? parts.slice(0, -1).join(" / ") : "";
}

function categoryLabel(t: (key: any) => string, category: KnowledgeLeafCategory): string {
	return t(
		{
			paper: "homeCategoryPaper",
			software: "homeCategorySoftware",
			method: "homeCategoryMethod",
			idea: "homeCategoryIdea",
			other: "homeRecentTypeUnknown",
		}[category],
	);
}

function relativeTime(value: number, language: string): string {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return "—";
	return new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en", {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(date);
}

/** Knowledge-base home: only renders observations returned by the host contracts. */
export function KnowledgeHome({
	cwd,
	sessionId,
	reviewId,
}: {
	cwd: string | null;
	sessionId: string | null;
	reviewId?: string;
}) {
	const t = useKnowledgeText();
	const { data, error, loading } = useKnowledgeOverview(cwd, sessionId);
	const knowledgeRevision = useKnowledgeStore((state) => state.revision);
	const binding = data?.binding;
	const [category, setCategory] = useState<KnowledgeCategory>("all");
	const [graph, setGraph] = useState<GraphData | null>(null);
	const [reviews, setReviews] = useState<KnowledgePage<WikiReviewItem> | null>(null);
	const [reviewError, setReviewError] = useState<string | null>(null);
	const revision = binding?.revision ?? 0;

	// biome-ignore lint/correctness/useExhaustiveDependencies: knowledgeRevision is a store-driven refresh signal.
	useEffect(() => {
		let live = true;
		if (!binding) {
			setGraph(null);
			setReviews(null);
			setReviewError(null);
			return () => {
				live = false;
			};
		}
		setReviewError(null);
		void Promise.allSettled([
			getPi().getKnowledgeReviews({ cwd, revision, offset: 0, limit: REVIEW_LIMIT }),
			getPi().getKnowledgeGraph({ revision, limit: 400, view: "all", mergeMirrors: true }),
		]).then((results) => {
			if (!live) return;
			const [reviewResult, graphResult] = results;
			if (reviewResult.status === "fulfilled") setReviews(reviewResult.value);
			else
				setReviewError(
					String(reviewResult.reason instanceof Error ? reviewResult.reason.message : reviewResult.reason),
				);
			if (graphResult.status === "fulfilled") setGraph(graphResult.value);
		});
		return () => {
			live = false;
		};
	}, [binding, cwd, revision, knowledgeRevision]);

	useEffect(() => {
		if (reviewId && cwd) useKnowledgeStore.getState().openReview({ cwd, sessionId, id: reviewId });
	}, [cwd, reviewId, sessionId]);

	const allRecent = (data?.recentNotes ?? []).slice(0, RECENT_LIMIT);
	// The category tabs filter the deposit list too, not only search hits.
	const recent =
		category === "all" ? allRecent : (data?.recentByCategory?.[category] ?? []).slice(0, RECENT_LIMIT);
	const counts = useMemo(
		() =>
			data?.index?.categoryCounts
				? {
						all: data.index.noteCount,
						paper: data.index.categoryCounts.paper,
						software: data.index.categoryCounts.software,
						method: data.index.categoryCounts.method,
						idea: data.index.categoryCounts.idea,
					}
				: deriveKnowledgeCategoryCounts(graph, data?.index?.noteCount),
		[graph, data?.index?.noteCount, data?.index?.categoryCounts],
	);
	const manage = () => useSettingsStore.getState().openWith("knowledge");
	const openReview = (id: string) => {
		if (cwd) useKnowledgeStore.getState().openReview({ cwd, sessionId, id });
	};
	const language = useI18nStore((state) => state.language);

	return (
		<div className="knowledge-home mx-auto w-full max-w-[1440px] text-ink" data-testid="knowledge-home">
			<section className="border-0 bg-transparent shadow-none" aria-label={t("homeSearch")}>
				<KnowledgeSearch
					cwd={cwd}
					sessionId={sessionId}
					bindingRevision={revision}
					activeCategory={category}
					onCategoryChange={setCategory}
					categoryCounts={counts}
				/>
			</section>

			{error && (
				<p role="alert" className="mt-3 rounded-lg border border-border p-3 text-xs text-err">
					{error}
				</p>
			)}
			{!binding && data?.enabled && (
				<section className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-border bg-surface p-5">
					<div>
						<h2 className="text-sm font-medium">{t("notBound")}</h2>
						<p className="mt-1 text-xs text-ink-dim">{t("homeBindingHint")}</p>
					</div>
					<Button size="sm" variant="primary" onClick={manage}>
						{t("homeUnboundAction")}
					</Button>
				</section>
			)}

			{binding && (
				<div className="mt-5 grid min-h-0 gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
					<section aria-label={t("homeRecentDeposits")} className="min-w-0">
						<h2 className="mb-2 text-xs font-medium text-ink-dim">
							{t("homeRecentDeposits")}
							{category === "all" ? "" : ` · ${categoryLabel(t, category)}`}
						</h2>
						{loading && !data ? (
							<p role="status" className="py-4 text-xs text-ink-dim">
								{t("loading")}
							</p>
						) : null}
						{recent.length === 0 ? (
							<p className="rounded-xl border border-border p-5 text-xs text-ink-faint">
								{t("homeRecentEmpty")}
							</p>
						) : (
							<ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
								{recent.map((item) => {
									const kind = classifyRecentKnowledgeNote(item.path, data?.recentByCategory);
									return (
										<li key={item.path}>
											<button
												type="button"
												className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-left hover:bg-hover"
												onClick={() =>
													useKnowledgeStore
														.getState()
														.open({ cwd, sessionId, tab: "reviews", note: item.path, noteRevision: revision })
												}
											>
												<span className="min-w-0">
													<span className="block truncate text-[13px] font-medium" title={item.path}>
														{recentTitle(item)}
													</span>
													<span className="mt-1 flex min-w-0 items-center gap-2 text-xs text-ink-dim">
														<span
															aria-hidden="true"
															className="h-2 w-2 shrink-0 rounded-full"
															style={{ backgroundColor: CATEGORY_DOT[kind] }}
														/>
														<span className="shrink-0">
															{item.kind === "wiki" ? "Wiki" : categoryLabel(t, kind)}
														</span>
														{recentFolder(item.path) ? (
															<span className="truncate text-ink-faint">· {recentFolder(item.path)}</span>
														) : null}
													</span>
												</span>
												<span
													className="whitespace-nowrap text-xs text-ink-faint"
													title={new Date(item.updatedAt).toLocaleString()}
												>
													{relativeTime(item.updatedAt, language)}
												</span>
											</button>
										</li>
									);
								})}
							</ul>
						)}
					</section>

					<aside className="space-y-6">
						<DailyIdeas cwd={cwd} sessionId={sessionId} bindingRevision={revision} />
						<section aria-label={t("homePendingTitle")}>
							<h2 className="mb-2 text-xs font-medium text-ink-dim">
								{t("homePendingTitle")} {reviews ? `· ${reviews.total}` : ""}
							</h2>
							{reviewError && (
								<p role="alert" className="rounded-lg border border-border p-3 text-xs text-err">
									{t("homeReviewsError")}
								</p>
							)}
							{!reviewError && !reviews && (
								<p role="status" className="text-xs text-ink-faint">
									{t("homeLoadingReviews")}
								</p>
							)}
							{reviews?.items.length === 0 && (
								<p className="rounded-xl border border-border p-4 text-xs text-ink-faint">
									{t("homePendingEmpty")}
								</p>
							)}
							<div className="space-y-2">
								{reviews?.items.map((item) => (
									<article key={item.id} className="rounded-xl border border-border bg-surface p-3">
										<h3 className="truncate text-xs font-medium" title={item.title}>
											{item.title}
										</h3>
										<p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-ink-dim">{item.path}</p>
										<div className="mt-2 flex gap-2">
											<Button size="sm" variant="primary" onClick={() => openReview(item.id)}>
												{t("homePendingReview")}
											</Button>
										</div>
									</article>
								))}
							</div>
						</section>

						<section aria-label={t("homeHealthTitle")}>
							<h2 className="mb-2 text-xs font-medium text-ink-dim">{t("homeHealthTitle")}</h2>
							<dl className="space-y-2 text-xs text-ink-2">
								<div className="flex items-center justify-between gap-3">
									<dt>{t("homeHealthLocalAnswers")}</dt>
									<dd className="font-mono text-ink-faint">
										{data?.localAnswerRate?.rate == null
											? t("homeHealthUnavailable")
											: `${Math.round(data.localAnswerRate.rate * 100)}% (${data.localAnswerRate.answered}/${data.localAnswerRate.total})`}
									</dd>
								</div>
								<div className="flex items-center justify-between gap-3">
									<dt>{t("homeHealthIndexed")}</dt>
									<dd className="font-mono">{data?.index?.noteCount ?? t("homeHealthUnavailable")}</dd>
								</div>
								<div className="flex items-center justify-between gap-3">
									<dt>{t("homeHealthPending")}</dt>
									<dd className="font-mono">{data?.index?.pendingChanges ?? t("homeHealthUnavailable")}</dd>
								</div>
								<div className="flex items-center justify-between gap-3">
									<dt>{t("homeHealthJobs")}</dt>
									<dd className="font-mono">{data?.index?.jobs ?? t("homeHealthUnavailable")}</dd>
								</div>
							</dl>
						</section>
					</aside>
				</div>
			)}
		</div>
	);
}
