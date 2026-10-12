import { HIDDEN_LAUNCH_ARG } from "@drone/shared";
import { app, BrowserWindow, Menu, nativeImage, Tray } from "electron";
import type { DesktopPrefsHost } from "./desktop-prefs";

export const launchedHidden =
	process.argv.includes(HIDDEN_LAUNCH_ARG) ||
	(process.platform === "darwin" && app.getLoginItemSettings().wasOpenedAsHidden);

function showMainWindow(): void {
	const win = BrowserWindow.getAllWindows()[0];
	if (!win) return;
	if (win.isMinimized()) win.restore();
	win.show();
	win.focus();
}

export const electronDesktopHost: DesktopPrefsHost = {
	platform: process.platform,
	launchedHidden,
	setLoginItemSettings: (settings) => app.setLoginItemSettings(settings),
	createTray: () => {
		const tray = new Tray(nativeImage.createEmpty());
		void app
			.getFileIcon(process.execPath, { size: "small" })
			.then((icon) => tray.setImage(icon.resize({ width: 16, height: 16 })))
			.catch(() => tray.setTitle("Drone"));
		tray.setToolTip("Drone");
		tray.setContextMenu(
			Menu.buildFromTemplate([
				{ label: "Drone", click: showMainWindow },
				{ type: "separator" },
				{ role: "quit" },
			]),
		);
		tray.on("click", showMainWindow);
		return tray;
	},
};
