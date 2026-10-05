import { createServer } from "node:http";
import { runScenario } from "./common.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function startErrorServer(status) {
	let requests = 0;
	const server = createServer((_req, res) => {
		requests++;
		res.writeHead(status, { "content-type": "application/json" });
		res.end(
			JSON.stringify({
				error: { message: status === 401 ? "Unauthorized test response" : "Rate limit test response" },
			}),
		);
	});
	return new Promise((resolve) =>
		server.listen(0, "127.0.0.1", () =>
			resolve({
				server,
				port: server.address().port,
				get requests() {
					return requests;
				},
			}),
		),
	);
}

async function providerEdit(page, baseUrl) {
	await page.clickText("设置", { exact: true });
	await page.clickTextWithin('[data-testid="settings-dialog"]', "模型", { exact: true });
	const clicked = await page.eval(
		"(() => { const root=document.querySelector('[data-testid=\"settings-dialog\"]'); const row=[...root.querySelectorAll('li')].find(n=>/DeepSeek/i.test(n.textContent||'')); const button=[...(row?.querySelectorAll('button[aria-label]')||[])].find(n=>/配置|编辑|endpoint|base/i.test(n.getAttribute('aria-label')||'')); button?.click(); return Boolean(button); })()",
	);
	await page.settle();
	const inputReady = await page.eval(
		"(() => { const root=document.querySelector('[data-testid=\"settings-dialog\"]'); const row=[...root.querySelectorAll('li')].find(n=>/DeepSeek/i.test(n.textContent||'')); const input=row?.querySelector('input:not([type=\"password\"])'); if(!input)return false; input.focus(); input.select(); return true; })()",
	);
	if (inputReady) await page.send("Input.insertText", { text: baseUrl });
	const inputId = inputReady ? "scoped DeepSeek baseUrl input" : null;
	const filled = inputReady;
	const saved = await page.clickRegexWithin('[data-testid="settings-dialog"]', "保存|Save");
	await page.settle();
	return { clicked, inputId, filled, saved };
}

async function restoreProvider(page) {
	const restored = await providerEdit(page, "");
	await page.clickSelector('[data-testid="settings-dialog"] button[aria-label]');
	return restored;
}

async function runPseudoError(page, result, status) {
	const fixture = await startErrorServer(status);
	try {
		const configured = await providerEdit(page, `http://127.0.0.1:${fixture.port}/v1`);
		await page.clickSelector('[data-testid="settings-dialog"] button[aria-label]');
		await page.clickSelector('button[aria-label="新建会话"]');
		const pickerOpened = await page.eval(
			"(() => { const button=document.querySelector('.composer-model-group > div > button'); button?.click(); return Boolean(button); })()",
		);
		const selected = await page.eval(
			"(() => { const button=[...document.querySelectorAll('.composer-model-group button')].find(n=>/DeepSeek|deepseek/i.test(n.textContent||'')); button?.click(); return button?.textContent.trim() || null; })()",
		);
		const filled = await page.fill(
			'[data-testid="composer-input"]',
			"伪 provider 错误事件测试：只发送一次短请求，不要调用工具。",
		);
		const sent = await page.clickSelector('[data-testid="composer-send"]');
		const startedRun = await page.waitForRunStart(60_000);
		result.interactions.inputs++;
		result.interactions.clicks++;
		const started = Date.now();
		while (Date.now() - started < 45_000) {
			await page.handleDialogs();
			if (startedRun && (await page.waitForIdle(1_000))) break;
			await sleep(500);
		}
		const evidence = await page.eval(
			"(() => { const cards=[...document.querySelectorAll('.error-note')]; const details=[...document.querySelectorAll('.error-note-detail')].map(n=>n.textContent.trim()); return {cards:cards.length,details,alerts:document.querySelectorAll('[role=\"alert\"]').length}; })()",
		);
		const restored = await restoreProvider(page);
		return {
			status,
			configured,
			pickerOpened,
			selected,
			filled,
			sent,
			startedRun,
			evidence,
			requestCount: fixture.requests,
			restored,
			ok: Boolean(
				configured.filled &&
					pickerOpened &&
					selected &&
					sent &&
					startedRun &&
					fixture.requests > 0 &&
					evidence.cards > 0 &&
					evidence.details.some((text) => text.includes(String(status))) &&
					restored.filled,
			),
		};
	} finally {
		fixture.server.close();
	}
}

