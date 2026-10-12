import { DEFAULT_DESKTOP_PREFS } from "@drone/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	applyDesktopPrefs,
	currentDesktopPrefs,
	type DesktopPrefsHost,
	resetDesktopPrefsForTest,
} from "./desktop-prefs";

function host(platform = "win32", launchedHidden = false) {
	const destroy = vi.fn();
	const h: DesktopPrefsHost & { destroy: typeof destroy } = {
		platform,
		launchedHidden,
		destroy,
		setLoginItemSettings: vi.fn(),
		createTray: vi.fn(() => ({ destroy })),
	};
	return h;
}

describe("applyDesktopPrefs (P11)", () => {
	beforeEach(() => resetDesktopPrefsForTest());
	it("persists normalized prefs and toggles login item only when packaged", () => {
		const h = host();
		applyDesktopPrefs({ ...DEFAULT_DESKTOP_PREFS, openAtLogin: true }, h, false);
		expect(h.setLoginItemSettings).not.toHaveBeenCalled();
		resetDesktopPrefsForTest();
		applyDesktopPrefs({ openAtLogin: true }, h, true);
		expect(h.setLoginItemSettings).toHaveBeenCalledWith({
			openAtLogin: true,
			openAsHidden: true,
			args: ["--hidden"],
		});
		expect(currentDesktopPrefs().openAtLogin).toBe(true);
	});
	it("creates and destroys the tray", () => {
		const h = host("darwin");
		applyDesktopPrefs({ menuBarIcon: true }, h, true);
		applyDesktopPrefs({ menuBarIcon: true }, h, true);
		expect(h.createTray).toHaveBeenCalledTimes(1);
		applyDesktopPrefs({ menuBarIcon: false }, h, true);
		expect(h.destroy).toHaveBeenCalledTimes(1);
	});
	it("keeps a tray when launched hidden even if the icon is off", () => {
		const h = host("win32", true);
		applyDesktopPrefs({ menuBarIcon: false }, h, true);
		expect(h.createTray).toHaveBeenCalledTimes(1);
	});
	it("skips login items on Linux", () => {
		const h = host("linux");
		applyDesktopPrefs({ openAtLogin: true }, h, true);
		expect(h.setLoginItemSettings).not.toHaveBeenCalled();
	});
});
