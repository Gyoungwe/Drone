import { DEFAULT_DESKTOP_PREFS } from "@drone/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDesktopPrefsStore } from "../stores/desktop-prefs";
import { notifyCompletion } from "./completion-notify";

const env = (focused: boolean) => ({ focused: () => focused, notify: vi.fn(), beep: vi.fn() });

describe("notifyCompletion (P11)", () => {
	beforeEach(() => useDesktopPrefsStore.setState({ prefs: DEFAULT_DESKTOP_PREFS }));
	it("notifies only when the window is in the background", () => {
		const bg = env(false);
		expect(notifyCompletion("done", "t", "b", undefined, bg)).toEqual({ notified: true, sounded: false });
		expect(bg.notify).toHaveBeenCalledWith("t", "b", expect.any(Function));
		const fg = env(true);
		expect(notifyCompletion("done", "t", "b", undefined, fg).notified).toBe(false);
	});
	it("plays the completion sound when enabled", () => {
		useDesktopPrefsStore.setState({
			prefs: { ...DEFAULT_DESKTOP_PREFS, completionSound: true, notifyInBackground: false },
		});
		const e = env(false);
		expect(notifyCompletion("done", "t", "b", undefined, e)).toEqual({ notified: false, sounded: true });
		expect(e.beep).toHaveBeenCalledOnce();
		expect(notifyCompletion("ask", "t", "b", undefined, env(false)).sounded).toBe(false);
	});
});
