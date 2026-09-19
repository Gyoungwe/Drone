const { app, BrowserWindow } = require("electron");
const path = require("node:path");

app.whenReady().then(async () => {
	const win = new BrowserWindow({
		show: false,
		width: 1360,
		height: 900,
		backgroundColor: "#f7f8fa",
		webPreferences: { sandbox: true },
	});
	await win.loadFile(path.join(__dirname, "compact-workbench-preview.html"));
	await new Promise((resolve) => setTimeout(resolve, 250));
	const image = await win.webContents.capturePage({ x: 0, y: 0, width: 1360, height: 900 });
	image.toPNG().toString("base64");
	require("node:fs").writeFileSync(path.join(__dirname, "compact-workbench-preview.png"), image.toPNG());
	await win.destroy();
	app.quit();
});
