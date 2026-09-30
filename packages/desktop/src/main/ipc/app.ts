import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PiBackend } from "@drone/backend";
import type { SavedTabs, UiState } from "@drone/shared";
import { AppContract, IpcChannels, isLocalResourceTarget } from "@drone/shared";
import { app, BrowserWindow, dialog, nativeTheme, shell } from "electron";
import { pickBackgroundImage } from "../background";
import { ensureDailyDir } from "../daily";
import { previewLocalFile, resolveResourcePath } from "../file-preview";
import { checkoutBranch, getGitBranch, listGitBranches } from "../git";
import { loadTabs, saveTabs } from "../tabs";
import { loadUiState, saveUiState } from "../ui-state";
import { checkForUpdates, downloadUpdate, installUpdate } from "../updater";
import { bindContract, type ContractImplementation } from "./bind-contract";
import { materializeSaveContent } from "./save-content";

/** 项目仓库地址（帮助跳转 + 关于页） */
const REPO_URL = "https://github.com/Gyoungwe/Drone";

async function readRecentLogTail(): Promise<string[]> {
	try {
		const dir = join(app.getPath("userData"), "logs");
		const files = (await readdir(dir)).filter((name) => /^main-\d{4}-\d{2}-\d{2}\.log$/.test(name)).sort();
		const latest = files.at(-1);
		if (!latest) return [];
		const content = await readFile(join(dir, latest), "utf8");
		return content.split(/\r?\n/).filter(Boolean).slice(-100);
	} catch {
		return [];
	}
}

/**
 * 应用域：窗口级功能（不依赖 PiBackend 会话状态的部分也在此，backend 参数仅为对齐签名）。
 * tabs/ui-state 持久化、背景图、更新、文件/目录对话框、git 分支、外链与应用信息。
 */
export function registerAppIpc(backend: PiBackend, getIncidentSnapshot?: () => unknown): void {
	const implementation: ContractImplementation<typeof AppContract> = {
		getInfo: () => ({
			name: app.getName(),
			version: app.getVersion(),
			electron: process.versions.electron ?? "",
			chrome: process.versions.chrome ?? "",
			node: process.versions.node ?? "",
			platform: process.platform,
			arch: process.arch,
			repoUrl: REPO_URL,
		}),
		getDiagnostics: async () =>
			backend.getDiagnostics({
				version: app.getVersion(),
				incidentSnapshot: getIncidentSnapshot?.(),
				logTail: await readRecentLogTail(),
			}),
		getDailyDir: () => ensureDailyDir(),
		openExternal: (url) => {
			if (typeof url === "string" && /^https?:\/\//.test(url)) return shell.openExternal(url);
		},
		filePreview: (...args) => previewLocalFile(args[0], args[1]),
		resourceOpenExternal: async (...args) => {
			const [target, cwd] = args;
			if (typeof target !== "string" || !target) return;
			if (!isLocalResourceTarget(target)) {
				if (!/^(?:https?|mailto|zotero|obsidian):/i.test(target))
					throw new Error("Unsupported external resource protocol");
				await shell.openExternal(target);
				return;
			}
			await shell.openPath(resolveResourcePath(target, cwd));
		},
		loadTabs: () => loadTabs(),
		saveTabs: (tabs) => saveTabs(tabs as SavedTabs),
		loadUiState: () => loadUiState(),
		saveUiState: (state) => {
			if (state.theme) nativeTheme.themeSource = state.theme;
			return saveUiState(state as Partial<UiState>);
		},
		pickBackgroundImage: () => pickBackgroundImage(BrowserWindow.getAllWindows()[0]),
		checkForUpdates: () => checkForUpdates(),
		downloadUpdate: () => downloadUpdate(),
		installUpdate: () => installUpdate(),
		saveFileDialog: async (defaultName, content) => {
			const window = BrowserWindow.getAllWindows()[0];
			const options: Electron.SaveDialogOptions = {
				defaultPath: defaultName,
				filters: [{ name: "All Files", extensions: ["*"] }],
			};
			const result = window
				? await dialog.showSaveDialog(window, options)
				: await dialog.showSaveDialog(options);
			if (result.canceled || !result.filePath) return null;
			const materialized = await materializeSaveContent(content);
			if (typeof materialized === "string") await writeFile(result.filePath, materialized, "utf-8");
			else await writeFile(result.filePath, materialized);
			return result.filePath;
		},
		pickPath: async (...args) => {
			const [kind, defaultPath] = args;
			const window = BrowserWindow.getAllWindows()[0];
			const options: Electron.OpenDialogOptions = {
				properties: kind === "directory" ? ["openDirectory"] : ["openFile"],
				...(defaultPath ? { defaultPath } : {}),
			};
			const result = window
				? await dialog.showOpenDialog(window, options)
				: await dialog.showOpenDialog(options);
			return result.canceled ? null : (result.filePaths[0] ?? null);
		},
		pickDirectory: async () => {
			const window = BrowserWindow.getAllWindows()[0];
			const result = window
				? await dialog.showOpenDialog(window, { properties: ["openDirectory", "createDirectory"] })
				: await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
			return result.canceled ? null : (result.filePaths[0] ?? null);
		},
		getGitBranch: (cwd) => getGitBranch(cwd),
		listGitBranches: (cwd) => listGitBranches(cwd),
		checkoutBranch: (cwd, branch) => checkoutBranch(cwd, branch),
	};
	bindContract(AppContract, implementation, {
		channelForMethod: (_contract, method) =>
			({
				getInfo: IpcChannels.AppGetInfo,
				getDiagnostics: IpcChannels.AppGetDiagnostics,
				getDailyDir: IpcChannels.AppGetDailyDir,
				openExternal: IpcChannels.AppOpenExternal,
				filePreview: IpcChannels.FilePreview,
				resourceOpenExternal: IpcChannels.ResourceOpenExternal,
				loadTabs: IpcChannels.TabsLoad,
				saveTabs: IpcChannels.TabsSave,
				loadUiState: IpcChannels.UiStateLoad,
				saveUiState: IpcChannels.UiStateSave,
				pickBackgroundImage: IpcChannels.BackgroundPick,
				checkForUpdates: IpcChannels.UpdateCheck,
				downloadUpdate: IpcChannels.UpdateDownload,
				installUpdate: IpcChannels.UpdateInstall,
				saveFileDialog: IpcChannels.FileSaveDialog,
				pickPath: IpcChannels.FilePickPath,
				pickDirectory: IpcChannels.ProjectPickDirectory,
				getGitBranch: IpcChannels.ProjectGetGitBranch,
				listGitBranches: IpcChannels.ProjectListGitBranches,
				checkoutBranch: IpcChannels.ProjectCheckoutBranch,
			})[method as keyof typeof AppContract.methods],
	});
}
