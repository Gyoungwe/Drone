import { runScenario } from "./common.mjs";

await runScenario("p1", async (page, result, step) => {
	result.interactions = {clicks:0,inputs:0,confirmations:0,postAuthorizationInterruptions:0};
	await page.key("Escape");
	await page.clickText("✕", {exact:true});
	await step("first-screen-and-model-settings", async () => {
		await page.clickText("设置", {exact:true});
		await page.clickText("模型", {exact:true});
		const text = await page.bodyText();
		const ok = /DeepSeek/.test(text) && /已配置/.test(text);
		await page.clickText("✕", {exact:true});
		result.interactions.clicks += 3;
		return {ok,configuredDeepSeek:ok};
	});
	await step("slash-and-subagent-menu-discovery", async () => {
		await page.fill("textarea", "/");
		const slashText = await page.bodyText();
		const slash = /示例|skill|compact/.test(slashText);
		await page.fill("textarea", "@");
		const atText = await page.bodyText();
		const at = /子智能体|子代理|scout|reviewer|worker|文件/.test(atText);
		await page.fill("textarea", "");
		result.interactions.inputs += 3;
		return {ok:slash&&at,slash,at};
	});
	await step("open-evidence-example-and-fill", async () => {
		await page.clickText("主题文献检索与精读证据卡");
		await page.waitFor("Boolean(document.querySelector('[data-testid=example-task-dialog]'))");
		const inputs=await page.eval("[...document.querySelectorAll('[data-testid=example-task-dialog] input')].map(n=>n.id)");
		if (!inputs?.length) return {ok:false,reason:"example inputs not found"};
		await page.fill(`#${inputs[0]}`, "只研究两篇开放获取论文：DOI 10.1371/journal.pone.0000308 和 10.1371/journal.pone.0022596。限定只读这两篇，写简短检索日志和证据卡，不写 Zotero。总模型预算 0.25 美元，完成后停止。");
		result.interactions.clicks += 1;
		result.interactions.inputs += 1;
		return {ok:true,inputCount:inputs.length};
	});
	await step("launch-and-single-authorization", async () => {
		const launched = await page.clickText("新建会话并发起");
		if (!launched) await page.clickText("发起", {exact:true});
		result.interactions.clicks += 1;
		await page.waitFor("document.body.innerText.includes('信任') || document.body.innerText.includes('批准') || document.body.innerText.includes('允许') || document.body.innerText.includes('错误')", 60_000);
		let text=await page.bodyText();
		if (/信任此项目/.test(text)) {await page.clickText("信任此项目");result.interactions.confirmations++;}
		await page.waitFor("Boolean(document.querySelector('[data-testid=permission-allow-run]')) || document.body.innerText.includes('批准') || document.body.innerText.includes('错误') || document.body.innerText.includes('失败')",60_000);
		text=await page.bodyText();
		const approvals=[...await page.eval("[...document.querySelectorAll('button')].map(n=>n.textContent.trim()).filter(t=>/授权|批准|允许本次|本次任务/.test(t))")];
		const allowed=await page.clickSelector("[data-testid=permission-allow-run]") || await page.clickText("批准并开始") || await page.clickText("批准");
		if(allowed)result.interactions.confirmations++;
		return {ok:allowed,approvalButtons:approvals,errorVisible:/错误|失败|无效|401|404|429/.test(text),textTail:text.slice(-1500)};
	});
	await step("run-to-completion", async () => {
		const completed = await page.waitFor("document.body.innerText.includes('交付已完成') || document.body.innerText.includes('请求失败') || document.body.innerText.includes('API') && document.body.innerText.includes('错误')", 120_000,500);
		const text=await page.bodyText();
		const interrupted=/请.*确认|请.*提供|是否继续|需要.*授权/.test(text);
		result.interactions.postAuthorizationInterruptions += interrupted?1:0;
		return {ok:completed&&/交付已完成/.test(text),completed,interrupted,textTail:text.slice(-1800)};
	});
	await step("bilingual-key-audit", async () => {
		await page.clickText("设置",{exact:true});await page.clickText("通用",{exact:true});
		await page.clickText("English",{exact:true});const english=await page.audit();
		await page.clickText("中文",{exact:true});const chinese=await page.audit();
		await page.clickText("✕",{exact:true});result.interactions.clicks+=5;
		return {ok:!english.rawKeys.some(k=>/^(examples|permission|task|panel|settings)\./.test(k)),english,chinese};
	});
});
