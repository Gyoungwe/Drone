import { describe, expect, it } from "vitest";
import {
	DEFAULT_DESKTOP_PREFS,
	loginItemSettings,
	needsTray,
	normalizeDesktopPrefs,
	shouldNotify,
	shouldPlaySound,
} from "./desktop-prefs";

describe("desktop prefs (P11)", () => {
	it("normalizes persisted values", () => {
		expect(normalizeDesktopPrefs(undefined)).toEqual(DEFAULT_DESKTOP_PREFS);
		expect(normalizeDesktopPrefs({ completionSound: true, openAtLogin: "yes", downloadDir: "  " })).toEqual({
			...DEFAULT_DESKTOP_PREFS,
			completionSound: true,
		});
		expect(normalizeDesktopPrefs({ downloadDir: "D:\\dl" }).downloadDir).toBe("D:\\dl");
	});
	it("round-trips through JSON", () => {
		const p = { ...DEFAULT_DESKTOP_PREFS, menuBarIcon: true, downloadDir: "/tmp/x" };
		expect(normalizeDesktopPrefs(JSON.parse(JSON.stringify(p)))).toEqual(p);
	});
	it("login start opens hidden and forces a tray", () => {
		const on = { ...DEFAULT_DESKTOP_PREFS, openAtLogin: true };
		expect(loginItemSettings(on)).toEqual({ openAtLogin: true, openAsHidden: true, args: ["--hidden"] });
		expect(loginItemSettings(DEFAULT_DESKTOP_PREFS).args).toEqual([]);
		expect(needsTray(DEFAULT_DESKTOP_PREFS, true)).toBe(true);
		expect(needsTray(DEFAULT_DESKTOP_PREFS, false)).toBe(false);
	});
	it("notifies only in background; sound skips asks", () => {
		expect(shouldNotify(DEFAULT_DESKTOP_PREFS, false)).toBe(true);
		expect(shouldNotify(DEFAULT_DESKTOP_PREFS, true)).toBe(false);
		const s = { ...DEFAULT_DESKTOP_PREFS, completionSound: true };
		expect(shouldPlaySound(s, "done")).toBe(true);
		expect(shouldPlaySound(s, "ask")).toBe(false);
	});
});
