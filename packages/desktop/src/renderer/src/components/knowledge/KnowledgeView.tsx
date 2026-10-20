import { useEffect, useState } from "react";
import { useKnowledgeStore } from "../../stores/knowledge";
import { useSessionsStore } from "../../stores/sessions";
import { type KnowledgeTab, useUiStore } from "../../stores/ui";
import { CloseIcon } from "../icons";
import { useKnowledgeText } from "./copy";
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
	const setView = useUiStore((s) => s.setView);
	const requestedTab = useUiStore((s) => s.knowledgeTab);
	const setRequestedTab = useUiStore((s) => s.setKnowledgeTab);
	const [tab, setTab] = useState<KnowledgeTab>(requestedTab);
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

	if (!dialog) return null;
	return (
		<section className="knowledge-view" aria-label={t("title")}>
			<header className="knowledge-view-head justify-end">
				<button
					type="button"
					className="knowledge-view-close"
					onClick={() => {
						close();
						setView("chat");
					}}
					aria-label={t("close")}
					title={t("close")}
				>
					<CloseIcon />
				</button>
			</header>
			<div className="knowledge-view-body">
				<div className="mx-auto w-full max-w-[1440px]">
					{!dialog.note && (
						<div
							className="mb-4 flex gap-2 border-b border-border pb-2"
							role="tablist"
							aria-label={t("title")}
						>
							{(["overview", "network", "reviews", "settings"] as const).map((item) => (
								<button
									key={item}
									type="button"
									role="tab"
									aria-selected={tab === item}
									className={`rounded-lg px-3 py-2 text-xs ${tab === item ? "bg-hover font-semibold" : "text-ink-dim"}`}
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
						</div>
					)}
					{dialog.note && dialog.noteRevision ? (
						<KnowledgeNoteViewer
							cwd={dialog.cwd}
							path={dialog.note}
							revision={dialog.noteRevision}
							onClose={close}
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
