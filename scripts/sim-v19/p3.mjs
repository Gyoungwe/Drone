import { runScenario } from "./common.mjs";

await runScenario("p3", async (page, result, step) => {
	result.interactions = {clicks:0,inputs:0,confirmations:0,postAuthorizationInterruptions:0};
	await page.clickSelector('button[aria-label="新建会话"]');
	await step("analysis-example-form", async () => {
		await page.clickText("分析", {exact:false});
		const opened=await page.waitFor("Boolean(document.querySelector('[data-testid=example-task-dialog]'))",10_000);
		const inputs=await page.eval("[...document.querySelectorAll('[data-testid=example-task-dialog] input')].map(n=>({id:n.id,placeholder:n.placeholder}))");
		if(inputs?.length) await page.fill(`#${inputs[0].id}`, "读取当前项目的 data.csv，用本地脚本或内核计算均值、斜率并生成一张 PNG 图和一段带数字的结论。把图和结论作为产物，保留代码指纹、父链和可复现性说明；不要联网。预算 0.30 美元。");
		result.interactions.clicks++;result.interactions.inputs++;
		return {ok:opened&&Boolean(inputs?.length),opened,inputs};
	});
	await step("run-local-analysis", async () => {
		const launched=await page.clickText("新建会话并发起")||await page.clickText("发起",{exact:true});
		result.interactions.clicks++;
		const seen=await page.waitFor("document.body.innerText.includes('授权') || document.body.innerText.includes('同意本次请求') || document.body.innerText.includes('错误')",45_000);
		const text=await page.bodyText();
		return {ok:launched&&seen,launched,seen,authorization:/同意本次请求|暂不授权/.test(text),textTail:text.slice(-1200)};
	});
	await step("artifact-provenance-panel", async () => {
		await page.clickText("产物",{exact:true});
		const text=await page.bodyText();
		return {ok:/产物/.test(text),reproducibility:/可复现|reproducible/.test(text),fingerprint:/指纹|fingerprint/.test(text),parentChain:/父链|parent/.test(text),renderMs:await page.metrics()};
	});
	await step("mismatch-review-cards", async () => {
		const text=await page.bodyText();
		return {ok:/figure-code-mismatch|untraceable-number|审稿|review/.test(text),figureCodeMismatch:/figure-code-mismatch/.test(text),untraceableNumber:/untraceable-number/.test(text),reviewVisible:/审稿|review/.test(text),mainRunNotBlocked:!text.includes("等待审稿").valueOf()};
	});
	await step("compute-empty-state", async () => {
		await page.clickText("计算",{exact:true});
		const text=await page.bodyText();
		return {ok:/计算|主机|远程|没有|未配置|空/.test(text),clearEmptyState:/未配置|没有主机|暂无|空/.test(text),textTail:text.slice(-1000)};
	});
});
