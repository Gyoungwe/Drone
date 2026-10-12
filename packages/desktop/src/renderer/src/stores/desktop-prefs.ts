import { DEFAULT_DESKTOP_PREFS, type DesktopPrefs, normalizeDesktopPrefs } from "@drone/shared";
import { create } from "zustand";
import { getPi } from "../api";

/** 桌面端偏好（P11）：持久化在 ui-state.json 的 desktop 字段，main 侧同步应用登录项 / 托盘 / 下载目录。 */
interface DesktopPrefsStore {
	prefs: DesktopPrefs;
	init: () => Promise<void>;
	update: (patch: Partial<DesktopPrefs>) => void;
}

export const useDesktopPrefsStore = create<DesktopPrefsStore>((set, get) => ({
	prefs: DEFAULT_DESKTOP_PREFS,
	init: async () => {
		const saved = await getPi()
			.loadUiState()
			.catch(() => null);
		set({ prefs: normalizeDesktopPrefs(saved?.desktop) });
	},
	update: (patch) => {
		const prefs = normalizeDesktopPrefs({ ...get().prefs, ...patch });
		set({ prefs });
		getPi()
			.saveUiState({ desktop: prefs })
			.catch((error) => console.error("ui-state 持久化失败", error));
	},
}));
