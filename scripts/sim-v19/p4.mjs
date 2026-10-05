import { randomBytes } from "node:crypto";
import { readTraceSummary, runScenario } from "./common.mjs";

const TRACE_ROOT = process.env.DRONE_TRACE_ROOT || "/tmp/drone-v19-sim/agent-dev/sessions";
const DISABLED = process.env.DRONE_P4_DISABLED === "1";
const ROUNDS = Number(process.env.DRONE_P4_ROUNDS || (DISABLED ? 5 : 25));
const secret = "RECALL-" + randomBytes(4).toString("hex").toUpperCase();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function sendRound(page, result, prompt, timeoutMs = 30_000) {
	const filled = await page.fill('[data-testid="composer-input"]', prompt);
	const sent = await page.clickSelector('[data-testid="composer-send"]');
	const startedRun = await page.waitForRunStart();
	result.interactions.inputs++;
	result.interactions.clicks++;
	const handled = [];
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		handled.push(...(await page.handleDialogs()));
		if (await page.waitForIdle(1_000)) break;
		await sleep(500);
	}
	result.interactions.confirmations += handled.filter((item) => item === "permission" || item.startsWith("ask-user")).length;
	return { filled, sent, startedRun, settled: await page.waitForIdle(1_000), handled };
}

async function decisionClosure(page) {
	await page.clickText("任务", { exact: true });
	const section = await page.waitForSelector('[data-testid="decisions-section"]', 10_000);
	const rows = await page.visibleCount('[data-testid="decision-row"]');
	if (!section || rows === 0) return { ok: false, reason: "decision rows absent", selectors: ['[data-testid="decisions-section"]', '[data-testid="decision-row"]'], rows };
	const revoke = await page.clickRegexWithin('[data-testid="decision-row"]', "撤销|revoke");
	const ask = await page.waitForSelector('[data-testid="ask-simple"]', 5_000);
	const handled = await page.handleDialogs();
	const pending = await page.eval("(() => { const root=document.querySelector('[data-testid=\"inquiry-artifacts\"]'); return {cards:root?.querySelectorAll('[data-testid=\"artifact-provenance-card\"]').length||0,pending:root ? [...root.querySelectorAll('[data-testid=\"artifact-provenance-card\"]')].filter(n=>/待复核|pending-review|pending review/i.test(n.textContent||'')).length:0}; })()");
	const publish = await page.clickRegexWithin("body", "发布|publish");
	const alert = await page.eval("(() => [...document.querySelectorAll('[role=\"alert\"]')].map(n=>n.textContent.trim()).find(text=>/artifact-pending-review|待复核|pending-review/i.test(text)) || null)");
	const confirmHandled = await page.handleDialogs();
	const release = publish ? await page.clickRegexWithin("body", "发布|publish") : false;
	const postAlert = await page.eval("(() => [...document.querySelectorAll('[role=\"alert\"]')].map(n=>n.textContent.trim()).find(text=>/artifact-pending-review|待复核|pending-review/i.test(text)) || null)");
	return {
		ok: Boolean(revoke && ask && handled.length > 0 && pending.pending > 0 && publish && alert && confirmHandled.length > 0 && release && !postAlert),
		selectors: ['[data-testid="decision-row"] button', '[data-testid="ask-simple"]', '[data-testid="inquiry-artifacts"] [data-testid="artifact-provenance-card"]', '[role="alert"]', 'button'],
		rows,
		revoke,
		ask,
		handled,
		pending,
		publish,
		alert,
		confirmHandled,
		release,
		postAlert,
	};
}

