import { appendFileSync, copyFileSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { runScenario } from "./common.mjs";

const PROJECT = process.env.DRONE_SIM_PROJECT || "/tmp/drone-v19-sim/project";
const FIXTURE = new URL("./fixtures/plot_fixed.py", import.meta.url).pathname;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function prepareFixture() {
	mkdirSync(PROJECT, { recursive: true });
	rmSync(PROJECT + "/figure.png", { force: true });
	rmSync(PROJECT + "/result.md", { force: true });
	writeFileSync(PROJECT + "/data.csv", "sample,value\nA,1\nB,3\nC,5\nD,7\n", "utf8");
	copyFileSync(FIXTURE, PROJECT + "/plot_fixed.py");
}

async function runTask(page, result) {
	const handled = [];
	const startedRun = await page.waitForRunStart();
	const started = Date.now();
	while (Date.now() - started < 120_000) {
		handled.push(...(await page.handleDialogs()));
		if (await page.waitForIdle(1_000)) break;
		await sleep(500);
	}
	result.interactions.confirmations += handled.filter((item) => item === "permission" || item.startsWith("ask-user")).length;
	return { startedRun, settled: await page.waitForIdle(1_000), handled };
}

await runScenario("p3", async (page, result, step) => {
	result.interactions = { clicks: 0, inputs: 0, confirmations: 0, postAuthorizationInterruptions: 0 };
	prepareFixture();
	await page.clickSelector('button[aria-label="新建会话"]');

	await step("deterministic-fixture-present", async () => {
		const evidence = {
			csv: existsSync(PROJECT + "/data.csv") ? readFileSync(PROJECT + "/data.csv", "utf8") : null,
			script: existsSync(PROJECT + "/plot_fixed.py"),
		};
		return { ok: Boolean(evidence.csv?.includes("A,1") && evidence.csv?.includes("D,7") && evidence.script), selectors: ['filesystem fixture data.csv', 'filesystem fixture plot_fixed.py'], evidence: { csvBytes: evidence.csv?.length || 0, script: evidence.script } };
	});

	await step("run-fixed-local-analysis", async () => {
		const prompt = [
			"只执行当前项目里的确定性夹具：python3 plot_fixed.py --out .。",
			"不要自行生成绘图代码，不要联网；该脚本必须生成 figure.png 和 result.md，result.md 的数字应为 n=4、mean=4、slope=2。",
			"将这两个文件登记为带来源、代码指纹、父链和可复现性信息的产物，并用 inquiry artifact 记录；先 task_plan，一次授权后自动完成。",
		].join(" ");
		const filled = await page.fill('[data-testid="composer-input"]', prompt);
		const sent = await page.clickSelector('[data-testid="composer-send"]');
		result.interactions.inputs++;
		result.interactions.clicks++;
		const run = await runTask(page, result);
		const output = {
			figure: existsSync(PROJECT + "/figure.png"),
			result: existsSync(PROJECT + "/result.md") && readFileSync(PROJECT + "/result.md", "utf8").includes("mean = 4"),
		};
		return { ok: Boolean(filled && sent && run.settled && output.figure && output.result), selectors: ['[data-testid="composer-input"]', '[data-testid="composer-send"]', 'button[aria-label="停止"]'], filled, sent, run, output };
	});

	await step("artifact-provenance-panel", async () => {
		const opened = await page.clickText("产物", { exact: true });
		const panel = await page.waitForSelector('[data-testid="inquiry-artifacts"]', 10_000);
		const cards = await page.visibleCount('[data-testid="artifact-provenance-card"]');
		const expand = await page.clickSelector('[data-testid="artifact-provenance-card"] button[aria-expanded]');
		const details = await page.waitForSelector('[data-testid="artifact-provenance-details"]', 10_000);
		const evidence = await page.eval("(() => { const root=document.querySelector('[data-testid=\"artifact-provenance-details\"]'); const repro=root?.querySelector('[data-reproducibility]'); return {reproducibility:repro?.getAttribute('data-reproducibility')||null,codeFingerprint:root ? [...root.querySelectorAll('p')].filter(n=>/指纹|fingerprint/i.test(n.textContent||'')).length : 0,parentChain:root ? [...root.querySelectorAll('p')].filter(n=>/父链|parent/i.test(n.textContent||'')).length : 0}; })()");
		return { ok: Boolean(opened && panel && cards > 0 && expand && details && evidence.reproducibility && evidence.codeFingerprint > 0 && evidence.parentChain > 0), selectors: ['[data-testid="inquiry-artifacts"]', '[data-testid="artifact-provenance-card"]', '[data-testid="artifact-provenance-details"]', '[data-reproducibility]'], opened, panel, cards, expand, details, evidence };
	});

	await step("mutate-files-and-review-cards", async () => {
		appendFileSync(PROJECT + "/figure.png", Buffer.from([0]));
		const resultPath = PROJECT + "/result.md";
		const text = readFileSync(resultPath, "utf8").replace("mean = 4", "mean = 999");
		writeFileSync(resultPath, text, "utf8");
		const process = await page.clickText("过程", { exact: true });
		const cardsVisible = await page.waitForSelector('[data-testid="reviewer-card"]', 30_000);
		const codes = await page.eval("[...document.querySelectorAll('[data-testid=\"reviewer-card\"] .reviewer-card-code')].map(n=>n.textContent.trim())");
		const stop = await page.visibleCount('button[aria-label="停止"],button[aria-label="Stop"]');
		const composer = await page.visibleCount('[data-testid="composer-input"]');
		return { ok: Boolean(process && cardsVisible && codes.includes("figure-code-mismatch") && codes.includes("untraceable-number") && stop === 0 && composer > 0), selectors: ['[data-testid="reviewer-card"] .reviewer-card-code', '[data-testid="composer-input"]', 'button[aria-label="停止"]'], process, codes, stop, composer, mainRunNotBlocked: stop === 0 && composer > 0 };
	});

	await step("compute-empty-state", async () => {
		const opened = await page.clickText("计算", { exact: true });
		const pane = await page.waitForSelector('[data-testid="compute-pane"]', 10_000);
		const hosts = await page.visibleCount('[data-testid^="compute-host-"]');
		const jobs = await page.visibleCount('[data-testid^="compute-job-"]');
		const empty = await page.eval("(() => { const root=document.querySelector('[data-testid=\"compute-pane\"]'); return {alerts:root?.querySelectorAll('[role=\"alert\"]').length||0,status:root?.querySelectorAll('[role=\"status\"]').length||0,buttons:root?.querySelectorAll('button').length||0}; })()");
		return { ok: Boolean(opened && pane && hosts === 0 && jobs === 0 && (empty.alerts + empty.status + empty.buttons > 0)), selectors: ['[data-testid="compute-pane"]', '[data-testid^="compute-host-"]', '[data-testid^="compute-job-"]'], opened, pane, hosts, jobs, empty };
	});
});
