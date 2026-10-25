import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { app, BrowserWindow, ipcMain } from "electron";
import { IpcChannels } from "../../packages/shared/src/ipc.ts";

const root = process.env.DRONE_UI_FIXTURE;
app.setPath("userData", join(root, "electron-profile"));
app.setName("Drone knowledge host mount fixture");
const cwd = join(root, "project"),
	vault = join(root, "Synthetic Vault");
const checks = [],
	errors = [],
	opens = [];
let window;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
app
	.whenReady()
	.then(async () => {
		await mkdir(cwd);
		await mkdir(vault);
		app.dock?.hide();
		ipcMain.handle("knowledge-fixture:info", () => ({ cwd }));
		ipcMain.handle(IpcChannels.KnowledgeOverview, () => ({ binding: { vault, revision: 1 } }));
		ipcMain.handle(IpcChannels.KnowledgeOpen, (_event, input) => {
			opens.push(input);
		});
		ipcMain.handle(IpcChannels.UiStateSave, () => {});
		window = new BrowserWindow({
			width: 1000,
			height: 700,
			show: false,
			webPreferences: {
				preload: join(root, "preload.cjs"),
				contextIsolation: true,
				nodeIntegration: false,
				sandbox: false,
				offscreen: true,
				backgroundThrottling: false,
			},
		});
		window.webContents.on("console-message", (event) => {
			if (event.level === "error") errors.push(event.message);
		});
		const js = (code) => window.webContents.executeJavaScript(code, true);
		const wait = async (expression) => {
			for (let i = 0; i < 100; i++) {
				if (await js(`Boolean(${expression})`)) return;
				await pause(40);
			}
			throw new Error(`Host fixture timeout: ${expression}`);
		};
		await window.loadFile(join(root, "dist/index.html"));
		await wait(
			`document.querySelector('[data-testid=knowledge-default-fallback]')?.textContent.includes(${JSON.stringify(vault)})`,
		);
		checks.push("empty plugin registry renders persisted binding through the real preload IPC");
		await js(
			"[...document.querySelectorAll('button')].find(button=>button.textContent.includes('打开知识库文件夹')).click()",
		);
		await wait("true");
		await pause(30);
		assert.deepEqual(opens, [{ cwd, revision: 1 }]);
		await js(
			"[...document.querySelectorAll('button')].find(button=>button.textContent.includes('管理界面插件')).click()",
		);
		assert.deepEqual(await js("window.knowledgeMountFixture.settings()"), {
			view: "skills",
			capabilityDrawer: "uiPlugins",
		});
		checks.push("fallback folder and plugin-management actions retain their host behavior");
		await js("window.knowledgeMountFixture.install()");
		await wait(
			"document.querySelector('[data-testid=fixture-plugin-page]')&&!document.querySelector('[data-testid=knowledge-default-fallback]')",
		);
		await js("window.knowledgeMountFixture.master(false)");
		await wait("document.querySelector('[data-testid=knowledge-default-fallback]')");
		await js("window.knowledgeMountFixture.master(true)");
		await wait("document.querySelector('[data-testid=fixture-plugin-page]')");
		await js("window.knowledgeMountFixture.remove()");
		await wait("document.querySelector('[data-testid=knowledge-default-fallback]')");
		checks.push("generic contribution mount, master disable/restore, and removal return to host fallback");
		assert.deepEqual(errors, []);
		await js("window.knowledgeMountFixture.install(true)");
		await wait("document.querySelector('[data-testid=knowledge-default-fallback]')");
		assert(errors.some((error) => error.includes("intentional fixture render failure")));
		assert(
			errors.every(
				(error) =>
					error.includes("intentional fixture render failure") ||
					error.includes("[ui-plugins] 插件 host-mount-fixture"),
			),
			"only the deliberate fixture crash may be logged",
		);
		await js("window.knowledgeMountFixture.install()");
		await wait("document.querySelector('[data-testid=fixture-plugin-page]')");
		checks.push("render failure stays inside the host boundary and a replacement contribution recovers");
		await writeFile(join(root, "host-mount.png"), (await window.webContents.capturePage()).toPNG());
		await writeFile(
			join(root, "validation.json"),
			JSON.stringify(
				{
					passed: true,
					scope: "host-mount-fallback-fixture",
					formalGuiAcceptance: false,
					optionalUiPackageInstalled: false,
					realElectron: true,
					checks,
					expectedCrashObserved: true,
				},
				null,
				2,
			),
		);
		console.log(JSON.stringify({ passed: true, scope: "host-mount-fallback-fixture", checks, root }));
		window.destroy();
		app.quit();
	})
	.catch(async (error) => {
		console.error(error);
		await writeFile(
			join(root, "failure.json"),
			JSON.stringify({ error: String(error), checks, errors }, null, 2),
		);
		app.exit(1);
	});
