import { describe, expect, it, vi } from "vitest";
import { applyAttentionBadge, type BadgeHost } from "./attention-badge";

function host(platform: string, focused = false) {
	const win = { setOverlayIcon: vi.fn(), flashFrame: vi.fn(), isFocused: () => focused };
	const h: BadgeHost & { win: typeof win } = {
		platform,
		win,
		window: win,
		setBadgeCount: vi.fn(),
		imageFromDataUrl: vi.fn((url: string) => ({ url })),
	};
	return h;
}

describe("attention badge (P14)", () => {
	it("uses the dock count on macOS and clears it", () => {
		const h = host("darwin");
		applyAttentionBadge(h, 2, null);
		applyAttentionBadge(h, 0, null);
		expect(h.setBadgeCount).toHaveBeenNthCalledWith(1, 2);
		expect(h.setBadgeCount).toHaveBeenNthCalledWith(2, 0);
	});
	it("uses an overlay icon and flashes on Windows", () => {
		const h = host("win32");
		applyAttentionBadge(h, 3, "data:image/png;base64,AA");
		expect(h.win.setOverlayIcon).toHaveBeenCalledWith({ url: "data:image/png;base64,AA" }, "3");
		expect(h.win.flashFrame).toHaveBeenCalledWith(true);
		applyAttentionBadge(h, 0, null);
		expect(h.win.setOverlayIcon).toHaveBeenLastCalledWith(null, "");
		expect(h.win.flashFrame).toHaveBeenLastCalledWith(false);
		expect(h.setBadgeCount).not.toHaveBeenCalled();
	});
});
