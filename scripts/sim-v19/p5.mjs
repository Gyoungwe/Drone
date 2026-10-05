import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { runScenario } from "./common.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const AGENT_DIR = process.env.PI_CODING_AGENT_DIR || "/tmp/drone-v19-sim/agent-dev";
const PSEUDO_PROVIDER = "drone-sim-error";
const PSEUDO_MODEL = "drone-sim-error-model";
const APP_URL = process.env.DRONE_SIM_APP_URL || "http://localhost:5173/";

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

function installPseudoProvider(baseUrl) {
	const modelsPath = join(AGENT_DIR, "models.json");
	const authPath = join(AGENT_DIR, "auth.json");
	const originalModels = existsSync(modelsPath) ? readFileSync(modelsPath, "utf8") : null;
	const originalAuth = existsSync(authPath) ? readFileSync(authPath, "utf8") : null;
	const models = originalModels ? JSON.parse(originalModels) : {};
	const auth = originalAuth ? JSON.parse(originalAuth) : {};
	models.providers = {
		...(models.providers || {}),
		[PSEUDO_PROVIDER]: {
			name: "Drone local error fixture",
			baseUrl,
			api: "openai-completions",
			models: [{ id: PSEUDO_MODEL, name: "Drone local error fixture" }],
		},
	};
	auth[PSEUDO_PROVIDER] = { type: "api_key", key: "drone-sim-local" };
	writeFileSync(modelsPath, `${JSON.stringify(models, null, 2)}\n`, { mode: 0o600 });
	writeFileSync(authPath, `${JSON.stringify(auth, null, 2)}\n`, { mode: 0o600 });
	return () => {
		if (originalModels === null) writeFileSync(modelsPath, "{}\n", { mode: 0o600 });
		else writeFileSync(modelsPath, originalModels, { mode: 0o600 });
		if (originalAuth === null) writeFileSync(authPath, "{}\n", { mode: 0o600 });
		else writeFileSync(authPath, originalAuth, { mode: 0o600 });
	};
}

async function refreshModelsInUi(page) {
	await page.clickText("设置", { exact: true });
	await page.clickTextWithin('[data-testid="settings-dialog"]', "模型", { exact: true });
	const refreshed =
		(await page.clickSelector(
			'[data-testid="settings-dialog"] button[aria-label="联网刷新模型目录"], [data-testid="settings-dialog"] button[aria-label="Refresh model catalog"]',
		)) || (await page.clickRegexWithin('[data-testid="settings-dialog"]', "刷新|Refresh"));
	const visible = await page.waitFor(
		`[...document.querySelectorAll('[data-testid="settings-dialog"] li')].some((n)=>/Drone local error fixture/i.test(n.textContent||''))`,
		20_000,
	);
	return { refreshed, visible };
}

async function closeSettings(page) {
	return page.clickSelector('[data-testid="settings-dialog"] button[aria-label]');
}

async function navigate(page, url) {
	try {
		await page.send("Page.navigate", { url });
	} catch {
		await page.eval(`(() => { location.assign(${JSON.stringify(url)}); return true; })()`);
	}
	await page.waitFor("document.readyState === 'complete'", 15_000);
	await sleep(1_000);
}

async function setLanState(page, remoteControl) {
	await navigate(page, APP_URL);
	await page.clickText("设置", { exact: true });
	const tab = await page.clickTextWithin('[data-testid="settings-dialog"]', "局域网观察", { exact: true });
	const switches = await page.eval(
		"[...document.querySelectorAll('[data-testid=\"settings-dialog\"] [role=\"switch\"]')].map((node,index)=>({index,checked:node.getAttribute('aria-checked')}))",
	);
	const enabled = switches[0];
	if (enabled?.checked !== "true") {
		await page.eval(
			'(() => { const node=document.querySelector(\'[data-testid="settings-dialog"] [role="switch"]\'); if(!node)return false; node.click(); return true; })()',
		);
	}
	const urlReady = await page.waitForSelector('[data-testid="settings-dialog"] input[readonly]', 15_000);
	const remote = switches[1];
	if (!remote) {
		return { tab, switches, urlReady, remote: null, url: null };
	}
	if ((remote.checked === "true") !== remoteControl) {
		await page.eval(
			`(() => { const nodes=[...document.querySelectorAll('[data-testid="settings-dialog"] [role="switch"]')]; const node=nodes[1]; if(!node)return false; node.click(); return true; })()`,
		);
	}
	const remoteReady = await page.waitFor(
		`document.querySelectorAll('[data-testid="settings-dialog"] [role="switch"]')[1]?.getAttribute('aria-checked') === ${JSON.stringify(remoteControl ? "true" : "false")}`,
		10_000,
	);
	const url = await page.eval(
		"document.querySelector('[data-testid=\"settings-dialog\"] input[readonly]')?.value || null",
	);
	return { tab, switches, urlReady, remote: { ...remote, expected: remoteControl, ready: remoteReady }, url };
}