await runScenario("p4", async (page, result, step) => {
	const startedTrace = Date.now();
	result.interactions = { clicks: 0, inputs: 0, confirmations: 0, postAuthorizationInterruptions: 0 };
	result.workload = { requestedRounds: ROUNDS, disabled: DISABLED, recallSecret: secret };
	await page.clickSelector('button[aria-label="新建会话"]');

	await step("long-session-settled-rounds", async () => {
		const rounds = [];
		for (let i = 1; i <= ROUNDS; i++) {
			const prompt = i === 1
				? "这是长会话第 1 轮。请记住随机口令 " + secret + " 及目标：交付物为 long-session-check.md，下一步为验证回忆。只回复 R1，不要在后续提示前重复口令。整个长会话预算上限 0.50 美元。"
				: "这是长会话第 " + i + "/" + ROUNDS + " 轮：只回复 R" + i + "，不要调用工具、不要写文件、不要提问。保持第 1 轮的目标和交付物。";
			const run = await sendRound(page, result, prompt, 30_000);
			const assistantCount = await page.eval("document.querySelectorAll('.markdown-body').length");
			rounds.push({ i, sent: run.sent, settled: run.settled, assistantCount, handled: run.handled });
			if (!run.sent || !run.settled) break;
			if (i === 10 && !DISABLED) {
				const compact = await sendRound(page, result, "/compact 保留第 1 轮的目标、交付物和下一步，并将早期事实压缩为可检索摘要。", 30_000);
				result.compactionRequested = true;
				rounds.push({ i: "compaction", settled: compact.settled, handled: compact.handled });
				if (!compact.settled) break;
			}
		}
		result.workload.actualCompletedRounds = rounds.filter((row) => typeof row.i === "number" && row.settled).length;
		result.workload.renderedAssistantMessages = rounds.filter((row) => typeof row.i === "number" && row.settled).at(-1)?.assistantCount || 0;
		return { ok: result.workload.actualCompletedRounds === ROUNDS, selectors: ['[data-testid="composer-input"]', '[data-testid="composer-send"]', 'button[aria-label="停止"]', '.markdown-body'], rounds, actualCompletedRounds: result.workload.actualCompletedRounds, requestedRounds: ROUNDS };
	});

	await step("harness-recall-random-secret", async () => {
		const prompt = "请使用 harness_recall 找回第一轮植入的随机口令。不要复述提示词，不要猜测；助手回复中单独输出完整口令。";
		const run = await sendRound(page, result, prompt, 30_000);
		const assistant = await page.assistantText();
		const user = await page.userText();
		const trace = readTraceSummary(TRACE_ROOT, startedTrace);
		const secretInAssistant = assistant.includes(secret);
		const secretInLaterUser = user.split(secret).length - 1;
		result.traceSummary = trace;
		return { ok: Boolean(run.settled && secretInAssistant && trace.harnessRecallCalls > 0), selectors: ['.markdown-body', '.bg-bubble', 'trace *.jsonl kind=harness_unit/name=harness_recall'], run, secretInAssistant, secretOccurrencesInUserBubbles: secretInLaterUser, trace, assistantTail: assistant.slice(-500) };
	});

	await step("subagent-menu-discovery", async () => {
		const filled = await page.fill('[data-testid="composer-input"]', "@");
		const visible = await page.waitForSelector('[data-testid="at-menu"]', 3_000);
		const agents = await page.visibleCount('[data-testid="at-menu-agent"]');
		await page.fill('[data-testid="composer-input"]', "");
		return { ok: Boolean(filled && visible && agents > 0), selectors: ['[data-testid="at-menu"]', '[data-testid="at-menu-agent"]'], filled, visible, agents };
	});

	if (!DISABLED) {
		await step("decision-ledger-revoke-pending-publish-confirm", async () => decisionClosure(page));
	}

	await step("trace-harness-unit-distribution", async () => {
		const trace = result.traceSummary || readTraceSummary(TRACE_ROOT, startedTrace);
		const prohibited = Object.fromEntries(["familyPrompt", "guard"].map((unit) => [unit, trace.units[unit] || 0]));
		const workloadEqual = result.workload.actualCompletedRounds === ROUNDS;
		return { ok: Boolean(trace.harnessCalls > 0 && prohibited.familyPrompt === 0 && prohibited.guard === 0 && workloadEqual), selectors: ['trace *.jsonl kind=harness_unit', 'trace data.unit', 'p4 actualCompletedRounds'], trace, prohibited, workloadEqual };
	});
});
