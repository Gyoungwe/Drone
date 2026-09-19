import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { app, BrowserWindow } from "electron";

const root = process.env.DRONE_CATALOG_FIXTURE;
app.setPath("userData", join(root, "profile"));
let window;
const checks = [],
	errors = [];
async function run() {
	try {
		window = new BrowserWindow({
			width: 1100,
			height: 900,
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
			for (let i = 0; i < 80; i++) {
				if (await js(code)) return;
				await new Promise((r) => setTimeout(r, 25));
			}
			throw new Error(`UI wait: ${code}`);
		};
		const type = async (selector, value) => {
			await js(
				`(()=>{const el=document.querySelector(${JSON.stringify(selector)});const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(value)});el.focus();el.setSelectionRange(el.value.length,el.value.length);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('select',{bubbles:true}));})()`,
			);
			await new Promise((r) => setTimeout(r, 75));
		};
		await window.loadFile(join(root, "dist/index.html"));

		const click = async (selector) => {
			await js(`document.querySelector(${JSON.stringify(selector)}).click()`);
			await new Promise((r) => setTimeout(r, 80));
		};
		const key = async (keyCode) => {
			window.webContents.sendInputEvent({ type: "keyDown", keyCode });
			window.webContents.sendInputEvent({ type: "keyUp", keyCode });
			await new Promise((r) => setTimeout(r, 80));
		};
		const reset = async () => {
			await click("#reset");
			await type("#command-input", "/");
		};
		await wait("document.querySelectorAll('#skill-panel [data-workflow-direction]').length===6");
		assert.equal(await js("document.querySelectorAll('#skill-panel li').length"), 0);
		checks.push("settings default is six directions, not a flat inventory");
		await type("#command-input", "/");
		await wait("document.querySelectorAll('[data-command^=\"workflow:\"]').length===6");
		assert.equal(await js("!!document.querySelector('[data-command=\"skill:nature-writing\"]')"), false);
		assert.equal(await js("!!document.querySelector('[data-command=\"skill:user-local-tool\"]')"), true);
		checks.push("six slash directions; original managed skills folded; unrelated user skills preserved");
		await mkdir(join(root, "screenshots"));
		await writeFile(
			join(root, "screenshots/01-six-directions.png"),
			(await window.webContents.capturePage()).toPNG(),
		);
		await click('[data-command="workflow:analysis"]');
		await wait("!!document.querySelector('[data-command=\"skill:statistical-analysis\"]')");
		assert.equal(await js("document.querySelector('#selected-command').textContent"), "");
		await js("document.querySelector('#command-input').focus()");
		await key("Down");
		await key("Tab");
		await wait("document.querySelector('#selected-command').textContent==='skill:statistical-analysis'");
		checks.push(
			"mouse navigation plus real ArrowDown/Tab chooses the correct native stage, never a fake command",
		);
		await reset();
		await click('[data-command="workflow:writing"]');
		await wait("!!document.querySelector('[data-command=\"ars-reviewer\"]')");
		await click('[data-command="ars-reviewer"]');
		await wait("document.querySelector('#selected-command').textContent==='ars-reviewer'");
		checks.push("ARS five-seat stage preserves the actual upstream command");
		await reset();
		await js("document.querySelector('#command-input').focus()");
		await key("Tab");
		await wait("!!document.querySelector('[data-command=\"skill:hypothesis-generation\"]')");
		await key("Escape");
		await wait("document.querySelectorAll('[data-command^=\"workflow:\"]').length===6");
		await key("Enter");
		await key("Tab");
		await wait("document.querySelector('#selected-command').textContent==='skill:hypothesis-generation'");
		checks.push("keyboard-only direction entry, Escape-back and stage selection agree with rendered indices");
		await click("#missing");
		await type("#command-input", "/");
		await wait("!!document.querySelector('[data-command=\"workflow:writing\"]')");
		await click('[data-command="workflow:writing"]');
		await wait("!!document.querySelector('[data-command=\"unavailable:blindReview\"]')");
		assert.equal(
			await js("document.querySelector('[data-command=\"unavailable:blindReview\"]').disabled"),
			true,
		);
		await click('[data-command="unavailable:blindReview"]');
		assert.equal(await js("document.querySelector('#selected-command').textContent"), "");
		checks.push("a missing blind-review contract is disabled, never replaced by ordinary review");
		await reset();
		await js(
			"[...document.querySelectorAll('#command-menu button')].find(b=>b.innerText.includes('高级')).click()",
		);
		await wait("!!document.querySelector('[data-command=\"skill:nature-shared\"]')");
		checks.push("advanced view retains internal names and all registered originals");
		await type("#command-input", "/skill:anndata");
		await wait("document.querySelectorAll('[data-command]').length===1");
		assert.equal(await js("document.querySelector('[data-command]').dataset.command"), "skill:anndata");
		checks.push("exact native search still works independently of navigation state");
		await js(
			"[...document.querySelectorAll('#skill-panel button')].find(b=>b.innerText.startsWith('高级')).click()",
		);
		await wait("!!document.querySelector('#skill-panel input')");
		await type("#skill-panel input", "提交前");
		await wait("document.querySelectorAll('#skill-panel li').length===1");
		assert((await js("document.querySelector('#skill-panel li').innerText")).includes("setup-pre-commit"));
		checks.push("advanced Chinese search preserves unrelated engineering setup skills");
		await js(
			"[...document.querySelectorAll('#skill-panel button')].find(b=>b.innerText==='返回六方向浏览').click()",
		);
		await click("#lang");
		await js("document.documentElement.setAttribute('data-theme','dark')");
		window.setSize(640, 900);
		await wait("document.querySelector('#skill-panel').innerText.includes('Six workflow directions')");
		assert(await js("document.documentElement.scrollWidth<=innerWidth"));
		await writeFile(
			join(root, "screenshots/02-dark-narrow.png"),
			(await window.webContents.capturePage()).toPNG(),
		);
		checks.push("English/dark/narrow layout has no horizontal overflow");
		await click("#empty");
		await type("#command-input", "/");
		await wait("document.querySelectorAll('[data-command]').length===0");
		assert.equal(await js("window.__executions"), 0);
		checks.push("session change clears stale SDK availability; browsing made zero command/model calls");
		assert.equal(errors.length, 0);
		await writeFile(
			join(root, "validation.json"),
			JSON.stringify(
				{
					passed: true,
					checks,
					consoleErrors: errors,
					modelCalled: false,
					realUserVaultModified: false,
					root,
				},
				null,
				2,
			),
		);
		console.log(JSON.stringify({ passed: true, checks, root }));
		window.destroy();
		app.exit(0);
	} catch (error) {
		console.error(error.stack);
		try {
			await writeFile(
				join(root, "failure.json"),
				JSON.stringify({ error: String(error), checks, errors }, null, 2),
			);
			if (window)
				await writeFile(join(root, "failure.png"), (await window.webContents.capturePage()).toPNG());
		} catch {}
		app.exit(1);
	}
}
app.whenReady().then(run);
