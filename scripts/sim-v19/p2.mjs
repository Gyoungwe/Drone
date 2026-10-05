import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { runScenario } from "./common.mjs";

const VAULT = process.env.DRONE_SIM_VAULT || "/tmp/drone-v19-sim/vault";
const NOTE = VAULT + "/Wiki/Existing.md";
const PROJECT = process.env.DRONE_SIM_PROJECT || "/tmp/drone-v19-sim/project";
mkdirSync(VAULT + "/Wiki", { recursive: true });
const originalNote = "# Existing test note\n\nStable baseline content for Wiki review.\n\n- fixed-value: 42\n";
writeFileSync(NOTE, originalNote, "utf8");
const sha256 = () => createHash("sha256").update(readFileSync(NOTE)).digest("hex");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function openKnowledge(page) {
	await page.clickText("研究", { exact: true });
	await page.waitForSelector('[data-testid="knowledge-panel"]', 20_000);
}

async function ensureBinding(page) {
	await openKnowledge(page);
	if (await page.visibleCount('select[aria-label="知识审核模式"]')) return { bound: true, setup: "existing" };
	const input = '[data-testid="knowledge-panel"] input[aria-label]';
	const filled = await page.fill(input, VAULT);
	const preview = await page.clickRegexWithin('[data-testid="knowledge-panel"]', "预览|preview");
	const previewVisible = await page.waitForSelector('[data-testid="knowledge-panel"] [role="status"], [data-testid="knowledge-panel"] pre', 15_000);
	const setup = await page.clickRegexWithin('[data-testid="knowledge-panel"]', "开始初始化问答|Start setup interview");
	const dialogs = [];
	const setupStarted = Date.now();
	while (Date.now() - setupStarted < 120_000) {
		dialogs.push(...(await page.handleDialogs()));
		if (await page.waitForSelector('select[aria-label="知识审核模式"]', 1_000)) break;
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	const bound = await page.visibleCount('select[aria-label="知识审核模式"]') > 0;
	return { bound, filled, preview, previewVisible, setup, dialogs };
}

async function reviewState(page) {
	return page.eval("(() => { const root=document.querySelector('[data-testid=\"wiki-review-panel\"]'); if (!root) return {exists:false,total:null,queueItems:0,pendingControls:0,selected:false}; const header=[...root.querySelectorAll('aside span')].map(n=>n.textContent.trim()).find(text=>/·\\s*\\d+/.test(text))||''; const total=Number(header.match(/·\\s*(\\d+)/)?.[1]||-1); const queueItems=[...root.querySelectorAll('aside button')].filter(button=>button.querySelector('span.block.break-words')).length; const controls=[...root.querySelectorAll('button')].filter(button=>/拒绝|批准|应用|reject|approve/i.test(button.textContent||'')); const selected=Boolean(root.querySelector('h3')&&root.querySelector('input[type=\"checkbox\"]')); return {exists:true,total,queueItems,pendingControls:controls.filter(button=>!button.disabled).length,selected,controlLabels:controls.map(button=>button.textContent.trim())}; })()");
}

async function openReviews(page) {
	await openKnowledge(page);
	await page.clickTextWithin('[data-testid="knowledge-panel"]', "Wiki 审核", { exact: true });
	await page.waitForSelector('[data-testid="wiki-review-panel"]', 20_000);
	return reviewState(page);
}

async function propose(page, result, label) {
	await page.clickText("聊天", { exact: true });
	const prompt = [
		"读取当前测试 Vault 的 Wiki/Existing.md，但不要直接修改文件。",
		"请调用 research_propose_wiki_update，targetPath 必须是 Wiki/Existing.md，title 为 " + label + "，",
		"建议正文只增加一行 review-value: " + label + "，rationale 写明这是模拟用户测试，sources 只填 Wiki/Existing.md。",
		"只提交一个候选，不要批准或应用它；先用 task_plan 规划，然后一次授权后自动完成。模型预算上限 0.35 美元。",
	].join(" ");
	const filled = await page.fill('[data-testid="composer-input"]', prompt);
	const sent = await page.clickSelector('[data-testid="composer-send"]');
	const startedRun = await page.waitForRunStart();
	result.interactions.inputs++;
	result.interactions.clicks++;
	const handled = [];
	const started = Date.now();
	while (Date.now() - started < 120_000) {
		handled.push(...(await page.handleDialogs()));
		if (await page.waitForIdle(1_000)) break;
		await sleep(500);
	}
	result.interactions.confirmations += handled.filter((item) => item === "permission" || item.startsWith("ask-user")).length;
	return { filled, sent, startedRun, handled, settled: await page.waitForIdle(1_000) };
}

async function runMode(page, result, label, mode, priorTotal, decisionAction) {
	await openKnowledge(page);
	const modeSet = await page.setSelect('select[aria-label="知识审核模式"]', mode);
	const modeValue = await page.eval('document.querySelector("select[aria-label=\\"知识审核模式\\"]")?.value || null');
	const beforeHash = sha256();
	const proposal = await propose(page, result, label);
	let state = await openReviews(page);
	const started = Date.now();
	while (Date.now() - started < 120_000 && !(state.total > priorTotal && state.queueItems > 0)) {
		await sleep(1_000);
		state = await reviewState(page);
	}
	let selected = false;
	if (state.total > priorTotal && state.queueItems > 0) {
		selected = await page.clickSelector('[data-testid="wiki-review-panel"] aside button');
		await page.waitForSelector('[data-testid="wiki-review-panel"] h3', 10_000);
		state = await reviewState(page);
	}
	const afterHash = sha256();
	const pendingEvidence = { totalBefore: priorTotal, totalAfter: state.total, queueItems: state.queueItems, pendingControls: state.pendingControls, selected: state.selected, selectedClick: selected, beforeHash, afterHash, hashUnchanged: beforeHash === afterHash };
	let decision = null;
	if (state.total > priorTotal && state.queueItems > 0) {
		const pattern = decisionAction === "approve" ? "批准|应用|approve|apply" : "拒绝|reject";
		if (decisionAction === "approve") {
			const checked = await page.clickSelector('[data-testid="wiki-review-panel"] input[type="checkbox"]');
			const clicked = await page.clickRegexWithin('[data-testid="wiki-review-panel"]', pattern);
			decision = { action: decisionAction, checked, clicked };
		} else {
			const clicked = await page.clickRegexWithin('[data-testid="wiki-review-panel"]', pattern);
			decision = { action: decisionAction, clicked };
		}
	}
	return { modeSet, modeValue, proposal, review: pendingEvidence, decision, ok: modeSet?.value === mode && pendingEvidence.totalAfter > priorTotal && pendingEvidence.pendingControls >= 2 && pendingEvidence.selected && pendingEvidence.hashUnchanged && Boolean(decision?.clicked) };
}

await runScenario("p2", async (page, result, step) => {
	result.interactions = { clicks: 0, inputs: 0, confirmations: 0, postAuthorizationInterruptions: 0 };
	await page.clickSelector('button[aria-label="新建会话"]');
	await step("knowledge-binding-and-research-overview", async () => {
		const binding = await ensureBinding(page);
		const panel = await page.scopedText('[data-testid="knowledge-panel"]');
		return { ok: binding.bound && Boolean(panel), selectors: ['[data-testid="knowledge-panel"]', 'select[aria-label="知识审核模式"]'], binding, panelLength: panel.length, vault: VAULT };
	});
	await step("knowledge-search-and-topic-recovery", async () => {
		const topicsTab = await page.clickTextWithin('[data-testid="knowledge-panel"]', "主题", { exact: true });
		const topics = await page.waitForSelector('[data-testid="knowledge-topics"]', 10_000);
		const search = await page.eval("(() => { const root=document.querySelector('[data-testid=\"knowledge-topics\"]'); return {inputs:root?.querySelectorAll('input').length||0,refreshButtons:root?[...root.querySelectorAll('button')].filter(b=>/刷新|refresh/i.test(b.textContent||'')).length:0,topicArticles:root?.querySelectorAll('article').length||0}; })()");
		const reviews = await openReviews(page);
		return { ok: Boolean(topicsTab && topics && search.inputs === 1 && reviews.exists), selectors: ['[data-testid="knowledge-topics"] input', '[data-testid="wiki-review-panel"] aside button'], topicsTab, search, reviews };
	});
	await step("automatic-wiki-pending-hash-and-zotero-degrade", async () => {
		const state = await reviewState(page);
		const run = await runMode(page, result, "automatic-v19", "automatic", state.total, "reject");
		await page.clickText("设置", { exact: true });
		const zoteroTab = await page.clickTextWithin('[data-testid="settings-dialog"]', "Zotero", { exact: true });
		const zotero = await page.waitForSelector('[data-testid="zotero-panel"]', 10_000);
		const zoteroEvidence = await page.eval("(() => { const root=document.querySelector('[data-testid=\"zotero-panel\"]'); return {statusRows:root?.querySelectorAll('section').length||0,alerts:root?.querySelectorAll('[role=\"alert\"]').length||0,status:root?.querySelectorAll('[role=\"status\"]').length||0,controls:root?.querySelectorAll('button,input').length||0}; })()");
		await page.clickSelector('[data-testid="settings-dialog"] button[aria-label]');
		return { ok: run.ok && Boolean(zoteroTab && zotero), selectors: ['select[aria-label="知识审核模式"]', '[data-testid="wiki-review-panel"] aside span', '[data-testid="zotero-panel"] [role="alert"],[role="status"]'], run, zoteroTab, zoteroEvidence };
	});
	await step("manual-wiki-pending-hash-and-approval", async () => {
		const state = await openReviews(page);
		const run = await runMode(page, result, "manual-v19", "strict", state.total, "approve");
		const hashBeforeDecision = run.review.beforeHash;
		const hashAfterDecision = sha256();
		return { ok: run.ok, selectors: ['select[aria-label="知识审核模式"]', '[data-testid="wiki-review-panel"] aside button', '[data-testid="wiki-review-panel"] input[type="checkbox"]'], run, hashBeforeDecision, hashAfterDecision, noteChangedAfterDecision: hashBeforeDecision !== hashAfterDecision };
	});
	await step("doi-oa-and-review-queue-evidence", async () => {
		const state = await openReviews(page);
		return { ok: state.exists && state.total >= 1 && state.queueItems >= 1, selectors: ['[data-testid="wiki-review-panel"] aside span', '[data-testid="wiki-review-panel"] aside button span.block.break-words'], state };
	});
});
