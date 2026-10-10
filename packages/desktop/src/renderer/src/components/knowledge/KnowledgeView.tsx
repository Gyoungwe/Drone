import { useEffect } from "react";
import { useKnowledgeStore } from "../../stores/knowledge";
import { useSessionsStore } from "../../stores/sessions";
import { useUiStore } from "../../stores/ui";
import { CloseIcon } from "../icons";
import { useKnowledgeText } from "./copy";
import { KnowledgeHome } from "./KnowledgeHome";
import { KnowledgeNoteViewer } from "./KnowledgeNoteViewer";

/**
 * 知识库全屏视图（替代原 z-60 弹窗；原「研究工作台」入口已并入）：占据主区整列，Esc / × 回到聊天。
 * 内容是 KnowledgeHome（Vault 状态 + 最近沉淀 + 待处理修改），打开单篇笔记时是 KnowledgeNoteViewer。
 * 维护类功能（绑定、索引、语义、主题、审核模式）在 设置 › 高级 › 知识库维护。
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
			<header className="knowledge-view-head">
				<p className="text-[13px] font-medium text-ink">
					{t("title")}
					<span className="ml-2 text-[11px] font-normal text-ink-faint">Obsidian</span>
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
				<div className="mx-auto w-full max-w-[1440px]">
					{dialog.note && dialog.noteRevision ? (
						<KnowledgeNoteViewer
							cwd={dialog.cwd}
							path={dialog.note}
							revision={dialog.noteRevision}
							onClose={close}
						/>
					) : (
						<KnowledgeHome cwd={dialog.cwd} sessionId={dialog.sessionId} reviewId={dialog.id} />
					)}
				</div>
			</div>
		</section>
	);
}
