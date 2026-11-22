// @vitest-environment node
import { expect, it, vi } from "vitest";

const desktop = vi.hoisted(() => ({
	showMessageBox: vi.fn(),
	contents: { isDestroyed: vi.fn(() => false) },
	window: {},
}));
vi.mock("electron", () => ({
	app: { getPath: () => "/tmp" },
	BrowserWindow: { fromWebContents: () => desktop.window },
	dialog: { showMessageBox: desktop.showMessageBox },
	webContents: { fromId: () => desktop.contents },
}));

import { approveDesktopRuntime } from "./runtime-host";

const source = {
	pluginId: "@example/index",
	packageRoot: "/example",
	entrypoint: "/example/runtime.mjs",
};
const owner = { id: 1, isDestroyed: () => false };

/**
 * The approved review is a four-part shape: a title, the facts of the
 * pending write, and the Approve and Deny labels. The dialog shows all
 * four when the lane supplies a review, and the generic prompt otherwise.
 */
it("shows the approved review copy, buttons and facts instead of the generic prompt", async () => {
	desktop.showMessageBox.mockReset();
	desktop.showMessageBox.mockResolvedValue({ response: 1 });
	const hash = "a".repeat(64);
	const approved = await approveDesktopRuntime(
		owner,
		source,
		"capability:bytes.write",
		"application-state-write",
		undefined,
		{
			kind: "byte-write",
			pluginId: "@example/index",
			root: "/exports/demo",
			file: { path: "reports/result.bin", bytes: 13, sha256: hash },
		},
	);
	expect(approved).toBe(true);
	expect(desktop.showMessageBox).toHaveBeenCalledWith(
		desktop.window,
		expect.objectContaining({
			title: "Plugin wants to write files",
			message: `Plugin: @example/index\nFolder: /exports/demo\nFiles:\n  reports/result.bin\n    Size: 13\n    SHA-256: ${hash}`,
			buttons: ["Deny", "Approve"],
			detail: "application-state-write",
		}),
	);
});

it("keeps the generic prompt and buttons when no review accompanies the write", async () => {
	desktop.showMessageBox.mockReset();
	desktop.showMessageBox.mockResolvedValue({ response: 1 });
	await approveDesktopRuntime(owner, source, "capability:bytes.write", "application-state-write");
	expect(desktop.showMessageBox).toHaveBeenCalledWith(
		desktop.window,
		expect.objectContaining({
			title: "Plugin runtime permission",
			buttons: ["Deny", "Allow"],
		}),
	);
});