async function inspectLanDom(page) {
	return page.eval(`(() => {
		const visible = (node) => { const r=node.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(node).visibility !== 'hidden'; };
		const describe = (node) => ({
			tag: node.tagName.toLowerCase(),
			selector: node.dataset.testid ? '[data-testid="'+node.dataset.testid+'"]' : node.getAttribute('aria-label') ? node.tagName.toLowerCase()+'[aria-label="'+node.getAttribute('aria-label')+'"]' : node.className ? node.tagName.toLowerCase()+'.'+String(node.className).trim().replace(/\\s+/g,'.') : node.tagName.toLowerCase(),
			text: (node.textContent || node.getAttribute('placeholder') || '').trim().slice(0,120),
			ariaLabel: node.getAttribute('aria-label'),
		});
		const selectors = ['textarea','[contenteditable="true"]','[role="textbox"]','input:not([readonly])','button.c-btn','button.pbtn'];
		const controls = selectors.flatMap((selector) => [...document.querySelectorAll(selector)].filter(visible).map(describe));
		const writeControls = controls.filter((node) => !/停止|stop/i.test(node.ariaLabel || node.text));
		const sendButtons = [...document.querySelectorAll('button[aria-label="发送"],button[aria-label="Send"],button.c-btn.send:not(.stop)')].filter(visible).map(describe);
		return {
			url: location.href,
			textarea: document.querySelectorAll('textarea').length,
			sendButtons,
			writeControls,
			writeControlCount: writeControls.length,
			buttons: document.querySelectorAll('button').length,
			inputs: document.querySelectorAll('input').length,
		};
	})()`);
}

async function sendLanMessage(page) {
	const cardClicked = await page.eval(
		"(() => { const cards=[...document.querySelectorAll('.s-card.live,.s-card.idle')]; const card=cards[0] || document.querySelector('.s-card'); if(!card)return false; card.click(); return true; })()",
	);
	const composerReady = await page.waitForSelector("textarea.composer-input", 10_000);
	const text = "LAN-SIM-REMOTE-CONTROL";
	const filled = composerReady && (await page.fill("textarea.composer-input", text));
	const sent = filled && (await page.clickSelector('button[aria-label="发送"],button[aria-label="Send"]'));
	const userMessageVisible = await page.waitFor(
		`[...document.querySelectorAll('.m-user')].some((node)=>node.textContent?.includes(${JSON.stringify(text)}))`,
		10_000,
	);
	const cleared = await page.eval("document.querySelector('textarea.composer-input')?.value === ''");
	return { cardClicked, composerReady, filled, sent, userMessageVisible, cleared, text };
}

