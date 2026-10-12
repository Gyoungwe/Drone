import { parsePins, pinKey, type SearchItem } from "@drone/shared";
import { create } from "zustand";

/** 置顶（P6 引入，P7 右键菜单复用）：任务 / 项目，持久化到 localStorage（与 projects 的已添加目录同一机制）。 */
export const PINS_KEY = "drone.pins";

interface PinsStore {
	pins: string[];
	isPinned: (kind: SearchItem["kind"], id: string) => boolean;
	togglePin: (kind: SearchItem["kind"], id: string) => void;
}

function save(pins: string[]): void {
	try {
		localStorage.setItem(PINS_KEY, JSON.stringify(pins));
	} catch {
		// 存储不可用时只在内存生效
	}
}

function load(): string[] {
	try {
		return parsePins(localStorage.getItem(PINS_KEY));
	} catch {
		return [];
	}
}

export const usePinsStore = create<PinsStore>((set, get) => ({
	pins: load(),
	isPinned: (kind, id) => get().pins.includes(pinKey(kind, id)),
	togglePin: (kind, id) => {
		const key = pinKey(kind, id);
		const pins = get().pins.includes(key) ? get().pins.filter((p) => p !== key) : [...get().pins, key];
		save(pins);
		set({ pins });
	},
}));
