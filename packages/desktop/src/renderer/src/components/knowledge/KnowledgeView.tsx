import { useEffect, useState } from "react";
import { getPi } from "../../api";
import { PluginEntryHost, usePluginEntries } from "../../plugins/PluginRegions";
import { UI_REGIONS } from "../../plugins/slots";
import { useKnowledgeStore } from "../../stores/knowledge";
import { useSessionsStore } from "../../stores/sessions";
import { type KnowledgeTab, useUiStore } from "../../stores/ui";
import { Button } from "../ui/Button";
import { PageHeader } from "../ui/PageHeader";
import { useKnowledgeText } from "./copy";
import { reportKnowledgeError, useKnowledgeOverview } from "./hooks";
import { KnowledgeHome } from "./KnowledgeHome";
import { KnowledgeNetwork } from "./KnowledgeNetwork";
import { KnowledgeNoteViewer } from "./KnowledgeNoteViewer";
import { KnowledgePanel } from "./KnowledgePanel";

/**
 * 知识库全屏视图（替代原 z-60 弹窗；原「研究工作台」入口已并入）：占据主区整列，Esc / × 回到聊天。
 * 内容按单层页签切换总览、网络图、审阅和设置；打开单篇笔记时是 KnowledgeNoteViewer。
 * 设置页承载绑定、WebDAV、索引、语义、主题和工作流维护。
 *
 * 通过左侧导航直接进入而 store 里还没有上下文时，用当前会话/目录补一份（刷新后也能打开）。
 */
export function KnowledgeView() {
	const t = useKnowledgeText();
	const dialog = useKnowledgeStore((s) => s.dialog);
	const close = useKnowledgeStore((s) => s.close);
	const open = useKnowledgeStore((s) => s.open);
	const cwd = useSessionsStore((s) => s.cwd);
	const activeSessionId = useSessionsStore((s) => s.activeSessionId);
	const requestedTab = useUiStore((s) => s.knowledgeTab);
	const setRequestedTab = useUiStore((s) => s.setKnowledgeTab);
	const [tab, setTab] = useState<KnowledgeTab>(requestedTab);
	const pluginTabs = usePluginEntries(UI_REGIONS.KnowledgeTab);
	const knowledgePage = usePluginEntries(UI_REGIONS.KnowledgePage)[0];
	const [pluginTab, setPluginTab] = useState<string | null>(null);
	const selectedPlugin = pluginTabs.find((entry) => entry.id === pluginTab);
	useEffect(() => {
		if (pluginTab && !pluginTabs.some((entry) => entry.id === pluginTab)) setPluginTab(null);
	}, [pluginTab, pluginTabs]);
	useEffect(() => setTab(requestedTab), [requestedTab]);
	const selectTab = (next: KnowledgeTab) => {
		setTab(next);
		setRequestedTab(next);
	};

	useEffect(() => {
		if (dialog) return;
		open({ cwd, sessionId: activeSessionId, tab: "reviews" });
	}, [dialog, open, cwd, activeSessionId]);

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			if (useKnowledgeStore.getState().review) return;
			const target = event.target as HTMLElement | null;
			if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable))
				return;
			event.preventDefault();
			close();
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [close]);

	const overview = useKnowledgeOverview(dialog?.cwd ?? null, dialog?.sessionId ?? null).data;
	const binding = overview?.binding;

	if (!dialog) return null;
	if (knowledgePage) {
		return (
			<section className="knowledge-view" aria-label={t("title")} data-testid="knowledge-plugin-page">
				<div className="knowledge-view-body">
					<div className="mx-auto flex h-full min-h-0 w-full max-w-5xl flex-1">
						<PluginEntryHost entry={knowledgePage} />
					</div>
				</div>
			</section>
		);
	}
	const vault = binding?.vault?.replace(/[\\/]$/u, "") ?? "";
	const vaultLabel = vault.slice(Math.max(vault.lastIndexOf("/"), vault.lastIndexOf("\\")) + 1) || vault;
	const description = binding
		? `${vaultLabel} · ${overview?.index?.noteCount ?? t("homeCountUnknown")} ${t("homeVaultNotes")}${
				overview?.project ? ` · ${t("homeProjectContext")}: ${overview.project}` : ""
			}`
		: t("homeBindingHint");
	return (
		<section className="knowledge-view" aria-label={t("title")}>
			<div className="knowledge-view-body">
				<div className="mx-auto w-full max-w-5xl">
					{!dialog.note && (
						<PageHeader
							title={t("title")}
							description={description}
							actions={
								<Button
									size="sm"
									variant="primary"
									disabled={!binding}
									onClick={() => {
										if (binding)
											void getPi()
												.openKnowledgeTarget({ cwd: dialog.cwd, revision: binding.revision })
												.catch(reportKnowledgeError);
									}}
								>
									{t("homeNewNote")}
								</Button>
							}
							tabs={
								<div className="flex gap-1" role="tablist" aria-label={t("title")}>
									{(["overview", "network", "reviews", "settings"] as const).map((item) => (
										<button
											key={item}
											type="button"
											role="tab"
											aria-selected={tab === item}
											className={`-mb-px border-b-2 px-3 py-2 text-[13px] ${tab === item ? "border-ink font-semibold text-ink" : "border-transparent text-ink-dim hover:text-ink"}`}
											onClick={() => selectTab(item)}
										>
											{t(
												(
													{
														overview: "overviewTab",
														network: "networkTab",
														reviews: "reviewTab",
														settings: "settingsTab",
													} as const
												)[item],
											)}
										</button>
									))}
									{pluginTabs.map((entry) => (
										<button
											key={entry.id}
											type="button"
											role="tab"
											aria-selected={pluginTab === entry.id}
											className={`-mb-px border-b-2 px-3 py-2 text-[13px] ${pluginTab === entry.id ? "border-ink font-semibold text-ink" : "border-transparent text-ink-dim hover:text-ink"}`}
											onClick={() => setPluginTab(entry.id)}
											data-plugin={entry.pluginName}
										>
											{entry.title}
										</button>
									))}
								</div>
							}
						/>
					)}
					{selectedPlugin ? (
						<PluginEntryHost entry={selectedPlugin} />
					) : dialog.note && dialog.noteRevision ? (
						<KnowledgeNoteViewer
							cwd={dialog.cwd}
							path={dialog.note}
							revision={dialog.noteRevision}
							// Closing a note returns to the tab it was opened from, not out of the knowledge page.
							onClose={() => open({ cwd: dialog.cwd, sessionId: dialog.sessionId, tab: "reviews" })}
						/>
					) : tab === "network" ? (
						<KnowledgeNetwork cwd={dialog.cwd} sessionId={dialog.sessionId} />
					) : tab === "reviews" ? (
						<KnowledgePanel
							context={{ cwd: dialog.cwd, sessionId: dialog.sessionId, tab: "reviews", id: dialog.id }}
							headless
							hideTabs
						/>
					) : tab === "settings" ? (
						<KnowledgePanel
							context={{ cwd: dialog.cwd, sessionId: dialog.sessionId, tab: "settings" }}
							headless
							hideTabs
						/>
					) : (
						<KnowledgeHome cwd={dialog.cwd} sessionId={dialog.sessionId} reviewId={dialog.id} />
					)}
				</div>
			</div>
		</section>
	);
}
