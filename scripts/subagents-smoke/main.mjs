import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { app, BrowserWindow } from "electron";

const root = process.env.DRONE_SUBAGENTS_FIXTURE;
app.setPath("userData", join(root, "profile"));
let window;
const checks = [],
	errors = [];
async function run() {
	try {
		window = new BrowserWindow({
			width: 1280,
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
		const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
		const wait = async (code) => {
			for (let i = 0; i < 160; i++) {
				if (await js(code)) return;
				await sleep(25);
			}
			throw new Error(`UI wait: ${code}`);
		};
		const click = async (selector) => {
			await js(`document.querySelector(${JSON.stringify(selector)}).click()`);
			await sleep(60);
		};
		const typeInto = async (selector, value, proto) => {
			await js(
				`(()=>{const el=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(${proto}.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`,
			);
			await sleep(60);
		};
		const select = async (selector, value) => {
			await js(
				`(()=>{const el=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('change',{bubbles:true}));})()`,
			);
			await sleep(60);
		};
		const shot = async (name) => {
			// 隐藏窗口在 Windows 上可能还没出过帧（capturePage 抛 UnknownVizError）：先无焦点显示再截
			if (!window.isVisible()) {
				window.showInactive();
				await sleep(400);
			}
			// 等两帧 + 退出动画（审批坞 150ms）落定，否则非活动窗口的合成层可能截到上一状态
			await js("new Promise((r)=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
			await sleep(300);
			await writeFile(join(root, "screenshots", name), (await window.webContents.capturePage()).toPNG());
		};
		const badge = () =>
			js(
				"(()=>{const b=Array.from(document.querySelectorAll('.context-panel-tabs button')).find(x=>x.textContent.startsWith('子智能体')||x.textContent.startsWith('Subagents'));const s=b&&b.querySelector('.context-panel-badge');return s?{text:s.textContent,attention:s.classList.contains('attention')}:null})()",
			);
		const cardStatus = (runId) =>
			js(
				`document.querySelector('[data-testid="subagent-run-card"][data-run-id="${runId}"]')?.dataset.status ?? null`,
			);
		await mkdir(join(root, "screenshots"));
		await window.loadFile(join(root, "dist/index.html"));

		// S1/S2 可用列表 + 页签
		await wait("!!document.querySelector('[data-testid=\"subagents-pane\"]')");
		await wait("document.querySelectorAll('[data-testid=\"subagent-agent-row\"]').length===3");
		assert.equal(
			await js(
				'document.querySelector(\'[data-agent="data-checker"] [data-testid="subagent-agent-pick"]\').disabled',
			),
			true,
		);
		assert.equal(
			await js(
				'document.querySelector(\'[data-agent="scout"] [data-testid="subagent-agent-pick"]\').disabled',
			),
			false,
		);
		assert.equal(await js("document.querySelectorAll('.context-panel-tabs button').length"), 5);
		assert.equal(await badge(), null);
		assert.equal(await js("document.querySelectorAll('[data-testid=\"subagent-avatar\"]').length>=3"), true);
		checks.push(
			"panel renders three sources with avatars; untrusted project agent cannot be picked; five tabs, no badge yet",
		);
		await shot("01-available.png");

		// 校验：空表单提交 → 逐行错误 + 按钮置灰
		await click('[data-testid="subagent-dispatch-submit"]');
		await wait("!!document.querySelector('[data-testid=\"subagent-task-error\"]')");
		assert.equal(
			await js("document.querySelector('[data-testid=\"subagent-dispatch-submit\"]').disabled"),
			true,
		);
		checks.push("empty form is rejected per row and the dispatch button greys out");

		// S3 派发单任务：可用列表「派发」→ 填 agent → 任务 → 派发
		await click('[data-agent="scout"] [data-testid="subagent-agent-pick"]');
		await wait("document.querySelector('[data-testid=\"subagent-task-agent\"]').value==='scout'");
		await typeInto(
			'[data-testid="subagent-task-text"]',
			"阅读 docs/ 下与权限相关的文档，列出规则文件字段与评估顺序",
			"HTMLTextAreaElement",
		);
		await select("#subagent-stage", "reading");
		await wait("document.body.textContent.includes('阶段契约会追加在末尾')");
		await click('[data-testid="subagent-dispatch-submit"]');
		await wait("document.querySelectorAll('[data-testid=\"subagent-run-card\"]').length===1");
		const runId = await js("window.__fixture.lastRunId()");
		assert.equal(await cardStatus(runId), "queued");
		assert.equal(
			(await js("window.__fixture.dispatched[0].tasks[0].task")).includes("[Stage contract"),
			true,
		);
		assert.equal(await js("window.__fixture.dispatched[0].followUp"), true);
		await wait("!!document.querySelector('[data-testid=\"subagent-dispatch-line\"]')");
		await wait('!!document.querySelector(\'[data-testid="subagent-run-row"][data-panel-status="queued"]\')');
		checks.push(
			"dispatch from the panel: stage contract appended, followUp on, queued card in panel + dispatch line and run row in chat",
		);
		await shot("02-dispatched.png");

		// 运行中 → 徽标计数
		await js(
			`window.__fixture.advance(${JSON.stringify(runId)}, {status:'running', childSessionId:'c1', sessionFile:'/fixture/sessions-subagents/scout.jsonl', startedAt:Date.now()-42000, statusText:'正在读取 docs/permissions.md', currentTool:'read', tokens:3200, model:'claude-sonnet-4', queuePosition:undefined})`,
		);
		await wait(
			`document.querySelector('[data-testid="subagent-run-card"][data-run-id="${runId}"]').dataset.status==='running'`,
		);
		assert.deepEqual(await badge(), { text: "1", attention: false });
		assert.equal(
			await js(
				'document.querySelector(\'[data-testid="subagent-run-card"] [data-testid="subagent-avatar"]\').dataset.state',
			),
			"running",
		);
		checks.push("running: badge counts the run, avatar scans");

		// S7 等待审批：审批坞来源胶囊 + 查看该运行 + 徽标琥珀
		await js(`window.__fixture.addPermission('perm-1', ${JSON.stringify(runId)})`);
		await wait("!!document.querySelector('[data-testid=\"approval-subagent-source\"]')");
		assert.equal(await cardStatus(runId), "waiting_approval");
		assert.deepEqual(await badge(), { text: "1", attention: true });
		assert.equal(
			await js(
				'document.querySelector(\'[data-testid="approval-subagent-source"] [data-testid="subagent-avatar"]\').dataset.state',
			),
			"waiting",
		);
		await shot("03-waiting-approval.png");
		await js("window.__fixture.setPanelTab('tasks')");
		await wait("!document.querySelector('[data-testid=\"subagents-pane\"]')");
		await click('[data-testid="approval-view-run"]');
		assert.equal(await js("window.__fixture.panelTab()"), "subagents");
		await wait("!!document.querySelector('[data-testid=\"subagents-pane\"]')");
		await wait(
			`document.querySelector('[data-testid="subagent-run-card"][data-run-id="${runId}"]').classList.contains('sa-run-focus')`,
		);
		await js(`window.__fixture.resolvePermission('perm-1', ${JSON.stringify(runId)})`);
		await wait(
			`document.querySelector('[data-testid="subagent-run-card"][data-run-id="${runId}"]').dataset.status==='running'`,
		);
		assert.deepEqual(await badge(), { text: "1", attention: false });
		checks.push(
			"approval attributed to the run: source chip in the dock, amber badge, 'view this run' focuses the card, resolves back to running",
		);

		// 完成 → 结果卡（待进入上下文 → 已进入上下文）→ 引用
		await js(
			`window.__fixture.advance(${JSON.stringify(runId)}, {status:'done', content:'规则文件五组字段：enabled / outside / temporary / autoApproveProjectEdits / tools。评估链：deny 优先 → 临时区 → 工作区边界 → 项目记忆 → ask。', contextState:'pending', endedAt:Date.now(), tokens:9100})`,
		);
		await wait("!!document.querySelector('[data-testid=\"subagent-result-card\"]')");
		assert.equal(
			await js("document.querySelector('[data-testid=\"subagent-result-card\"]').dataset.contextState"),
			"pending",
		);
		assert.equal(await badge(), null);
		await js(`window.__fixture.deliver(${JSON.stringify(runId)})`);
		await wait(
			"document.querySelector('[data-testid=\"subagent-result-card\"]').dataset.contextState==='delivered'",
		);
		assert.equal(await js("document.querySelectorAll('[data-testid=\"subagent-result-card\"]').length"), 1);
		await wait(
			"document.querySelector('[data-testid=\"subagents-runs\"]').textContent.includes('已进入上下文')",
		);
		await click('[data-testid="subagent-result-cite"]');
		assert.equal((await js("window.__fixture.draftText()")).startsWith("> 子智能体 scout 的结果"), true);
		assert.equal(
			(await js("window.__fixture.draftText()")).includes("/fixture/sessions-subagents/scout.jsonl"),
			true,
		);
		checks.push(
			"done: same card becomes the result card, flips to 'in context' on message_end, cite writes a blockquote into the draft",
		);
		await shot("04-result.png");

		// 第二次派发（并行 2 行）→ 取消排队中的一项 → 中止另一项
		await click('[data-agent="lit-reviewer"] [data-testid="subagent-agent-pick"]');
		await wait(
			"document.querySelectorAll('[data-testid=\"subagent-task-row\"]').length===1 && document.querySelector('[data-testid=\"subagent-task-agent\"]').value==='lit-reviewer'",
		);
		await typeInto(
			'[data-testid="subagent-task-text"]',
			"精读 3 篇候选文献并产出证据卡",
			"HTMLTextAreaElement",
		);
		await js(
			"Array.from(document.querySelectorAll('[data-testid=\"subagents-dispatch\"] button')).find(b=>b.textContent.startsWith('+')).click()",
		);
		await wait("document.querySelectorAll('[data-testid=\"subagent-task-row\"]').length===2");
		await select(
			'[data-testid="subagent-task-row"]:nth-of-type(2) [data-testid="subagent-task-agent"]',
			"scout",
		);
		await typeInto(
			'[data-testid="subagent-task-row"]:nth-of-type(2) [data-testid="subagent-task-text"]',
			"枚举仓库内所有 *.nsh 模板",
			"HTMLTextAreaElement",
		);
		await click('[data-testid="subagent-dispatch-submit"]');
		await wait("document.querySelectorAll('[data-testid=\"subagent-run-card\"]').length===3");
		assert.equal(await js("window.__fixture.dispatched[1].tasks.length"), 2);
		const queuedCards = await js(
			'Array.from(document.querySelectorAll(\'[data-testid="subagent-run-card"][data-status="queued"]\')).map(c=>c.dataset.runId)',
		);
		assert.equal(queuedCards.length, 2);
		await click(
			`[data-testid="subagent-run-card"][data-run-id="${queuedCards[1]}"] [data-testid="subagent-run-abort"]`,
		);
		await wait(
			`document.querySelector('[data-testid="subagent-run-card"][data-run-id="${queuedCards[1]}"]').dataset.status==='aborted'`,
		);
		assert.equal(
			await js(
				`document.querySelector('[data-testid="subagent-run-card"][data-run-id="${queuedCards[1]}"]').classList.contains('sa-run-aborted')`,
			),
			true,
		);
		await js(
			`window.__fixture.advance(${JSON.stringify(queuedCards[0])}, {status:'running', childSessionId:'c2', startedAt:Date.now(), queuePosition:undefined})`,
		);
		await wait(
			`document.querySelector('[data-testid="subagent-run-card"][data-run-id="${queuedCards[0]}"]').dataset.status==='running'`,
		);
		await js(
			`window.__fixture.advance(${JSON.stringify(queuedCards[0])}, {status:'error', error:'exit 1 · MCP 服务器 zotero 未连接', endedAt:Date.now()})`,
		);
		await wait(
			`document.querySelector('[data-testid="subagent-run-card"][data-run-id="${queuedCards[0]}"]').dataset.status==='error'`,
		);
		assert.equal(await js("!!document.querySelector('[data-testid=\"subagent-run-retry\"]')"), true);
		assert.equal(
			await js(
				'document.querySelectorAll(\'[data-testid="subagent-run-row"][data-panel-status="aborted"]\').length',
			),
			1,
		);
		assert.equal(await js("window.__fixture.aborted.length"), 1);
		checks.push(
			"parallel dispatch of two tasks; cancel while queued → aborted (neutral); failure shows retry; chat rows mirror the states",
		);
		await shot("05-runs.png");

		// S9 输入框 @ 选择器：消息开头 @ → 子智能体在前、文件在后 → 选中成胶囊 → Enter 直接派发
		const composerInput = '[data-testid="composer-input"]';
		const inputValue = () => js(`document.querySelector(${JSON.stringify(composerInput)}).value`);
		const key = async (name) => {
			await js(
				`document.querySelector(${JSON.stringify(composerInput)}).dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(name)},bubbles:true,cancelable:true}))`,
			);
			await sleep(60);
		};
		await wait(`!!document.querySelector(${JSON.stringify(composerInput)})`);
		await typeInto(composerInput, "@", "HTMLTextAreaElement");
		await wait("!!document.querySelector('[data-testid=\"at-menu-agents-header\"]')");
		assert.equal(await js("document.querySelectorAll('[data-testid=\"at-menu-agent\"]').length"), 3);
		assert.equal(
			await js(
				'document.querySelector(\'[data-testid="at-menu-agent"][data-agent="data-checker"]\').disabled',
			),
			true,
		);
		assert.equal(await js("document.querySelectorAll('[data-testid=\"at-menu-file\"]').length"), 4);
		checks.push(
			"@ at message start lists subagents (avatars; untrusted project agent disabled) ahead of project files",
		);
		await shot("07-at-menu.png");
		await typeInto(composerInput, "@sc", "HTMLTextAreaElement");
		await wait("document.querySelectorAll('[data-testid=\"at-menu-agent\"]').length===1");
		await key("Enter");
		await wait('!!document.querySelector(\'[data-testid="composer-subagent-chip"][data-agent="scout"]\')');
		assert.equal(await inputValue(), "");
		assert.equal(await js("window.__fixture.draftSubagent()"), "scout");
		// 空文本 Backspace：胶囊整枚弹回 `@scout `，菜单不立刻重弹
		await key("Backspace");
		await wait("!document.querySelector('[data-testid=\"composer-subagent-chip\"]')");
		assert.equal(await inputValue(), "@scout ");
		assert.equal(await js("!!document.querySelector('[data-testid=\"at-menu\"]')"), false);
		// 重新选中；胶囊在场时正文里的 / 不弹命令菜单（互斥）
		await typeInto(composerInput, "@scout", "HTMLTextAreaElement");
		await wait("document.querySelectorAll('[data-testid=\"at-menu-agent\"]').length===1");
		await key("Enter");
		await wait('!!document.querySelector(\'[data-testid="composer-subagent-chip"][data-agent="scout"]\')');
		await typeInto(composerInput, "/compact", "HTMLTextAreaElement");
		assert.equal(await js("!!document.querySelector('[data-command-group]')"), false);
		await typeInto(
			composerInput,
			"枚举 docs/ 下与权限相关的文档，给出每份文档的一句话摘要",
			"HTMLTextAreaElement",
		);
		await wait("document.querySelector('[data-testid=\"composer-hint\"]').textContent.includes('派发')");
		assert.equal(
			await js("document.querySelector('[data-testid=\"composer-send\"]').getAttribute('aria-label')"),
			"派发",
		);
		await shot("08-at-chip.png");
		await key("Enter");
		await wait("window.__fixture.dispatched.length===3");
		assert.deepEqual(await js("window.__fixture.dispatched[2]"), {
			tasks: [{ agent: "scout", task: "枚举 docs/ 下与权限相关的文档，给出每份文档的一句话摘要" }],
			followUp: true,
		});
		assert.equal(await js("window.__fixture.prompted.length"), 0);
		await wait("!document.querySelector('[data-testid=\"composer-subagent-chip\"]')");
		assert.equal(await inputValue(), "");
		await wait("document.querySelectorAll('[data-testid=\"subagent-run-card\"]').length===4");
		checks.push(
			"@scout <task> + Enter dispatches one task straight to the backend (no prompt), clears the draft and shows the run",
		);

		// 英文文案
		await js("window.__fixture.setLanguage('en')");
		await wait("document.body.textContent.includes('Dispatch to this session')");
		await wait("document.body.textContent.includes('Runs in this session')");
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
