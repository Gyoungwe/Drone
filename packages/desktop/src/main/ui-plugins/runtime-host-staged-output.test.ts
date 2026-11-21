// @vitest-environment node
import { type PluginRuntimeOwner, setReplyLanguage } from "@drone/backend";
import { beforeEach, expect, it, vi } from "vitest";

const desktop = vi.hoisted(() => ({
	showOpenDialog: vi.fn(),
	contents: { isDestroyed: vi.fn(() => false) },
	window: {},
}));
vi.mock("electron", () => ({
	app: { getPath: () => root },
	BrowserWindow: { fromWebContents: () => desktop.window },
	dialog: { showOpenDialog: desktop.showOpenDialog, showMessageBox: vi.fn() },
	webContents: { fromId: () => desktop.contents },
}));

import { selectStagedOutputDirectory } from "./runtime-host";

const root = "/tmp/drone-staged-output-picker";
const owner: PluginRuntimeOwner = { id: 7, isDestroyed: () => false };

beforeEach(() => {
	desktop.contents.isDestroyed.mockReset().mockReturnValue(false);
	desktop.window = {};
	desktop.showOpenDialog.mockReset().mockResolvedValue({ canceled: false, filePaths: ["/chosen"] });
	setReplyLanguage("en");
});

it("shows the approved English copy and returns the selected directory", async () => {
	const selected = await selectStagedOutputDirectory(owner, "@example/index");
	expect(desktop.showOpenDialog).toHaveBeenCalledTimes(1);
	expect(desktop.showOpenDialog.mock.calls[0]?.[0]).toBe(desktop.window);
	expect(desktop.showOpenDialog.mock.calls[0]?.[1]).toStrictEqual({
		title: "Authorize a directory for plugin staged output",
		message:
			"@example/index requests to write files uploaded in chunks (up to 64 MiB per upload) into the selected directory through the host, for this activation only. Each upload start and each write still needs approval showing the path, size and SHA-256. State JSON, notes and other directories are not granted. Cancel to stop activation.",
		properties: ["openDirectory"],
		buttonLabel: "Allow staged output writes",
	});
	expect(selected).toEqual(["/chosen"]);
});

it("shows the approved Chinese copy verbatim", async () => {
	setReplyLanguage("zh");
	await selectStagedOutputDirectory(owner, "@example/index");
	expect(desktop.showOpenDialog.mock.calls[0]?.[1]).toStrictEqual({
		title: "授权插件写入暂存输出的目录",
		message:
			"@example/index 申请通过宿主把分块上传的文件写入所选目录（单次上传最多 64 MiB）。仅授权本次启用；每次开始上传和每次写入仍需批准，并显示路径、大小和 SHA-256。不会授权状态 JSON、笔记或其他目录。取消将终止启用。",
		properties: ["openDirectory"],
		buttonLabel: "授权暂存输出写入",
	});
});

it("returns no directory when the user cancels", async () => {
	desktop.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: ["/chosen"] });
	expect(await selectStagedOutputDirectory(owner, "@example/index")).toEqual([]);
});

it("refuses when the approving window is already gone", async () => {
	desktop.contents.isDestroyed.mockReturnValue(true);
	await expect(selectStagedOutputDirectory(owner, "@example/index")).rejects.toThrow(
		"Plugin approving window is unavailable",
	);
	expect(desktop.showOpenDialog).not.toHaveBeenCalled();
});

it("refuses when the approving window closes during the dialog", async () => {
	desktop.showOpenDialog.mockImplementation(async () => {
		desktop.contents.isDestroyed.mockReturnValue(true);
		return { canceled: false, filePaths: ["/chosen"] };
	});
	await expect(selectStagedOutputDirectory(owner, "@example/index")).rejects.toThrow(
		"Plugin approving window closed during directory selection",
	);
});
