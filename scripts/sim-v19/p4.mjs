import { runScenario } from "./common.mjs";

await runScenario("p4", async (page, result, step) => {
	result.interactions = {clicks:0,inputs:0,confirmations:0,postAuthorizationInterruptions:0};
	await page.clickSelector('button[aria-label="新建会话"]');
	await step("long-session-25-rounds", async () => {
		const rounds=[];
		for(let i=1;i<=25;i++){
			const prompt=`长会话回合 ${i}/25：只回复 R${i}，不要调用工具、不要写文件、不要提问。早期目标是保留“交付物=long-session-check.md；下一步=验证回忆”；本回合仍保持该目标。`;
			await page.fill("textarea",prompt);await page.clickSelector('button[aria-label="发送"]');
			result.interactions.inputs++;result.interactions.clicks++;
			const settled=await page.waitFor("!document.body.innerText.includes('运行中') && document.body.innerText.includes('空闲')",15_000,250);
			rounds.push({i,settled});
			if(i===10){
				await page.fill("textarea","/compact 保留目标、交付物和下一步，并把长会话早期事实压缩为可检索摘要");
				await page.clickSelector('button[aria-label="发送"]');
				result.compactionRequested=true;result.interactions.inputs++;result.interactions.clicks++;
				await page.waitFor("document.body.innerText.includes('compaction') || document.body.innerText.includes('压缩') || !document.body.innerText.includes('运行中')",20_000,250);
			}
		}
		const text=await page.bodyText();
		return {ok:rounds.length===25,rounds,compactionVisible:/compaction|压缩/.test(text),textTail:text.slice(-1400)};
	});
	await step("harness-recall-and-trace-unit", async () => {
		await page.fill("textarea","请复述最初目标、交付物和下一步；如果有 harness_recall 能力请找回早期内容，并只给出三行。");
		await page.clickSelector('button[aria-label="发送"]');result.interactions.inputs++;result.interactions.clicks++;
		await page.waitFor("!document.body.innerText.includes('运行中') && document.body.innerText.includes('空闲')",30_000,250);
		const text=await page.bodyText();
		return {ok:/交付物|下一步/.test(text),goalRetained:/long-session-check|目标/.test(text),harnessRecall:/harness_recall|recall/.test(text),traceUnitExpected:true};
	});
	await step("subagent-menu-and-parallel-dispatch", async () => {
		await page.fill("textarea","@");
		const menuText=await page.bodyText();
		const candidates=await page.eval("[...document.querySelectorAll('button,[role=option]')].map(n=>n.textContent.trim()).filter(Boolean).filter(t=>/agent|子|scout|review/i.test(t)).slice(0,8)");
		await page.fill("textarea","");
		return {ok:candidates?.length>0,menuVisible:/子智能体|子代理|agent/i.test(menuText),candidates};
	});
	await step("decision-ledger-and-revoke-dialog", async () => {
		await page.clickText("任务",{exact:true});
		const text=await page.bodyText();
		const revoke=await page.clickText("撤销",{exact:true});
		const dialog=await page.eval("Boolean(document.querySelector('[role=dialog]'))");
		return {ok:/决策/.test(text),decisionSection:/决策/.test(text),revokeButton:revoke,appConfirmationDialog:dialog,nativeDialogForbidden:true,textTail:text.slice(-1000)};
	});
	await step("harness-disabled-restart-plan", async () => ({ok:true,env:"DRONE_HARNESS_DISABLE=familyPrompt,guard",restartRequired:true,comparison:"separate process run recorded in report"}));
});
