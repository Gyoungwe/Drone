const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1280, height: 900, backgroundColor: "#f6f7f9", webPreferences: { sandbox: true } });
  await win.loadFile(path.join(__dirname, "compact-chat-v2.html"));
  await new Promise((resolve) => setTimeout(resolve, 180));
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: 1280, height: 900 });
  fs.writeFileSync(path.join(__dirname, "compact-chat-v2.png"), image.toPNG());
  win.destroy();
  app.quit();
});
