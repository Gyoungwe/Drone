import { describe, expect, it } from "vitest";
import { commandForKey, cycleTab, DESKTOP_COMMANDS, isDesktopCommand } from "./desktop-command";

const key = (
	k: string,
	mods: Partial<{ meta: boolean; ctrl: boolean; shift: boolean; alt: boolean }> = {},
) => ({
	key: k,
	metaKey: !!mods.meta,
	ctrlKey: !!mods.ctrl,
	shiftKey: !!mods.shift,
	altKey: !!mods.alt,
});

describe("desktop command bus", () => {
	it("maps every menu accelerator to a unique command", () => {
		const commands = DESKTOP_COMMANDS.map((b) => b.command);
		expect(new Set(commands).size).toBe(commands.length);
		expect(DESKTOP_COMMANDS.find((b) => b.command === "search")?.accelerator).toBe("CmdOrCtrl+K");
		expect(isDesktopCommand("find")).toBe(true);
		expect(isDesktopCommand("rm -rf")).toBe(false);
	});
	it("windows/linux: Ctrl shortcuts all go through the renderer", () => {
		expect(commandForKey(key("k", { ctrl: true }), false)).toBe("search");
		expect(commandForKey(key("n", { ctrl: true }), false)).toBe("new-task");
		expect(commandForKey(key("w", { ctrl: true }), false)).toBe("close-tab");
		expect(commandForKey(key(",", { ctrl: true }), false)).toBe("settings");
		expect(commandForKey(key("{", { ctrl: true, shift: true }), false)).toBe("prev-tab");
		expect(commandForKey(key("}", { ctrl: true, shift: true }), false)).toBe("next-tab");
		expect(commandForKey(key("Enter", { ctrl: true }), false)).toBe("send");
		expect(commandForKey(key("f", { ctrl: true }), false)).toBe("find");
		expect(commandForKey(key("k", { meta: true }), false)).toBeNull();
	});
	it("mac: menu owns ⌘K…, renderer only handles ⌘↵ / ⌘F", () => {
		expect(commandForKey(key("k", { meta: true }), true)).toBeNull();
		expect(commandForKey(key("Enter", { meta: true }), true)).toBe("send");
		expect(commandForKey(key("f", { meta: true }), true)).toBe("find");
		expect(commandForKey(key("f", { meta: true, alt: true }), true)).toBeNull();
	});
	it("cycles tabs", () => {
		expect(cycleTab(["a", "b", "c"], "a", -1)).toBe("c");
		expect(cycleTab(["a", "b", "c"], "c", 1)).toBe("a");
		expect(cycleTab([], "a", 1)).toBeNull();
		expect(cycleTab(["a"], "zz", 1)).toBe("a");
	});
});
