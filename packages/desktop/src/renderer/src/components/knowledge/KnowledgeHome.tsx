import { getPi } from "../../api";
import { useKnowledgeStore } from "../../stores/knowledge";
import { useSettingsStore } from "../../stores/settings";
import { Button } from "../ui/Button";
import { useKnowledgeText } from "./copy";
import { reportKnowledgeError, useKnowledgeOverview } from "./hooks";
import { WikiReviewPanel } from "./WikiReviewPanel";

const RECENT_LIMIT = 12;

/**
 * 知识库主视图（左侧导航「知识库」）：Vault 状态 + 最近沉淀 + 待处理修改。
 * 绑定、索引、语义检索、主题、专家与审核模式等维护功能在 设置 › 高级 › 知识库维护（KnowledgePanel）。
 */
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
	const { data, error, loading, refresh } = useKnowledgeOverview(cwd, sessionId);
	const binding = data?.binding;
	const recent = (data?.wikiHistory ?? []).slice(0, RECENT_LIMIT);
	const manage = () => useSettingsStore.getState().openWith("knowledge");

	return (
		<div className="space-y-4 text-ink" data-testid="knowledge-home">
			<section className="flex flex-wrap items-center gap-2 rounded-xl border border-border p-3">
				<div className="min-w-0 flex-1">
					{binding ? (
						<>
							<p className="break-all font-mono text-xs">{binding.vault}</p>
							<p className="mt-1 text-[11px] text-ink-dim">
								{t("notes")} {data?.index?.noteCount ?? "—"} · {t("pending")}{" "}
								{data?.index?.pendingChanges ?? "—"}
							</p>
						</>
					) : (
						<p className="text-xs text-ink-dim">
							{data && !data.enabled ? t("disabled") : data ? t("notBound") : t("loading")}
						</p>
					)}
				</div>
				{binding && (
					<Button
						size="sm"
						onClick={() =>
							void getPi()
								.openKnowledgeTarget({ cwd, revision: binding.revision })
								.catch(reportKnowledgeError)
						}
					>
						{t("openVault")}
					</Button>
				)}
				<Button size="sm" disabled={loading} onClick={() => void refresh()}>
					{t("refresh")}
				</Button>
				<Button size="sm" onClick={manage} title={t("homeManageHint")}>
					{t("homeManage")}
				</Button>
			</section>
			{error && (
				<p role="alert" className="break-words rounded-lg border border-border p-3 text-xs text-err">
					{error}
				</p>
			)}
			{binding && (
				<section aria-label={t("homeRecent")}>
					<h3 className="mb-2 text-xs font-semibold">{t("homeRecent")}</h3>
					{recent.length === 0 ? (
						<p className="text-[11px] text-ink-faint">{t("homeRecentEmpty")}</p>
					) : (
						<ul className="divide-y divide-border rounded-xl border border-border">
							{recent.map((item) => (
								<li key={item.id}>
									<button
										type="button"
										className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-hover"
										onClick={() =>
											useKnowledgeStore.getState().open({
												cwd,
												sessionId,
												tab: "reviews",
												note: item.path,
												noteRevision: binding.revision,
											})
										}
									>
										<span className="min-w-0 flex-1 truncate font-mono" title={item.path}>
											{item.path}
										</span>
										<span className="shrink-0 text-[11px] text-ink-faint">
											{new Date(item.reviewedAt).toLocaleString()}
										</span>
									</button>
								</li>
							))}
						</ul>
					)}
				</section>
			)}
			{binding && (
				<section aria-label={t("homePending")}>
					<h3 className="mb-2 text-xs font-semibold">{t("homePending")}</h3>
					<WikiReviewPanel cwd={cwd} revision={binding.revision} initialId={reviewId} />
				</section>
			)}
			{!binding && data?.enabled && (
				<p className="text-[11px] leading-relaxed text-ink-dim">{t("homeManageHint")}</p>
			)}
		</div>
	);
}