async function runPseudoError(page, result, status) {
	const fixture = await startErrorServer(status);
	const restoreFiles = installPseudoProvider(`http://127.0.0.1:${fixture.port}/v1`);
	try {
		const configured = await refreshModelsInUi(page);
		await closeSettings(page);
		await page.clickSelector('button[aria-label="新建会话"]');
		const pickerOpened = await page.eval(
			"(() => { const button=document.querySelector('.composer-model-group > div > button'); button?.click(); return Boolean(button); })()",
		);
		const selected = await page.eval(
			`(() => { const button=[...document.querySelectorAll('.composer-model-group button')].find(n=>/${PSEUDO_MODEL}|Drone local error fixture/i.test(n.textContent||'')); button?.click(); return button?.textContent.trim() || null; })()`,
		);
		const selectedInComposer = await page.waitFor(
			`/Drone local error fixture|${PSEUDO_MODEL}/i.test(document.querySelector('.composer-model-group > div > button')?.textContent||'')`,
			5_000,
		);
		const baselineErrors = await page.visibleCount(".error-note");
		const filled = await page.fill(
			'[data-testid="composer-input"]',
			`本地伪 provider ${status} 错误事件测试：只发送一次短请求，不要调用工具。`,
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
			`(() => { const cards=[...document.querySelectorAll('.error-note')]; const titles=[...document.querySelectorAll('.error-note-title')].map(n=>n.textContent.trim()); const details=[...document.querySelectorAll('.error-note-detail')].map(n=>n.textContent.trim()); return {cards:cards.length, newCards:Math.max(0,cards.length-${baselineErrors}), titles, details, alerts:document.querySelectorAll('[role="alert"]').length}; })()`,
		);
		const recovered = await page.clickSelector('button[aria-label="新建会话"]');
		const composerReady = await page.waitForSelector('[data-testid="composer-input"]', 5_000);
		return {
			status,
			configured,
			pickerOpened,
			selected,
			selectedInComposer,
			filled,
			sent,
			startedRun,
			evidence,
			requestCount: fixture.requests,
			recovered,
			composerReady,
			ok: Boolean(
				configured.refreshed &&
					configured.visible &&
					pickerOpened &&
					selected &&
					selectedInComposer &&
					sent &&
					startedRun &&
					fixture.requests > 0 &&
					evidence.newCards > 0 &&
					[...evidence.titles, ...evidence.details].some((text) =>
						new RegExp(`${status}|unauthorized|rate.?limit|认证|凭证|限流`, "iu").test(text),
					) &&
					recovered &&
					composerReady,
			),
		};
	} finally {
		restoreFiles();
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
			ok: Boolean(filled && sent && startedRun && appeared && stopped && errorCards > 0),
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

	await step("lan-observer-remote-control-off-read-only", async () => {
		const settings = await setLanState(page, false);
		if (!settings.url) return { ok: false, selectors: ["settings LAN switches", "LAN URL input"], settings };
		await navigate(page, settings.url);
		const dom = await inspectLanDom(page);
		const returned = await navigate(page, APP_URL);
		return {
			ok: Boolean(settings.tab && settings.urlReady && settings.remote?.ready && dom.writeControlCount === 0),
			selectors: [
				'[data-testid="settings-dialog"] [role="switch"]:nth-of-type(1)',
				'[data-testid="settings-dialog"] [role="switch"]:nth-of-type(2)',
				'[data-testid="settings-dialog"] input[readonly]',
				"LAN textarea/contenteditable/role=textbox/input:not([readonly])",
				"LAN button.c-btn / button.pbtn",
			],
			settings,
			dom,
			returned,
		};
	});

	await step("lan-observer-remote-control-on-send", async () => {
		const settings = await setLanState(page, true);
		if (!settings.url) return { ok: false, selectors: ["settings LAN switches", "LAN URL input"], settings };
		await navigate(page, settings.url);
		const before = await inspectLanDom(page);
		const send = await sendLanMessage(page);
		const after = await inspectLanDom(page);
		const returned = await navigate(page, APP_URL);
		return {
			ok: Boolean(
				settings.tab &&
					settings.urlReady &&
					settings.remote?.ready &&
					before.writeControlCount > 0 &&
					before.sendButtons.length > 0 &&
					send.cardClicked &&
					send.composerReady &&
					send.filled &&
					send.sent &&
					send.userMessageVisible &&
					send.cleared,
			),
			selectors: [
				'[data-testid="settings-dialog"] [role="switch"]:nth-of-type(2)',
				".s-card.live, .s-card.idle",
				"textarea.composer-input",
				'button[aria-label="发送"],button[aria-label="Send"]',
				".m-user",
			],
			settings,
			before,
			send,
			after,
			returned,
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
