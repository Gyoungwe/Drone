import type { KnowledgeSearchResult } from "@drone/shared";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { getPi } from "../../api";
import { useKnowledgeStore } from "../../stores/knowledge";
import { Button } from "../ui/Button";
import { useKnowledgeText } from "./copy";
import type { KnowledgeCategory } from "./knowledge-home-model";
import { classifyKnowledgeHit } from "./knowledge-home-model";

export type { KnowledgeCategory } from "./knowledge-home-model";

type Counts = Record<KnowledgeCategory, number | null>;

const CATEGORY_KEYS: Record<KnowledgeCategory, string> = {
	all: "homeCategoryAll",
	paper: "homeCategoryPaper",
	software: "homeCategorySoftware",
	method: "homeCategoryMethod",
	idea: "homeCategoryIdea",
};

export function KnowledgeSearch({
	cwd,
	sessionId,
	bindingRevision,
	activeCategory,
	onCategoryChange,
	categoryCounts,
}: {
	cwd: string | null;
	sessionId: string | null;
	bindingRevision: number;
	activeCategory: KnowledgeCategory;
	onCategoryChange: (category: KnowledgeCategory) => void;
	categoryCounts: Counts;
}) {
	const t = useKnowledgeText();
	const inputRef = useRef<HTMLInputElement>(null);
	const [query, setQuery] = useState("");
	const [result, setResult] = useState<KnowledgeSearchResult | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		const onShortcut = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
				event.preventDefault();
				inputRef.current?.focus();
			}
		};
		document.addEventListener("keydown", onShortcut);
		return () => document.removeEventListener("keydown", onShortcut);
	}, []);

	async function submit(event?: FormEvent) {
		event?.preventDefault();
		const text = query.trim();
		if (!text || !bindingRevision) return;
		setBusy(true);
		setError(null);
		try {
			setResult(await getPi().searchKnowledge({ cwd, bindingRevision, query: text }));
		} catch (cause) {
			setError(String(cause instanceof Error ? cause.message : cause));
		} finally {
			setBusy(false);
		}
	}

	const hits = useMemo(
		() =>
			result?.hits.filter(
				(hit) => activeCategory === "all" || classifyKnowledgeHit(hit.kind, hit.path) === activeCategory,
			) ?? [],
		[result, activeCategory],
	);
	const openHit = (path: string) =>
		useKnowledgeStore
			.getState()
			.open({ cwd, sessionId, tab: "reviews", note: path, noteRevision: bindingRevision });

	return (
		<div data-testid="knowledge-search">
			<form
				className="flex h-11 items-center gap-2 rounded-xl border border-border bg-surface px-3 focus-within:border-ink-faint"
				onSubmit={(event) => void submit(event)}
			>
				<span aria-hidden="true" className="text-sm text-ink-dim">
					⌕
				</span>
				<label htmlFor="knowledge-search-input" className="sr-only">
					{t("homeSearch")}
				</label>
				<input
					ref={inputRef}
					id="knowledge-search-input"
					type="search"
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					placeholder={t("homeSearchPlaceholder")}
					className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none"
					disabled={!bindingRevision}
				/>
				<kbd className="rounded-md bg-hover px-2 py-0.5 text-[11px] text-ink-dim">
					{t("homeSearchShortcut")}
				</kbd>
				<Button size="sm" type="submit" disabled={busy || !query.trim() || !bindingRevision}>
					{busy ? t("loading") : t("homeSearch")}
				</Button>
			</form>
			<div className="mt-3 flex flex-wrap items-center gap-1" role="tablist" aria-label={t("homeCategories")}>
				{(Object.keys(CATEGORY_KEYS) as KnowledgeCategory[]).map((category) => {
					const count = categoryCounts[category];
					return (
						<button
							key={category}
							type="button"
							role="tab"
							aria-selected={activeCategory === category}
							onClick={() => onCategoryChange(category)}
							className={`rounded-full px-3 py-2 text-xs ${activeCategory === category ? "bg-hover font-medium text-ink" : count === 0 ? "text-ink-faint opacity-60 hover:bg-hover" : "text-ink-dim hover:bg-hover"}`}
						>
							{t(CATEGORY_KEYS[category] as any)} {count == null ? t("homeCountUnknown") : count}
						</button>
					);
				})}
			</div>
			{!bindingRevision && <p className="mt-3 text-xs text-ink-faint">{t("homeSearchUnavailable")}</p>}
			{error && (
				<p role="alert" className="mt-3 break-words text-xs text-err">
					{error}
				</p>
			)}
			{result && (
				<div className="mt-3">
					{hits.length === 0 ? (
						<p className="text-xs text-ink-faint">
							{result.complete ? t("homeSearchEmpty") : t("homeSearchIncomplete")}
						</p>
					) : (
						<ul className="divide-y divide-border rounded-xl border border-border bg-surface">
							{hits.map((hit) => (
								<li key={hit.path}>
									<button
										type="button"
										className="w-full px-3 py-3 text-left hover:bg-hover"
										onClick={() => openHit(hit.path)}
									>
										<span className="block truncate text-xs font-medium" title={hit.title}>
											{hit.title || hit.path}
										</span>
										<span className="mt-1 block truncate font-mono text-[11px] text-ink-faint">
											{hit.path}
										</span>
										{hit.text && (
											<span className="mt-1 line-clamp-2 block whitespace-pre-wrap text-xs text-ink-dim">
												{hit.text}
											</span>
										)}
									</button>
								</li>
							))}
						</ul>
					)}
				</div>
			)}
		</div>
	);
}
