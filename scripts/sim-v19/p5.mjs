import { runScenario } from "./common.mjs";

await runScenario("p5", async (page, result, step) => {
	result.interactions = {clicks:0,inputs:0,confirmations:0,postAuthorizationInterruptions:0};
	await page.clickSelector('button[aria-label="新建会话"]');
	await step("permissions-edit-preview-save", async () => {
		await page.clickText("设置",{exact:true});await page.clickText("权限",{exact:true});
		const before=await page.bodyText();
		const controls=await page.eval("[...document.querySelectorAll('input,textarea,button')].map(n=>({tag:n.tagName,text:n.textContent.trim(),placeholder:n.placeholder})).filter(x=>/bash|规则|试算|保存|权限/.test(x.text+x.placeholder))");
		const dry=await page.clickText("试算",{exact:true});
		const afterDry=await page.bodyText();
		const save=await page.clickText("保存",{exact:true});
		result.interactions.clicks+=4;result.interactions.confirmations+=save?1:0;
		return {ok:/权限/.test(before),controls,dryRun:dry,dryRunFeedback:/命中|匹配|试算|结果/.test(afterDry),save};
	});
	await step("self-protection-rule", async () => {
		const text=await page.bodyText();
		return {ok:/自保护|不可删除|删除/.test(text),selfProtectionVisible:/自保护|不可删除/.test(text),textTail:text.slice(-1200)};
	});
	await step("error-recovery-ui", async () => {
		await page.clickText("✕",{exact:true});
		await page.fill("textarea","请停止当前生成并说明如何恢复；不要调用工具。此回合只用于检查取消和错误卡文案。");
		await page.clickSelector('button[aria-label="发送"]');result.interactions.inputs++;result.interactions.clicks++;
		const stopped=await page.waitFor("document.body.innerText.includes('运行中')",5_000);
		const stop=await page.clickSelector('button[aria-label="停止"]')||await page.clickText("停止",{exact:true});
		const text=await page.bodyText();
		return {ok:stop||/错误|恢复|取消/.test(text),started:stopped,stopButton:stop,errorCard:/错误|恢复|重试/.test(text)};
	});
	await step("lan-observer-read-only", async () => {
		await page.clickText("设置",{exact:true});await page.clickText("局域网观察",{exact:true});
		const text=await page.bodyText();
		const toggles=await page.eval("[...document.querySelectorAll('button')].map(b=>b.textContent.trim()).filter(Boolean).filter(t=>/开启|关闭|远程控制|只读|观察/.test(t))");
		return {ok:/局域网|观察/.test(text),readOnlyHint:/只读|GET|写操作/.test(text),toggles,textTail:text.slice(-1200)};
	});
	await step("responsive-light-dark-screens", async () => {
		await page.clickText("外观",{exact:true});
		const shots=[];
		for(const [w,h,label] of [[1024,700,"1024x700"],[1920,1080,"1920x1080"]]){await page.setViewport(w,h);shots.push({label,path:await page.screenshot(`p5/${label}-light.png`)});}
		const dark=await page.clickText("深色",{exact:true});
		for(const [w,h,label] of [[1024,700,"1024x700"],[1920,1080,"1920x1080"]]){await page.setViewport(w,h);shots.push({label,path:await page.screenshot(`p5/${label}-dark.png`)});}
		return {ok:shots.length===4,darkToggle:dark,shots,audits:[await page.audit()]};
	});
});
