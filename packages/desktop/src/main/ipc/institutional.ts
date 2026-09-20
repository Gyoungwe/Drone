import type { InstitutionalSaveInput } from "@drone/shared";
import { IpcChannels } from "@drone/shared";
import { BrowserWindow, ipcMain } from "electron";
import * as institutional from "../institutional-access";

export function registerInstitutionalIpc(): void {
	ipcMain.handle(IpcChannels.InstitutionalGetStatus, async () => {
		return institutional.getStatus();
	});

	ipcMain.handle(IpcChannels.InstitutionalSaveConfig, async (_e, input: InstitutionalSaveInput) => {
		// Validate main frame
		if (!BrowserWindow.fromWebContents(_e.sender) || _e.senderFrame !== _e.sender.mainFrame) {
			throw new Error("Institutional config save requires main frame");
		}
		return institutional.saveConfig(input);
	});

	ipcMain.handle(IpcChannels.InstitutionalOpenLogin, async (_e, url?: string) => {
		if (!BrowserWindow.fromWebContents(_e.sender) || _e.senderFrame !== _e.sender.mainFrame) {
			throw new Error("Open login requires main frame");
		}
		return institutional.openInstitutionalLogin(url);
	});

	ipcMain.handle(IpcChannels.InstitutionalOpenUrl, async (_e, url: string) => {
		if (!BrowserWindow.fromWebContents(_e.sender) || _e.senderFrame !== _e.sender.mainFrame) {
			throw new Error("Open URL requires main frame");
		}
		return institutional.openInstitutionalUrl(url);
	});

	ipcMain.handle(IpcChannels.InstitutionalClear, async (_e) => {
		if (!BrowserWindow.fromWebContents(_e.sender) || _e.senderFrame !== _e.sender.mainFrame) {
			throw new Error("Clear requires main frame");
		}
		return institutional.clear();
	});

	ipcMain.handle(IpcChannels.InstitutionalTestAccess, async (_e, url: string) => {
		if (!BrowserWindow.fromWebContents(_e.sender) || _e.senderFrame !== _e.sender.mainFrame) {
			throw new Error("Test requires main frame");
		}
		return institutional.testAccess(url);
	});
}
