import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { app, BrowserWindow } from "electron";

const root = process.env.DRONE_PERMISSIONS_FIXTURE;
app.setPath("userData", join(root, "profile"));
let window;
const checks = [],
	errors = [];
async function run() {
	try {
		window = new BrowserWindow({
			width: 1000,
			height: 1100,
			show: false,
			webPreferences: {
				contextIsolation: true,
				nodeIntegration: false,
				sandbox: true,
				backgroundThrottling: false,
			},
		});
		window.webContents.on("console-message", (event) => {
			if (event.level === "error") errors.push(event.message);
		});
		const js = (code) => window.webContents.executeJavaScript(code, true);
		const wait = async (code) => {
			for (let i = 0; i < 120; i++) {
				if (await js(code)) return;
				await new Promise((r) => setTimeout(r, 25));
			}
			throw new Error(`UI wait: ${code}`);
		};
		const click = async (selector) => {
			await js(`document.querySelector(${JSON.stringify(selector)}).click()`);
			await new Promise((r) => setTimeout(r, 60));
		};
		const type = async (selector, value) => {
			await js(
				`(()=>{const el=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`,
			);
			await new Promise((r) => setTimeout(r, 60));
		};
		const select = async (selector, value) => {
			await js(
				`(()=>{const el=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('change',{bubbles:true}));})()`,
			);
			await new Promise((r) => setTimeout(r, 60));
		};
		const shot = async (name) => {
			// 隐藏窗口在 Windows 上可能还没出过帧（capturePage 抛 UnknownVizError）：先无焦点显示再截
			if (!window.isVisible()) {
				window.showInactive();
				await new Promise((r) => setTimeout(r, 400));
			}
			await writeFile(join(root, "screenshots", name), (await window.webContents.capturePage()).toPNG());
		};
		const rows = '[data-tool="bash"] [data-testid="pattern-row"]';
		const patterns = () => js(`Array.from(document.querySelectorAll('${rows} input')).map(i=>i.value)`);
		const saveDisabled = () => js("document.querySelector('[data-testid=\"permissions-save\"]').disabled");
		await mkdir(join(root, "screenshots"));
		await window.loadFile(join(root, "dist/index.html"));

		await wait("!!document.querySelector('[data-testid=\"permissions-panel\"]')");
		assert.equal(await js(`document.querySelectorAll('${rows}').length`), 8);
		assert.deepEqual(
			await js(
				`Array.from(document.querySelectorAll('${rows}[data-locked]')).map(li=>li.querySelector('input').value)`,
			),
			["*permissions.json*", "*workspaces.json*", "*auth.json*", "*trust.json*"],
		);
		assert.equal(await js(`document.querySelectorAll('${rows}[data-locked] option[value=allow]').length`), 0);
		assert.equal(await js(`document.querySelectorAll('${rows}[data-locked] [aria-label="删除"]').length`), 0);
		assert.equal(await saveDisabled(), true);
		checks.push(
			"panel renders the effective rules; four locked self-protection rows at the end; save disabled when clean",
		);
		await shot("01-panel.png");

		// 排序：把 sudo * 下移一位 → git push* 在前
		await click(`${rows}:nth-child(2) [aria-label="下移"]`);
		assert.deepEqual((await patterns()).slice(0, 4), ["*", "git push*", "sudo *", "rm -rf *"]);
		// 最后一个普通行不能越过锁定行
		assert.equal(
			await js(`document.querySelector('${rows}:nth-child(4) [aria-label="下移"]').disabled`),
			true,
		);
		assert.equal(await saveDisabled(), false);
		checks.push("rows reorder with ↑↓ and can never cross the locked tail");

		// 添加模式：空模式先拦，填好后可保存；新行插在锁定行之前
		await click("[data-tool='bash'] [data-testid='pattern-add']");
		assert.equal(await saveDisabled(), true);
		assert.equal(
			await js("document.querySelector('[data-testid=\"permissions-status\"]').dataset.state"),
			"invalid",
		);
		await type(`${rows}:nth-child(5) input`, "docker *");
		await select(`${rows}:nth-child(5) select`, "deny");
		assert.equal(await saveDisabled(), false);
		await shot("02-edited.png");
		await click("[data-testid='permissions-save']");
		await wait("window.__fixture.saved.length===1");
		const saved = await js("window.__fixture.saved[0]");
		assert.deepEqual(Object.keys(saved.rules.bash), [
			"*",
			"git push*",
			"sudo *",
			"rm -rf *",
			"docker *",
			"*permissions.json*",
			"*workspaces.json*",
			"*auth.json*",
			"*trust.json*",
		]);
		assert.equal(saved.rules.bash["docker *"], "deny");
		assert.deepEqual(Object.keys(saved.rules), ["*", "bash", "edit", "write"]);
		assert.equal("enabled" in saved, true);
		await wait("document.querySelector('[data-testid=\"permissions-status\"]')?.dataset.state==='saved'");
		checks.push("empty pattern blocks save; serialized order follows the list with self-protection last");

		// 试算：按当前草稿命中 git push*（#2）
		await type("[data-testid='probe-input']", "git status && git push --force origin main");
		await click("[data-testid='probe-run']");
		await wait("!!document.querySelector('[data-testid=\"probe-result\"]')");
		const probeText = await js("document.querySelector('[data-testid=\"probe-result\"]').textContent");
		assert.match(probeText, /#2 git push\* → ask/);
		assert.equal(await js(`document.querySelectorAll('${rows}[data-hit]').length`), 1);
		await shot("03-probe.png");
		checks.push("dry run reports the matched row number, action and highlights the row");

		// 边界选择器 + 自动放行开关写入 outside / autoApproveProjectEdits
		await select("[data-testid='outside-write']", "deny");
		await click("[data-testid='auto-approve']");
		await click("[data-testid='permissions-save']");
		await wait("window.__fixture.saved.length===2");
		const second = await js("window.__fixture.saved[1]");
		assert.equal(second.outside.write, "deny");
		assert.equal(second.autoApproveProjectEdits, false);
		checks.push("boundary selects and the auto-approve switch persist");

		// 冲突：外部修改 → 保存暂停 → 覆盖
		await js("window.__fixture.conflictOnce=true");
		await select("[data-testid='outside-read']", "ask");
		await click("[data-testid='permissions-save']");
		await wait("!!document.querySelector('[data-testid=\"permissions-conflict\"]')");
		assert.equal(await js("window.__fixture.saved.length"), 2);
		await shot("04-conflict.png");
		await js(
			"Array.from(document.querySelectorAll('[data-testid=\"permissions-conflict\"] button')).find(b=>b.textContent==='覆盖').click()",
		);
		await wait("window.__fixture.saved.length===3");
		assert.equal((await js("window.__fixture.saved[2]")).outside.read, "ask");
		checks.push("external modification pauses the save; overwrite writes the draft");

		// 放弃更改回到磁盘状态
		await select("[data-testid='outside-read']", "deny");
		assert.equal(await saveDisabled(), false);
		await click("[data-testid='permissions-discard']");
		assert.equal(await js("document.querySelector('[data-testid=\"outside-read\"]').value"), "ask");
		assert.equal(await saveDisabled(), true);
		checks.push("discard restores the loaded state");

		// 审计折叠展开后加载记录
		await js("document.querySelector('[data-testid=\"permissions-audit\"]').open=true");
		await wait("document.querySelector('[data-testid=\"permissions-audit\"] li')!==null");
		checks.push("audit disclosure loads the tail on open");

		// enabled=false 横幅
		await js("window.__fixture.enabled=false");
		await click("#reload");
		await wait("!!document.querySelector('[data-testid=\"permissions-disabled-banner\"]')");
		await shot("05-disabled-banner.png");
		checks.push("enabled=false shows the banner and nothing else changes");

		// 英文文案
		await click("#lang");
		await wait("document.body.textContent.includes('Permission rules')");
		await shot("06-english.png");
		checks.push("English strings render");

		assert.deepEqual(errors, []);
		await writeFile(join(root, "validation.json"), JSON.stringify({ passed: true, checks }, null, 2));
		console.log(JSON.stringify({ passed: true, checks }, null, 2));
	} catch (error) {
		await writeFile(
			join(root, "validation.json"),
			JSON.stringify(
				{ passed: false, checks, error: String(error?.stack ?? error), consoleErrors: errors },
				null,
				2,
			),
		);
		console.error(error);
		process.exitCode = 1;
	} finally {
		app.quit();
	}
}
app.whenReady().then(run);
