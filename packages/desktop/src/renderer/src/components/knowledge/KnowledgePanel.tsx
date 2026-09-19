import type { KnowledgeSetupPreview } from "@drone/shared";
import { useEffect, useState } from "react";
import { getPi } from "../../api";
import { useSessionsStore } from "../../stores/sessions";
import { useSettingsStore } from "../../stores/settings";
import { Button } from "../ui/Button";
import { useKnowledgeText } from "./copy";
import { launchKnowledgeSetup, reportKnowledgeError, useKnowledgeOverview } from "./hooks";
import { KnowledgeMaintenance } from "./KnowledgeMaintenance";
import { KnowledgeSpecialists } from "./KnowledgeSpecialists";
import { SemanticManagement } from "./SemanticManagement";
import { TopicManagement } from "./TopicManagement";
import { WikiReviewPanel } from "./WikiReviewPanel";
export function KnowledgePanel({
	context,
	headless = false,
}: {
	context?: {
		cwd: string | null;
		sessionId: string | null;
		tab?: "overview" | "reviews" | "maintenance" | "semantic" | "topics";
		id?: string;
	};
	/** 嵌入全屏视图（KnowledgeView 自带标题栏）时不再重复渲染标题，只保留刷新按钮 */
	headless?: boolean;
}) {
	const activeCwd = useSessionsStore((s) => s.cwd),
		activeSession = useSessionsStore((s) => s.activeSessionId);
	const cwd = context ? context.cwd : activeCwd,
		sessionId = context ? context.sessionId : activeSession,
		t = useKnowledgeText();
	const { data, error, loading, refresh } = useKnowledgeOverview(cwd, sessionId);
	const [tab, setTab] = useState<"overview" | "reviews" | "maintenance" | "semantic" | "topics">(
		context?.tab || "overview",
	);
	const [path, setPath] = useState(""),
		[preview, setPreview] = useState<KnowledgeSetupPreview | null>(null),
		[busy, setBusy] = useState(false),
		[actionError, setActionError] = useState<string | null>(null);
	useEffect(() => {
		setTab(context?.tab || "overview");
		setPreview(null);
		setPath("");
		setActionError(null);
	}, [context?.tab]);
	const binding = data?.binding,
		index = data?.index;
	const coverage =
		index?.coverage === "ready"
			? t("coverageReady")
			: index?.coverage === "indexing"
				? t("coverageIndexing")
				: index?.coverage === "partial"
					? t("coveragePartial")
					: t("coverageUninitialized");
	async function folders() {
		setActionError(null);
		try {
			const selected = await getPi().pickDirectory();
			if (selected) {
				setPath(selected);
				setPreview(null);
			}
		} catch (e) {
			setActionError(String((e as Error).message || e));
		}
	}
	async function inspect() {
		setBusy(true);
		setActionError(null);
		try {
			setPreview(await getPi().previewKnowledgeSetup({ cwd, path: path.trim() || binding?.vault || null }));
		} catch (e) {
			setActionError(String((e as Error).message || e));
		} finally {
			setBusy(false);
		}
	}
	function setup(target?: string) {
		void launchKnowledgeSetup(cwd, sessionId, target).catch(reportKnowledgeError);
	}
	return (
		<div className="text-ink" data-testid="knowledge-panel">
			<header className={`flex items-start gap-3 ${headless ? "justify-end" : "justify-between"}`}>
				{!headless && (
					<div>
						<h2 className="text-base font-semibold">{t("title")}</h2>
						<p className="mt-1 text-[11px] text-ink-dim">{t("subtitle")}</p>
					</div>
				)}
				<Button size="sm" disabled={loading || busy} onClick={() => void refresh()}>
					{t("refresh")}
				</Button>
			</header>
			<div
				className="my-4 flex flex-wrap gap-1 border-b border-border pb-2"
				role="tablist"
				aria-label={t("title")}
			>
				{(["overview", "reviews", "maintenance", "semantic", "topics"] as const).map((item) => (
					<button
						key={item}
						type="button"
						role="tab"
						aria-selected={tab === item}
						disabled={item !== "overview" && !binding}
						onClick={() => setTab(item)}
						className={`rounded-lg px-3 py-1.5 text-xs disabled:opacity-40 ${tab === item ? "bg-hover font-semibold" : "text-ink-dim hover:bg-hover"}`}
					>
						{t(item)}
					</button>
				))}
			</div>
			{error && (
				<p role="alert" className="mb-3 break-words rounded-lg border border-border p-3 text-xs text-err">
					{error}
				</p>
			)}
			{!data && loading && (
				<p role="status" className="text-xs">
					{t("loading")}
				</p>
			)}
			{tab === "overview" && (
				<div className="space-y-4">
					{data && !data.enabled && (
						<p className="rounded-lg bg-hover p-3 text-xs text-warn">{t("disabled")}</p>
					)}
					{data?.enabled && !data.bound && (
						<div className="rounded-xl border border-dashed border-border-strong p-5">
							<h3 className="text-sm font-medium">{t("notBound")}</h3>
							<p className="mt-2 text-xs leading-relaxed text-ink-dim">{t("notBoundHint")}</p>
						</div>
					)}
					{binding && (
						<section className="rounded-xl border border-border p-4">
							<div className="flex flex-wrap items-center gap-2">
								<h3 className="text-xs font-semibold">{t("vault")}</h3>
								<span className="rounded-full bg-accent/8 px-2 py-0.5 text-[11px] text-accent">
									{t("scopeValue")}
								</span>
							</div>
							<p className="mt-2 break-all font-mono text-xs">{binding.vault}</p>
							<p className="mt-1 text-[11px] text-ink-faint">{t("notMcp")}</p>
							<dl className="my-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
								<dt className="text-ink-dim">{t("project")}</dt>
								<dd className="break-all">{data.project || t("noProject")}</dd>
								<dt className="text-ink-dim">{t("profile")}</dt>
								<dd>{binding.profile}</dd>
								<dt className="text-ink-dim">{t("deposit")}</dt>
								<dd>{binding.depositMode}</dd>
								<dt className="text-ink-dim">{t("subagents")}</dt>
								<dd>{binding.subagentPolicy}</dd>
							</dl>
							<div className="flex flex-wrap gap-1">
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
								<Button size="sm" disabled={!cwd} onClick={() => setup(binding.vault)}>
									{t("adjust")}
								</Button>
							</div>
						</section>
					)}
					<section className="rounded-xl border border-border p-4">
						<div className="flex flex-wrap items-center justify-between gap-2">
							<h3 className="text-xs font-semibold">{t("literature")}</h3>
							<span className="rounded-full bg-hover px-2 py-0.5 text-[11px] text-ink-dim">
								{t("literatureBound")}
							</span>
						</div>
						<p className="mt-2 text-xs leading-relaxed text-ink-dim">{t("literatureHint")}</p>
						<div className="mt-3 flex flex-wrap gap-1">
							<Button size="sm" onClick={() => useSettingsStore.getState().openWith("zotero")}>
								{t("literatureSetup")}
							</Button>
							<Button
								size="sm"
								onClick={() =>
									void getPi().openExternal("https://www.zotero.org/download").catch(reportKnowledgeError)
								}
							>
								{t("literatureDownload")}
							</Button>
						</div>
					</section>
					{binding && (
						<section className="rounded-xl border border-edge p-3 space-y-2">
							<label className="flex items-center justify-between text-xs">
								知识审核
								<select
									aria-label="知识审核模式"
									value={data.reviewMode ?? "automatic"}
									disabled={busy}
									onChange={async (e) => {
										const action = e.target.value === "strict" ? "review-strict" : "review-automatic";
										setBusy(true);
										setActionError(null);
										try {
											await getPi().maintainKnowledge({ cwd, revision: binding.revision, action });
											refresh();
										} catch (err) {
											setActionError(String(err));
										} finally {
											setBusy(false);
										}
									}}
									className="rounded bg-surface px-2 py-1"
								>
									<option value="automatic">自动保存 · 非阻断提醒（推荐）</option>
									<option value="strict">严格审核 · 发布前检查</option>
								</select>
							</label>
							<p className="text-xs text-ink-dim">
								已保存：内容落盘，不代表科学验证。 有提醒：证据待核实，不阻断回答。
								待确认：人工内容或冲突，不自动覆盖。
							</p>
							<p className="text-xs text-ink-dim">
								工具权限在输入框的“自动执行 /
								严格确认”中单独设置；删除、发布和费用边界不会因知识自动审核而放开。
							</p>
							{actionError && (
								<p role="alert" className="text-xs text-err">
									{actionError}
								</p>
							)}
							{(data.wikiHistory ?? []).length > 0 && (
								<details>
									<summary className="text-xs cursor-pointer">Wiki 保存历史与撤销</summary>
									{data.wikiHistory?.map((item) => (
										<div key={item.id} className="flex gap-2 items-center text-xs py-1">
											<span className="flex-1 break-all">
												{item.path} · 已保存 · {new Date(item.reviewedAt).toLocaleString()}
											</span>
											<Button
												size="sm"
												disabled={busy}
												onClick={async () => {
													if (
														!window.confirm(
															`撤销 ${item.path} 的这次保存？新建页面会删除，已修改的页面不会被覆盖。`,
														)
													)
														return;
													setBusy(true);
													setActionError(null);
													try {
														await getPi().maintainKnowledge({
															cwd,
															revision: binding.revision,
															action: "undo-wiki",
															id: item.id,
															expectedHash: item.afterHash,
														});
														refresh();
													} catch (err) {
														setActionError(String(err));
													} finally {
														setBusy(false);
													}
												}}
											>
												撤销
											</Button>
										</div>
									))}
								</details>
							)}
						</section>
					)}
					{binding && (
						<KnowledgeSpecialists
							settings={data.specialistSettings}
							bindingRevision={binding.revision}
							permitted={binding.subagentPolicy === "read-local"}
							refresh={refresh}
							runs={data.flow?.specialists ?? []}
						/>
					)}
					{data?.specialistSettingsError && (
						<p role="alert" className="text-xs text-err">
							{data.specialistSettingsError}
						</p>
					)}
					{binding && (
						<section>
							<div className="mb-2 flex flex-wrap items-center justify-between gap-2">
								<h3 className="text-xs font-semibold">{t("index")}</h3>
								<span className="text-[11px] text-ink-dim">{index ? coverage : t("unknown")}</span>
							</div>
							<div className="grid grid-cols-3 gap-2">
								{[
									[t("notes"), index?.noteCount],
									[t("pending"), index?.pendingChanges],
									[t("jobs"), index?.jobs],
								].map(([label, value]) => (
									<div key={String(label)} className="rounded-lg bg-hover px-3 py-2">
										<p className="text-[11px] text-ink-dim">{label}</p>
										<p className="mt-1 text-lg font-medium tabular-nums">{value ?? "—"}</p>
									</div>
								))}
							</div>
							<p className="mt-2 text-[11px] text-ink-dim">
								{t("lastChecked")}：
								{index?.lastReconciledAt ? new Date(index.lastReconciledAt).toLocaleString() : t("unknown")}
							</p>
							{index && (
								<p className={`mt-1 text-[11px] ${index.watching ? "text-ink-dim" : "text-warn"}`}>
									{index.watching ? t("watching") : t("notWatching")}
								</p>
							)}
							{data?.error && (
								<p role="alert" className="mt-2 break-words text-xs text-err">
									{data.error}
								</p>
							)}
							<Button size="sm" className="mt-1" onClick={() => setTab("maintenance")}>
								{t("maintenance")}
							</Button>
						</section>
					)}
					{data?.legacyProjectVault && (
						<aside className="rounded-xl border border-border p-3">
							<h3 className="text-xs font-medium text-warn">{t("legacy")}</h3>
							<p className="my-1 break-all font-mono text-[11px]">{data.legacyProjectVault}</p>
							<p className="text-[11px] text-ink-dim">{t("legacyHint")}</p>
						</aside>
					)}
					<section className="rounded-xl border border-border p-4">
						<h3 className="text-xs font-semibold">{t("newPath")}</h3>
						<p className="mt-1 text-[11px] text-ink-dim">{t("skillBound")}</p>
						<p className="my-2 text-[11px] leading-relaxed text-ink-dim">{t("globalSwitch")}</p>
						<label className="block text-[11px] text-ink-dim">
							{t("vault")}
							<input
								aria-label={t("vault")}
								value={path}
								onChange={(e) => {
									setPath(e.target.value);
									setPreview(null);
								}}
								placeholder={t("pathPlaceholder")}
								className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs text-ink outline-none focus:border-accent"
							/>
						</label>
						<div className="mt-2 flex flex-wrap gap-1">
							<Button size="sm" disabled={busy} onClick={() => void folders()}>
								{t("selectFolder")}
							</Button>
							<Button size="sm" disabled={busy} onClick={() => void inspect()}>
								{busy ? t("loading") : t("preview")}
							</Button>
						</div>
						{!cwd && <p className="mt-2 text-xs text-warn">{t("selectProject")}</p>}
						{actionError && (
							<p role="alert" className="mt-2 whitespace-pre-wrap break-words text-xs text-err">
								{actionError}
							</p>
						)}
						{preview && (
							<div className="mt-3 space-y-3">
								<p className="text-[11px] text-ink-dim">{t("previewOnly")}</p>
								<div>
									<p className="text-xs font-medium">
										{preview.context.vault?.exists ? t("existing") : t("newVault")}
									</p>
									<pre className="mt-1 max-h-44 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-hover p-3 text-[11px]">
										{(preview.context.vault?.entries || [])
											.map((e) => (e.type === "directory" ? "▸ " : "  ") + e.path)
											.join("\n") || t("emptyPreview")}
									</pre>
									{preview.context.vault?.truncated && (
										<p className="text-[11px] text-warn">{t("truncated")}</p>
									)}
								</div>
								<div>
									<h4 className="mb-1 text-xs font-semibold">{t("templates")}</h4>
									{preview.options.profiles.map((profile) => (
										<details
											key={profile.id}
											open={profile.id === (binding?.profile || "hybrid")}
											className="mt-1 rounded-lg border border-border p-2 text-xs"
										>
											<summary className="cursor-pointer">{profile.label}</summary>
											<p className="mt-2 text-ink-dim">{profile.description}</p>
											<p className="mt-2 text-[11px]">
												{t("library")}：{profile.libraryTypes.join(" · ")}
											</p>
											<p className="mt-1 text-[11px]">
												{t("projectFolders")}：{profile.projectTypes.join(" · ")}
											</p>
											<pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-hover p-3 font-mono text-[11px]">
												{profile.directories.join("\n")}
											</pre>
										</details>
									))}
								</div>
								<div>
									<h4 className="text-xs font-semibold">{t("sampleContent")}</h4>
									{preview.templateSamples.map((sample) => (
										<details key={sample.path} className="mt-1 rounded-lg border border-border p-2">
											<summary className="cursor-pointer font-mono text-xs">{sample.path}</summary>
											<pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-words bg-hover p-3 text-[11px]">
												{sample.text}
											</pre>
										</details>
									))}
								</div>
							</div>
						)}
						<div className="mt-3 flex justify-end">
							<Button
								variant="primary"
								disabled={!cwd || !data?.enabled || busy}
								onClick={() => setup(path.trim() || undefined)}
							>
								{t("setup")}
							</Button>
						</div>
					</section>
					<p className="text-[11px] leading-relaxed text-ink-dim">{t("privacy")}</p>
				</div>
			)}
			{tab === "reviews" && binding && (
				<WikiReviewPanel cwd={cwd} revision={binding.revision} initialId={context?.id} />
			)}
			{tab === "maintenance" && binding && (
				<KnowledgeMaintenance cwd={cwd} revision={binding.revision} index={index} />
			)}
			{tab === "semantic" && binding && <SemanticManagement cwd={cwd} bindingRevision={binding.revision} />}
			{tab === "topics" && binding && (
				<TopicManagement cwd={cwd} bindingRevision={binding.revision} sessionId={sessionId} />
			)}
		</div>
	);
}
