import { open, stat, writeFile } from "node:fs/promises";
import { basename, extname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PiBackend } from "@percho/backend";
import type { SavedTabs, UiState } from "@percho/shared";
import { IpcChannels } from "@percho/shared";
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from "electron";
import { pickBackgroundImage } from "../background";
import { ensureDailyDir } from "../daily";
import { checkoutBranch, getGitBranch, listGitBranches } from "../git";
import { loadTabs, saveTabs } from "../tabs";
import { loadUiState, saveUiState } from "../ui-state";
import { checkForUpdates, downloadUpdate, installUpdate } from "../updater";

const TEXT_EXTENSIONS = new Set([
	".txt",
	".md",
	".mdx",
	".json",
	".jsonl",
	".yaml",
	".yml",
	".toml",
	".csv",
	".tsv",
	".js",
	".jsx",
	".ts",
	".tsx",
	".css",
	".scss",
	".html",
	".htm",
	".xml",
	".svg",
	".py",
	".r",
	".go",
	".rs",
	".java",
	".c",
	".h",
	".cpp",
	".hpp",
	".sh",
	".zsh",
	".fish",
	".sql",
]);
const IMAGE_MIME: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".bmp": "image/bmp",
	".ico": "image/x-icon",
	".svg": "image/svg+xml",
};
const TEXT_PREVIEW_LIMIT = 2 * 1024 * 1024;
const BINARY_PREVIEW_LIMIT = 16 * 1024 * 1024;

async function readPrefix(path: string, limit: number): Promise<Buffer> {
	const file = await open(path, "r");
	try {
		const buffer = Buffer.alloc(limit);
		const { bytesRead } = await file.read(buffer, 0, limit, 0);
		return buffer.subarray(0, bytesRead);
	} finally {
		await file.close();
	}
}

function resolveResourcePath(target: string, cwd?: string): string {
	const raw = target.startsWith("file://") ? fileURLToPath(target) : decodeURIComponent(target);
	return isAbsolute(raw) ? resolve(raw) : resolve(cwd || process.cwd(), raw);
}

/** 项目仓库地址（帮助跳转 + 关于页） */
const REPO_URL = "https://github.com/Gyoungwe/percho";

/**
 * 应用域：窗口级功能（不依赖 PiBackend 会话状态的部分也在此，backend 参数仅为对齐签名）。
 * tabs/ui-state 持久化、背景图、更新、文件/目录对话框、git 分支、外链与应用信息。
 */
