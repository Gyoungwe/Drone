import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { app, BrowserWindow, ipcMain } from "electron";
import { registerAppIpc } from "../../packages/desktop/src/main/ipc/app.ts";
import { IpcChannels } from "../../packages/shared/src/ipc.ts";
import { verifyResourceReaders } from "./resource-checks.mjs";
import { verifyScriptReaders } from "./script-checks.mjs";

const root = process.env.DRONE_UI_FIXTURE;
app.setPath("userData", join(root, "electron-profile"));
app.setName("Drone Isolated Delivery Test");
app.disableHardwareAcceleration();
let window;
const errors = [];
const checks = [];
const networkRequests = [];
const securityBlocks = [];
async function run() {
	try {
		await mkdir(join(root, "project"));
		const cwd = join(root, "project"),
			path = join(cwd, "报告 (1)#100%.csv");
		await writeFile(path, "sample,value\nfixture,1\n");
		registerAppIpc({});
		let prompts = 0;
		ipcMain.handle(IpcChannels.SessionPrompt, () => {
			prompts++;
			return { kind: "command" };
		});
		window = new BrowserWindow({
			show: true,
			width: 1120,
			height: 780,
			webPreferences: { preload: join(root, "preload.cjs"), contextIsolation: true, nodeIntegration: false },
		});
		window.webContents.on("console-message", (_e, level, message) => {
			if (level >= 3) {
				if (/Content Security Policy|frame is sandboxed/.test(message)) securityBlocks.push(message);
				else errors.push(message);
			}
		});
		window.webContents.session.webRequest.onBeforeRequest(
			{ urls: ["http://*/*", "https://*/*"] },
			(details, callback) => {
				networkRequests.push(details.url);
				callback({ cancel: true });
			},
		);
		await window.loadFile(join(root, "dist/index.html"));
		const js = (s) => window.webContents.executeJavaScript(s);
		const wait = async (s) => {
			for (let i = 0; i < 100; i++) {
				if (await js(s)) return;
				await new Promise((r) => setTimeout(r, 50));
			}
			throw Error(`UI condition timed out: ${s}`);
		};
		await wait("!!window.deliveryFixture");
		const task = {
			id: "delivery",
			goal: "生成文件并交付",
			state: "partial",
			reason: null,
			stage: 2,
			updatedAt: new Date().toISOString(),
			budget: { calls: 36, stageCalls: 27 },
			capabilities: [],
			waitMs: 0,
			authorizationRequired: true,
			executionConsent: {
				version: 1,
				contractHash: "fixture",
				approvedAt: new Date().toISOString(),
				maxCalls: 192,
				maxAutoResumes: 3,
			},
			planApproved: true,
			milestones: [],
			actions: [],
			operations: Array.from({ length: 28 }, (_, i) => ({
				id: `op-${i}`,
				tool: i === 27 ? "write" : "bash",
				state: i === 27 ? "verified" : "returned",
				at: new Date().toISOString(),
				...(i === 27 ? { artifact: { path, bytes: 23, sha256: "a".repeat(64) } } : {}),
			})),
		};
		const view = {
			version: 2,
			revision: 1,
			activeTaskId: "delivery",
			selectionRequired: false,
			tasks: [task],
			limits: { stageCalls: 48, totalCalls: 192 },
		};
		const views = Array.from({ length: 12 }, (_, i) => ({ ...view, revision: i + 1 }));
		await js(`window.deliveryFixture.show(${JSON.stringify(views)},${JSON.stringify(cwd)});true`);
		await wait("!!document.querySelector('[data-testid=task-artifacts] a')");
		assert.equal(
			await js(
				"[...document.querySelectorAll('[data-testid=task-workbench]')].filter(e=>e.getBoundingClientRect().height>0).length",
			),
			1,
		);
		assert(
			await js("document.querySelector('[data-testid=task-workbench]').getBoundingClientRect().height<220"),
		);
		assert(await js("document.querySelector('#conversation').innerText.includes('已授权')"));
		assert(!(await js("document.querySelector('#conversation').innerText.includes('需要你授权')")));
		checks.push("12 snapshots collapse to one short authorized summary; no repeated authorization prompt");
		await js("document.querySelector('[data-testid=task-artifacts] a').click();true");
		await wait("document.querySelector('[data-testid=resource-table] tbody')?.innerText.includes('fixture')");
		checks.push("actual preload FilePreview IPC opens Windows/CJK/space/#/percent filename in the sidebar");
		try {
			await window.webContents
				.capturePage()
				.then((image) => writeFile(join(root, "delivery-preview.png"), image.toPNG()));
		} catch {
			console.warn(
				"Screenshot unavailable in this desktop environment; continuing strict UI/IPC assertions.",
			);
		}

		await js("window.deliveryFixture.clearPreview();true");
		await wait("!document.querySelector('#artifact-preview')");
		await wait("!!document.querySelector('#conversation .markdown-body a[href]')");
		await js("document.querySelector('#conversation .markdown-body a[href]').click();true");
		await wait("document.querySelector('[data-testid=resource-table] tbody')?.innerText.includes('fixture')");
		checks.push("artifact hyperlink in the actual assistant Markdown answer opens the same file sidebar");
		// Raw Windows drive paths also route locally, not to shell.openExternal.
		assert.equal(
			await js(
				`window.deliveryFixture.preview(${JSON.stringify(path)},${JSON.stringify(cwd)}).then(r=>r.kind)`,
			),
			"text",
		);
		checks.push("raw absolute Windows path is accepted by the production IPC handler");
		task.state = "waiting_user";
		task.actions = [
			{
				id: "file",
				kind: "file",
				state: "pending",
				title: "请核对下载文件",
				reason: "文件待核对，不是重新授权",
				expected: {},
			},
		];
		await js(
			`window.deliveryFixture.show(${JSON.stringify([{ ...view, revision: 13 }])},${JSON.stringify(cwd)});true`,
		);
		await wait("document.querySelector('#conversation').innerText.includes('请核对下载文件')");
		assert(await js("!!document.querySelector('[data-testid=task-user-action] input')"));
		assert.equal(prompts, 0);
		checks.push(
			"pending human action remains visible; rendering/preview never grants consent or resumes a model",
		);
		await verifyResourceReaders({ window, js, wait, cwd, root, checks, networkRequests });
		await verifyScriptReaders({ js, wait, cwd, checks });
		assert.equal(prompts, 0);
		assert.deepEqual(networkRequests, []);
		assert.deepEqual(errors, []);
		await writeFile(
			join(root, "validation.json"),
			JSON.stringify({ passed: true, checks, errors, networkRequests, securityBlocks }, null, 2),
		);
		console.log(JSON.stringify({ passed: true, checks, root }));
		window.destroy();
		app.quit();
	} catch (e) {
		console.error(e.stack);
		if (window)
			await window.webContents
				.capturePage()
				.then((image) => writeFile(join(root, "failure.png"), image.toPNG()));
		app.exit(1);
	}
}
app.whenReady().then(run);
