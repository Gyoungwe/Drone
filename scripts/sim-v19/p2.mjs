import { runScenario } from "./common.mjs";

await runScenario("p2", async (page, result, step) => {
	result.interactions = {clicks:0,inputs:0,confirmations:0,postAuthorizationInterruptions:0};
	await page.clickSelector('button[aria-label="新建会话"]');
	await step("research-overview", async () => {
		await page.clickText("研究", {exact:true});
		const text=await page.bodyText();
		return {ok:/研究工作台/.test(text)&&/总览与配置/.test(text),oaHint:/开放|OA|文献库/.test(text),textTail:text.slice(-1200)};
	});
	await step("knowledge-search-and-topic-recovery", async () => {
		await page.clickText("知识库", {exact:true});
		const text=await page.bodyText();
		const searchControls=await page.eval("[...document.querySelectorAll('input,textarea')].map(n=>({placeholder:n.placeholder,value:n.value}))");
		const topics=/主题|话题|搜索|检索/.test(text);
		return {ok:topics,topics,searchControls,textTail:text.slice(-1600)};
	});
	await step("wiki-pending-and-zotero-degrade", async () => {
		await page.clickText("研究", {exact:true});
		await page.clickText("Wiki 审核", {exact:true});
		const wiki=await page.bodyText();
		const pending=/pending|待审核|待处理|没有待/.test(wiki);
		await page.clickText("Zotero", {exact:true}).catch?.(()=>{});
		const zotero=await page.bodyText();
		return {ok:pending||/Zotero/.test(zotero),pending,zoteroHint:/未运行|未连接|下载 Zotero|Zotero/.test(zotero),wikiTail:wiki.slice(-900),zoteroTail:zotero.slice(-900)};
	});
	await step("doi-archive-ui-flow", async () => {
		await page.clickText("聊天", {exact:true});
		const sent=await page.fill("textarea", "请用研究视图的文献归档流程处理两篇确定开放获取的 PLOS ONE 论文：DOI 10.1371/journal.pone.0000308 与 10.1371/journal.pone.0022596。只读公开全文，写入当前测试 Vault 的两条笔记，并提出一条 Wiki 修改；不要写入 Zotero。先建立 task_plan，获得一次授权后自主完成，预算 0.35 美元。\n\n另外先说明：命中不等于已读；如来源无 OA，明确提示并停止该篇。" );
		await page.clickSelector('button[aria-label="发送"]');
		result.interactions.inputs++;result.interactions.clicks++;
		const seen=await page.waitFor("document.body.innerText.includes('授权') || document.body.innerText.includes('同意本次请求') || document.body.innerText.includes('错误')",45_000);
		const text=await page.bodyText();
		return {ok:sent&&seen,seen,authorizationCard:/同意本次请求|暂不授权/.test(text),textTail:text.slice(-1400)};
	});
	await step("automatic-and-manual-pending-observation", async () => {
		const text=await page.bodyText();
		const pending=/pending|待审核|Wiki 审核/.test(text);
		const automatic=/automatic|自动/.test(text);
		return {ok:pending||automatic,pending,automatic,manualPendingExpected:true,regressionReference:"v0.18 automatic: known package-expiry behavior; v0.19 expected pending in both modes"};
	});
});