export function registerAppIpc(_backend: PiBackend): void {
	ipcMain.handle(IpcChannels.AppOpenExternal, (_e, url: string) => {
		// 只允许 http(s) 链接，防 file:// 等协议滥用
		if (typeof url === "string" && /^https?:\/\//.test(url)) return shell.openExternal(url);
	});
	ipcMain.handle(IpcChannels.FilePreview, async (_e, target: string, cwd?: string) => {
		if (
			typeof target !== "string" ||
			!target ||
			(/^[a-z][a-z0-9+.-]*:/i.test(target) && !target.startsWith("file://"))
		) {
			throw new Error("not a local file target");
		}
		const path = resolveResourcePath(target, cwd);
		const info = await stat(path);
		if (!info.isFile()) throw new Error("resource is not a file");
		const ext = extname(path).toLowerCase();
		const mimeType = IMAGE_MIME[ext] ?? (ext === ".pdf" ? "application/pdf" : "text/plain");
		if (ext === ".svg" || TEXT_EXTENSIONS.has(ext)) {
			const bytes = await readPrefix(path, TEXT_PREVIEW_LIMIT);
			return {
				path,
				name: basename(path),
				mimeType,
				size: info.size,
				kind: ext === ".svg" ? "image" : "text",
				...(ext === ".svg" ? { data: bytes.toString("base64") } : { text: bytes.toString("utf-8") }),
				truncated: info.size > bytes.length,
			};
		}
		if (IMAGE_MIME[ext] || ext === ".pdf") {
			if (info.size > BINARY_PREVIEW_LIMIT) {
				return {
					path,
					name: basename(path),
					mimeType,
					size: info.size,
					kind: ext === ".pdf" ? "pdf" : "image",
					truncated: true,
				};
			}
			const bytes = await readPrefix(path, BINARY_PREVIEW_LIMIT);
			return {
				path,
				name: basename(path),
				mimeType,
				size: info.size,
				kind: ext === ".pdf" ? "pdf" : "image",
				data: bytes.toString("base64"),
			};
		}
		return {
			path,
			name: basename(path),
			mimeType: "application/octet-stream",
			size: info.size,
			kind: "binary",
		};
	});
	ipcMain.handle(IpcChannels.ResourceOpenExternal, async (_e, target: string, cwd?: string) => {
		if (typeof target !== "string" || !target) return;
		if (/^[a-z][a-z0-9+.-]*:/i.test(target) && !target.startsWith("file://")) {
			return shell.openExternal(target);
		}
		return shell.openPath(resolveResourcePath(target, cwd));
	});
	ipcMain.handle(IpcChannels.AppGetInfo, () => ({
		name: app.getName(),
		version: app.getVersion(),
		electron: process.versions.electron ?? "",
		chrome: process.versions.chrome ?? "",
		node: process.versions.node ?? "",
		platform: process.platform,
		arch: process.arch,
		repoUrl: REPO_URL,
	}));
	// 日常空间目录下发（懒创建；会话创建由 renderer 走既有 draft/createSession 流程）
	ipcMain.handle(IpcChannels.AppGetDailyDir, () => ensureDailyDir());
	ipcMain.handle(IpcChannels.TabsLoad, () => loadTabs());
	ipcMain.handle(IpcChannels.TabsSave, (_e, tabs: SavedTabs) => saveTabs(tabs));
	ipcMain.handle(IpcChannels.UiStateLoad, () => loadUiState());
	ipcMain.handle(IpcChannels.UiStateSave, (_e, state: Partial<UiState>) => {
		// 主题变更 → 对齐 main 原生主题（themeSource 赋值触发 updated 事件，窗口底色/Windows 按钮覆盖层随之刷新）
		if (state.theme) nativeTheme.themeSource = state.theme;
		return saveUiState(state);
	});
	ipcMain.handle(IpcChannels.BackgroundPick, () => pickBackgroundImage(BrowserWindow.getAllWindows()[0]));
	ipcMain.handle(IpcChannels.UpdateCheck, () => checkForUpdates());
	ipcMain.handle(IpcChannels.UpdateDownload, () => downloadUpdate());
	ipcMain.handle(IpcChannels.UpdateInstall, () => installUpdate());
	ipcMain.handle(IpcChannels.FileSaveDialog, async (_e, defaultName: string, content: string) => {
		const window = BrowserWindow.getAllWindows()[0];
		const options: Electron.SaveDialogOptions = {
			defaultPath: defaultName,
			filters: [{ name: "All Files", extensions: ["*"] }],
		};
		const result = window
			? await dialog.showSaveDialog(window, options)
			: await dialog.showSaveDialog(options);
		if (result.canceled || !result.filePath) return null;
		await writeFile(result.filePath, content, "utf-8");
		return result.filePath;
	});
	ipcMain.handle(IpcChannels.ProjectPickDirectory, async () => {
		const window = BrowserWindow.getAllWindows()[0];
		const options: Electron.OpenDialogOptions = { properties: ["openDirectory", "createDirectory"] };
		const result = window
			? await dialog.showOpenDialog(window, options)
			: await dialog.showOpenDialog(options);
		return result.canceled ? null : result.filePaths[0];
	});
	ipcMain.handle(IpcChannels.ProjectGetGitBranch, (_e, cwd: string) => getGitBranch(cwd));
	ipcMain.handle(IpcChannels.ProjectListGitBranches, (_e, cwd: string) => listGitBranches(cwd));
	ipcMain.handle(IpcChannels.ProjectCheckoutBranch, (_e, cwd: string, branch: string) =>
		checkoutBranch(cwd, branch),
	);
}
