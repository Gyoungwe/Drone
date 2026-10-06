import type { KnowledgeSearchResult } from "@drone/shared";
import { type FormEvent, useState } from "react";
import { getPi } from "../../api";
import { useKnowledgeStore } from "../../stores/knowledge";
import { Button } from "../ui/Button";
import { useKnowledgeText } from "./copy";

/** 知识库主页搜索框：只读检索共享知识 + 当前项目，点结果打开笔记 */
export function KnowledgeSearch({
	cwd,
	sessionId,
	bindingRevision,
}: {
	cwd: string | null;
	sessionId: string | null;
	bindingRevision: number;
}) {
	const t = useKnowledgeText();
	const [query, setQuery] = useState("");
	const [result, setResult] = useState<KnowledgeSearchResult | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function submit(event: FormEvent) {
		event.preventDefault();
		const text = query.trim();
		if (!text) return;
		setBusy(true);
		setError(null);
		try {
			setResult(await getPi().searchKnowledge({ cwd, bindingRevision, query: text }));
		} catch (e) {
			setError(String((e as Error).message || e));
		} finally {
			setBusy(false);
		}
	}

	return (
		<section aria-label={t("homeSearch")} data-testid="knowledge-search">
			<form className="flex gap-2" onSubmit={(event) => void submit(event)}>
				<input
					aria-label={t("homeSearch")}
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					placeholder={t("homeSearchPlaceholder")}
					className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-xs text-ink outline-none focus:border-accent"
				/>
				<Button size="sm" type="submit" disabled={busy || !query.trim()}>
					{busy ? t("loading") : t("homeSearch")}
				</Button>
			</form>
			{error && (
				<p role="alert" className="mt-2 break-words text-xs text-err">
					{error}
				</p>
			)}
			{result && (
				<div className="mt-2">
					{result.hits.length === 0 ? (
						<p className="text-[11px] text-ink-faint">
							{result.complete ? t("homeSearchEmpty") : t("homeSearchIncomplete")}
						</p>
					) : (
						<ul className="divide-y divide-border rounded-xl border border-border">
							{result.hits.map((hit) => (
								<li key={hit.path}>
									<button
										type="button"
										className="w-full px-3 py-2 text-left hover:bg-hover"
										onClick={() =>
											useKnowledgeStore.getState().open({
												cwd,
												sessionId,
												tab: "reviews",
												note: hit.path,
												noteRevision: bindingRevision,
											})
										}
									>
										<span className="block truncate text-xs font-medium" title={hit.title}>
											{hit.title || hit.path}
										</span>
										<span className="block truncate font-mono text-[11px] text-ink-faint">{hit.path}</span>
										{hit.text && (
											<span className="mt-1 line-clamp-2 block whitespace-pre-wrap text-[11px] text-ink-dim">
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
		</section>
	);
}