await runScenario("p5", async (page, result, step) => {
	result.interactions = { clicks: 0, inputs: 0, confirmations: 0, postAuthorizationInterruptions: 0 };

	await step("permissions-edit-probe-save-hit", async () => {
		await page.clickText("设置", { exact: true });
		const tab = await page.clickTextWithin('[data-testid="settings-dialog"]', "权限", { exact: true });
		const panel = await page.waitForSelector('[data-testid="permissions-panel"]', 10_000);
		const rule = await page.eval(
			'document.querySelector(\'[data-testid="pattern-table"][data-tool="bash"] select\')?.value || null',
		);
		const ruleSelector = '[data-testid="pattern-table"][data-tool="bash"] select';
		const nextRule = rule === "allow" ? "deny" : "allow";
		const changed = rule ? await page.setSelect(ruleSelector, nextRule) : null;
		const probe = await page.fill('[data-testid="probe-input"]', "bash -lc 'printf drone-sim'");
		const probed = await page.clickSelector('[data-testid="probe-run"]');
		const probeResult = await page.waitForSelector('[data-testid="probe-result"]', 5_000);
		const saved = await page.clickSelector('[data-testid="permissions-save"]');
		const savedStatus = await page.waitForSelector(
			'[data-testid="permissions-status"][data-state="saved"]',
			5_000,
		);
		return {
			ok: Boolean(
				tab &&
					panel &&
					rule &&
					changed?.value === nextRule &&
					probe &&
					probed &&
					probeResult &&
					saved &&
					savedStatus,
			),
			selectors: [
				'[data-testid="pattern-table"][data-tool="bash"] select',
				'[data-testid="probe-input"]',
				'[data-testid="probe-run"]',
				'[data-testid="probe-result"]',
				'[data-testid="permissions-save"]',
				'[data-testid="permissions-status"][data-state="saved"]',
			],
			tab,
			panel,
			rule,
			nextRule,
			changed,
			probe,
			probed,
			probeResult,
			saved,
			savedStatus,
		};
	});

	await step("self-protection-rule-cannot-delete", async () => {
		const evidence = await page.eval(
			"(() => { const rows=[...document.querySelectorAll('[data-testid=\"permissions-rules\"] [data-testid=\"pattern-row\"]')]; const locked=rows.filter(n=>n.getAttribute('data-locked')==='true'); return {rows:rows.length,locked:locked.length,lockedRemoveButtons:locked.reduce((sum,n)=>sum+n.querySelectorAll('button').length,0),lockedInputs:locked.filter(n=>n.querySelector('input:disabled')).length}; })()",
		);
		return {
			ok: Boolean(
				evidence.locked > 0 &&
					evidence.lockedRemoveButtons === 0 &&
					evidence.lockedInputs === evidence.locked,
			),
			selectors: [
				'[data-testid="permissions-rules"] [data-testid="pattern-row"][data-locked="true"]',
				'[data-testid="pattern-row"][data-locked="true"] input:disabled',
			],
			evidence,
		};
	});

	await step("cancel-generation-and-error-card", async () => {
		await page.clickSelector('[data-testid="settings-dialog"] button[aria-label]');
		await page.clickSelector('button[aria-label="新建会话"]');
		const filled = await page.fill(
			'[data-testid="composer-input"]',
			"开始一个长回答，但我会立刻取消；不要调用工具。",
		);
		const sent = await page.clickSelector('[data-testid="composer-send"]');
		const startedRun = await page.waitForRunStart(60_000);
		const appeared = await page.waitForSelector(
			'button[aria-label="停止"],button[aria-label="Stop"]',
			10_000,
		);
		const stopped =
			(await page.clickSelector('button[aria-label="停止"]')) ||
			(await page.clickSelector('button[aria-label="Stop"]'));
		const errorCards = await page.visibleCount(".error-note");
		return {
			ok: Boolean(filled && sent && startedRun && appeared && stopped),
			selectors: ['[data-testid="composer-send"]', 'button[aria-label="停止"]', ".error-note"],
			filled,
			sent,
			startedRun,
			appeared,
			stopped,
			errorCards,
		};
	});

	await step("pseudo-provider-401-and-429", async () => {
		const e401 = await runPseudoError(page, result, 401);
		const e429 = await runPseudoError(page, result, 429);
		return {
			ok: e401.ok && e429.ok,
			selectors: [
				'[data-testid="settings-dialog"] li input:not([type="password"])',
				".error-note",
				".error-note-detail",
			],
			e401,
			e429,
		};
	});

	await step("lan-observer-read-only-dom", async () => {
		await page.clickText("设置", { exact: true });
		const tab = await page.clickTextWithin('[data-testid="settings-dialog"]', "局域网观察", { exact: true });
		const switchCount = await page.visibleCount('[data-testid="settings-dialog"] [role="switch"]');
		if (switchCount > 0) {
			const current = await page.eval(
				'document.querySelector(\'[data-testid="settings-dialog"] [role="switch"]\')?.getAttribute("aria-checked")',
			);
			if (current !== "true") await page.clickSelector('[data-testid="settings-dialog"] [role="switch"]');
		}
		await page.waitForSelector('[data-testid="settings-dialog"] input[readonly]', 10_000);
		const url = await page.eval(
			"document.querySelector('[data-testid=\"settings-dialog\"] input[readonly]')?.value || null",
		);
		if (!url)
			return {
				ok: false,
				selectors: [
					'[data-testid="settings-dialog"] [role="switch"]',
					'[data-testid="settings-dialog"] input[readonly]',
				],
				tab,
				switchCount,
				url,
			};
		let navigated = false;
		try {
			await page.send("Page.navigate", { url });
			navigated = true;
		} catch {
			// Electron's embedded CDP target can reject Page.navigate; use the same
			// visible page location as the CDP-driven fallback and keep the DOM check.
			navigated = await page.eval(`(() => { location.assign(${JSON.stringify(url)}); return true; })()`);
		}
		await sleep(1_000);
		const dom = await page.eval(
			"(() => { const writes=[...document.querySelectorAll('button,input,textarea,[contenteditable=\"true\"],[role=\"textbox\"]')].filter(n=>{ if(n.matches('input[readonly]')) return false; const text=(n.textContent||'')+' '+(n.getAttribute('aria-label')||'')+' '+(n.getAttribute('title')||''); return /发送|写|编辑|删除|保存|提交|send|write|edit|delete|save|submit/i.test(text) || n.matches('textarea,[contenteditable=\"true\"],[role=\"textbox\"]'); }); return {textarea:document.querySelectorAll('textarea').length,send:document.querySelectorAll('[data-testid=\"composer-send\"],button[aria-label=\"发送\"],button[aria-label=\"Send\"]').length,writeControls:writes.length,buttons:document.querySelectorAll('button').length,inputs:document.querySelectorAll('input').length,url:location.href}; })()",
		);
		try {
			await page.send("Page.navigate", { url: "http://localhost:5173/" });
		} catch {
			await page.eval("(() => { location.assign('http://localhost:5173/'); return true; })()");
		}
		await sleep(1_000);
		await page.clickSelector('[data-testid="settings-dialog"] button[aria-label]');
		return {
			ok: Boolean(tab && navigated && dom.textarea === 0 && dom.send === 0 && dom.writeControls === 0),
			selectors: [
				"LAN page textarea",
				'LAN page [data-testid="composer-send"]',
				"LAN page button,input,[contenteditable]",
			],
			tab,
			navigated,
			dom,
		};
	});

	await step("responsive-light-dark-screens", async () => {
		await page.clickText("设置", { exact: true });
		await page.clickTextWithin('[data-testid="settings-dialog"]', "外观", { exact: true });
		const shots = [];
		for (const [w, h, label] of [
			[1024, 700, "1024x700"],
			[1920, 1080, "1920x1080"],
		]) {
			await page.setViewport(w, h);
			shots.push({ label, theme: "light", path: await page.screenshot(`p5/${label}-light.png`) });
		}
		const dark = await page.clickTextWithin('[data-testid="settings-dialog"]', "深色", { exact: true });
		for (const [w, h, label] of [
			[1024, 700, "1024x700"],
			[1920, 1080, "1920x1080"],
		]) {
			await page.setViewport(w, h);
			shots.push({ label, theme: "dark", path: await page.screenshot(`p5/${label}-dark.png`) });
		}
		return {
			ok: shots.length === 4 && dark,
			selectors: ['[data-testid="settings-dialog"]', '[role="switch"]', "viewport"],
			dark,
			shots,
			audits: [await page.audit()],
		};
	});
});
