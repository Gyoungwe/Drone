import { useEffect } from "react";
import { useT } from "../../i18n";
import { useKnowledgeStore } from "../../stores/knowledge";
import { useSessionsStore } from "../../stores/sessions";
import { useUiStore } from "../../stores/ui";
import { CloseIcon } from "../icons";
import { useKnowledgeText } from "./copy";
import { KnowledgeNoteViewer } from "./KnowledgeNoteViewer";
import { KnowledgePanel } from "./KnowledgePanel";

/**
 * 研究工作台 / 知识库 全屏视图（替代原 z-60 弹窗）：占据主区整列，左侧导航高亮对应项，
 * Esc / × 回到聊天。内容仍是 KnowledgePanel（overview = 研究工作台；reviews/maintenance = 知识库）
 * 或 KnowledgeNoteViewer（打开单篇笔记时）。
 *
 * 通过左侧导航直接进入而 store 里还没有上下文时，用当前会话/目录补一份（刷新后也能打开）。
 */
export function KnowledgeView({ mode }: { mode: "research" | "knowledge" }) {
	const t = useKnowledgeText();
	const appT = useT();
	const dialog = useKnowledgeStore((s) => s.dialog);
	const close = useKnowledgeStore((s) => s.close);
	const open = useKnowledgeStore((s) => s.open);
	const cwd = useSessionsStore((s) => s.cwd);
	const activeSessionId = useSessionsStore((s) => s.activeSessionId);
	const setView = useUiStore((s) => s.setView);

	useEffect(() => {
		if (dialog) return;
		open({ cwd, sessionId: activeSessionId, tab: mode === "research" ? "overview" : "reviews" });
	}, [dialog, open, cwd, activeSessionId, mode]);

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
			<header className="knowledge-view-head">
				<p className="text-[13px] font-medium text-ink">
					{mode === "research" ? appT("workbench.views.research") : appT("workbench.views.knowledge")}
					<span className="ml-2 text-[11px] font-normal text-ink-faint">Obsidian · {t(dialog.tab)}</span>
				</p>
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
				<div className="mx-auto w-full max-w-[1120px]">
					{dialog.note && dialog.noteRevision ? (
						<KnowledgeNoteViewer
							cwd={dialog.cwd}
							path={dialog.note}
							revision={dialog.noteRevision}
							onClose={close}
						/>
					) : (
						<KnowledgePanel context={dialog} headless />
					)}
				</div>
			</div>
		</section>
	);
}
