import {
	FILE_MENU,
	type FileMenuAction,
	relativeToCwd,
	TAB_MENU,
	type TabMenuAction,
	tabsToClose,
} from "@drone/shared";
import { getPi } from "../../api";
import type { useT } from "../../i18n";
import { COMPOSER_FOCUS_EVENT, NEW_SESSION_DRAFT_KEY, useDraftStore } from "../../stores/drafts";
import { usePinsStore } from "../../stores/pins";
import { useProjectsStore } from "../../stores/projects";
import { useSessionsStore } from "../../stores/sessions";
import { pushToast } from "../../stores/toasts";
import { useUiStore } from "../../stores/ui";
import { type ContextMenuGroups, useContextMenuStore } from "./ContextMenu";

type T = ReturnType<typeof useT>;
export interface FileMenuTarget {
	/** 绝对路径或相对 cwd 的路径 */
	path: string;
	cwd?: string;
}

const report = () => (error: unknown) =>
	pushToast("error", "contextMenu.failed", error instanceof Error ? error.message : String(error));

/** 文件右键菜单 12 项（P7），顺序见 shared FILE_MENU。 */
export function buildFileMenu(target: FileMenuTarget, t: T): ContextMenuGroups {
	const pi = getPi();
	const cwd = target.cwd ?? null;
	const name = target.path.split(/[\\/]/).pop() || target.path;
	const fail = report();
	const run: Record<FileMenuAction, () => void> = {
		view: () =>
			useUiStore.getState().openResourcePreview({ href: target.path, cwd: target.cwd, label: name }),
		download: () => void pi.fileAction("download", target.path, cwd, null).catch(fail),
		addToChat: () => {
			const key = useSessionsStore.getState().activeSessionId ?? NEW_SESSION_DRAFT_KEY;
			const rel = relativeToCwd(target.path, target.cwd);
			useDraftStore
				.getState()
				.updateDraft(key, (entry) =>
					entry.attachments.includes(rel) ? entry : { ...entry, attachments: [...entry.attachments, rel] },
				);
			window.dispatchEvent(new Event(COMPOSER_FOCUS_EVENT));
		},
		openDefault: () => void pi.fileAction("openDefault", target.path, cwd, null).catch(fail),
		reveal: () => void pi.fileAction("reveal", target.path, cwd, null).catch(fail),
		openInEditor: () => void pi.fileAction("openInEditor", target.path, cwd, null).catch(fail),
		copyPath: () => void navigator.clipboard.writeText(target.path).catch(fail),
		copyRelativePath: () =>
			void navigator.clipboard.writeText(relativeToCwd(target.path, target.cwd)).catch(fail),
		cut: () => void pi.fileAction("cut", target.path, cwd, null).catch(fail),
		copy: () => void pi.fileAction("copy", target.path, cwd, null).catch(fail),
		rename: () =>
			useContextMenuStore.getState().askText({
				title: t("contextMenu.file.renameTitle"),
				initial: name,
				confirmLabel: t("contextMenu.file.rename"),
				onSubmit: (value) =>
					void pi
						.fileAction("rename", target.path, cwd, value)
						.then((next) => next && pushToast("info", "contextMenu.renamed", next))
						.catch(fail),
			}),
		delete: () => {
			if (!window.confirm(t("contextMenu.file.confirmDelete", { name }))) return;
			void pi.fileAction("trash", target.path, cwd, null).catch(fail);
		},
	};
	return FILE_MENU.map((group) =>
		group.map((id) => ({
			id,
			label: t(`contextMenu.file.${id}`),
			danger: id === "delete",
			onSelect: run[id],
		})),
	);
}

/** 标签右键菜单 8 项（P7）。 */
export function buildTabMenu(sessionId: string, t: T, startRename?: () => void): ContextMenuGroups {
	const sessions = useSessionsStore.getState();
	const ids = sessions.sessions.map((s) => s.sessionId);
	const pinned = usePinsStore.getState().isPinned("task", sessionId);
	const closeMany = (list: string[]) => {
		for (const id of list) void sessions.closeSession(id);
	};
	const session = sessions.sessions.find((s) => s.sessionId === sessionId);
	const run: Record<TabMenuAction, () => void> = {
		close: () => closeMany(tabsToClose(ids, sessionId, "close")),
		closeOthers: () => closeMany(tabsToClose(ids, sessionId, "closeOthers")),
		closeRight: () => closeMany(tabsToClose(ids, sessionId, "closeRight")),
		closeAll: () => closeMany(tabsToClose(ids, sessionId, "closeAll")),
		pin: () => usePinsStore.getState().togglePin("task", sessionId),
		rename: () => startRename?.(),
		// 隐藏 = 从标签栏移除，会话记录保留，可从项目页 / ⌘K 再打开
		hide: () => closeMany([sessionId]),
		delete: () => {
			if (!session || !window.confirm(t("contextMenu.tab.confirmDelete"))) return;
			void useProjectsStore.getState().deleteSession(session).catch(report());
		},
	};
	const index = ids.indexOf(sessionId);
	return TAB_MENU.map((group) =>
		group.map((id) => ({
			id,
			label: t(id === "pin" && pinned ? "contextMenu.tab.unpin" : `contextMenu.tab.${id}`),
			danger: id === "delete",
			checked: id === "pin" && pinned,
			disabled:
				(id === "rename" && !startRename) ||
				(id === "closeRight" && index === ids.length - 1) ||
				(id === "closeOthers" && ids.length < 2) ||
				(id === "delete" && !session?.sessionFile),
			onSelect: run[id],
		})),
	);
}
