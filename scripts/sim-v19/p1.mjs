import { existsSync } from "node:fs";
import { runScenario } from "./common.mjs";

const PROJECT = process.env.DRONE_SIM_PROJECT || "/tmp/drone-v19-sim/project";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitThroughTask(page, result, timeoutMs = 120_000) {
	const started = Date.now();
	const handled = [];
	const startedRun = await page.waitForRunStart();
	while (Date.now() - started < timeoutMs) {
		const events = await page.handleDialogs();
		handled.push(...events);
		if (await page.waitForIdle(1_000)) break;
		await sleep(500);
	}
	result.interactions.confirmations += handled.filter((item) => item === "permission" || item.startsWith("ask-user")).length;
	// Any ask-user card is a follow-up interruption; the one expected card is
	// the tool permission card and is counted separately above.
	result.interactions.postAuthorizationInterruptions += handled.filter((item) => item.startsWith("ask-user")).length;
	return { startedRun, settled: await page.waitForIdle(1_000), handled };
}

await runScenario("p1", async (page, result, step) => {
	result.interactions = { clicks: 0, inputs: 0, confirmations: 0, postAuthorizationInterruptions: 0 };
	await page.key("Escape");
	await page.clickSelector('[data-testid="settings-dialog"] button[aria-label]');

	await step("first-screen-and-model-settings", async () => {
		const opened = await page.clickText("设置", { exact: true });
		const settings = await page.waitForSelector('[data-testid="settings-dialog"]');
		const modelTab = await page.clickTextWithin('[data-testid="settings-dialog"]', "模型", { exact: true });
		const evidence = await page.eval("(() => { const root=document.querySelector('[data-testid=\"settings-dialog\"]'); const rows=[...(root?.querySelectorAll('li')||[])].map(n=>n.textContent.trim()); const deepSeek=rows.filter(text=>/DeepSeek/i.test(text)); return {rowCount:rows.length,deepSeek,configuredRows:deepSeek.filter(text=>/已配置|configured/i.test(text)).length}; })()");
		await page.clickSelector('[data-testid="settings-dialog"] button[aria-label]');
		result.interactions.clicks += 3;
		return { ok: Boolean(opened && settings && modelTab && evidence.deepSeek.length > 0 && evidence.configuredRows > 0), selectors: ['[data-testid="settings-dialog"]', '[data-testid="settings-dialog"] li'], evidence };
	});

	await step("slash-and-subagent-menu-discovery", async () => {
		const slashFilled = await page.fill('[data-testid="composer-input"]', "/");
		const slashVisible = await page.waitForSelector('div.shadow-pop button[data-command]', 3_000);
		const slashEvidence = await page.eval("(() => { const nodes=[...document.querySelectorAll('div.shadow-pop button[data-command]')]; return {count:nodes.length,commands:nodes.map(n=>n.getAttribute('data-command'))}; })()");
		await page.fill('[data-testid="composer-input"]', "@");
		const atVisible = await page.waitForSelector('[data-testid="at-menu"]', 3_000);
		const atEvidence = await page.eval("(() => { const root=document.querySelector('[data-testid=\"at-menu\"]'); return {agents:root?root.querySelectorAll('[data-testid=\"at-menu-agent\"]').length:0,files:root?root.querySelectorAll('[data-testid=\"at-menu-file\"]').length:0,visible:Boolean(root)}; })()");
		await page.fill('[data-testid="composer-input"]', "");
		result.interactions.inputs += 3;
		return { ok: Boolean(slashFilled && slashVisible && slashEvidence.count > 0 && atVisible && atEvidence.agents > 0), selectors: ['div.shadow-pop button[data-command]', '[data-testid="at-menu-agent"]'], slashEvidence, atEvidence };
	});

	await step("open-evidence-example-and-fill", async () => {
		const opened = await page.clickRegexWithin('[data-testid="example-task-cards"]', "主题文献检索与精读证据卡");
		const dialog = await page.waitForSelector('[data-testid="example-task-dialog"]');
		const input = await page.eval("document.querySelector('[data-testid=\"example-task-input\"] input, [data-testid=\"example-task-input\"] textarea')?.id || null");
		if (!input) return { ok: false, selectors: ['[data-testid="example-task-dialog"]', '[data-testid="example-task-input"] input'] };
		const filled = await page.fill("#" + input, "只研究两篇开放获取论文：DOI 10.1371/journal.pone.0000308 和 10.1371/journal.pone.0022596。限定只读这两篇，写简短检索日志和证据卡，不写 Zotero。完成后停止。模型预算上限 0.25 美元。");
		result.interactions.clicks += 1;
		result.interactions.inputs += 1;
		return { ok: Boolean(opened && dialog && filled), selectors: ['[data-testid="example-task-card"]', '[data-testid="example-task-input"] input'], inputId: input };
	});

	await step("launch-and-single-authorization", async () => {
		const launched = await page.clickSelector('[data-testid="example-task-launch"]');
		result.interactions.clicks += 1;
		const run = await waitThroughTask(page, result, 90_000);
		const permissionCount = run.handled.filter((item) => item === "permission").length;
		const askUserCount = run.handled.filter((item) => item.startsWith("ask-user")).length;
		return { ok: Boolean(launched && run.startedRun && run.settled && permissionCount === 1 && askUserCount === 0), selectors: ['[data-testid="example-task-launch"]', '[data-testid="permission-allow-run"]', '[data-testid="ask-simple"]', '[data-testid="ask-dialog"]'], launched, startedRun: run.startedRun, settled: run.settled, handled: run.handled, permissionCount, askUserCount };
	});

	await step("run-to-completion-without-second-ask", async () => {
		const settled = await page.waitForIdle(120_000);
		const assistantReplies = await page.eval("document.querySelectorAll('.markdown-body').length");
		const dialogs = await page.eval("document.querySelectorAll('[data-testid=\"ask-simple\"],[data-testid=\"ask-dialog\"],[data-testid=\"permission-allow-run\"]').length");
		const expectedFiles = ["search-log.md", "evidence-cards.md"].map((name) => ({ name, exists: existsSync(PROJECT + "/" + name) }));
		const completedFiles = expectedFiles.filter((file) => file.exists).length;
		return { ok: Boolean(settled && assistantReplies > 0 && dialogs === 0 && result.interactions.postAuthorizationInterruptions === 0 && completedFiles === expectedFiles.length), selectors: ['[data-testid="composer-input"]', 'button[aria-label="停止"]', '.markdown-body', '[data-testid="ask-simple"]', '[data-testid="ask-dialog"]'], settled, assistantReplies, dialogs, postAuthorizationInterruptions: result.interactions.postAuthorizationInterruptions, expectedFiles };
	});

	await step("bilingual-key-audit", async () => {
		await page.clickText("设置", { exact: true });
		await page.clickTextWithin('[data-testid="settings-dialog"]', "通用", { exact: true });
		await page.clickTextWithin('[data-testid="settings-dialog"]', "English", { exact: true });
		const english = await page.audit();
		await page.clickTextWithin('[data-testid="settings-dialog"]', "中文", { exact: true });
		const chinese = await page.audit();
		await page.clickSelector('[data-testid="settings-dialog"] button[aria-label]');
		result.interactions.clicks += 5;
		const leaked = [...new Set([...english.rawKeys, ...chinese.rawKeys])].filter((key) => /^(settings|workbench|permission|task|panel|knowledge)\./i.test(key));
		return { ok: leaked.length === 0, selectors: ['[data-testid="settings-dialog"]', '[data-testid="settings-dialog"] button'], english, chinese, leaked };
	});
});
