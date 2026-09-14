import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, ipcMain } from "electron";
import { KnowledgeUiService } from "../../packages/backend/src/knowledge/ui.ts";
import { registerKnowledgeIpc } from "../../packages/desktop/src/main/ipc/knowledge.ts";
import { IpcChannels } from "../../packages/shared/src/ipc.ts";

const root = process.env.PERCHO_UI_FIXTURE,
	repo = process.env.PERCHO_UI_REPO;
process.env.PERCHO_KNOWLEDGE_DIR = join(root, "app-state");
process.env.PERCHO_RESEARCH_WORKBENCH_ROOT = join(repo, ".pi");
delete process.env.PI_RESEARCH_DESKTOP_CONFIG;
app.setPath("userData", join(root, "electron-profile"));
app.setName("Percho Knowledge UI Fixture");
const runtime = async (name) => import(pathToFileURL(join(repo, ".pi/lib", `${name}.mjs`)).href);
let window, services;
const checks = [],
	errors = [],
	actions = [];
const screenshots = join(root, "screenshots");
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function run() {
	try {
		console.log("Electron ready; preparing isolated knowledge fixtures");
		const work = await runtime("obsidian-workbench");
		services = await runtime("knowledge/service");
		const review = await runtime("knowledge/wiki-review");
		const state = await runtime("knowledge/ui-state");
		const cwd = join(root, "project"),
			vault = join(root, "Research Vault");
		await mkdir(cwd);
		await mkdir(screenshots);
		const bound = await work.configureObsidian({ cwd, vault, project: "project-a" });
		await writeFile(join(vault, "Wiki/Index.md"), "# 研究主题\n\n[[Wiki/Topic]]\n");
		await writeFile(
			join(vault, "Wiki/Topic.md"),
			"# 自切行为研究\n\n人工背景：不同物种需要分别验证。\n\n<!-- pi-agent:managed:start -->\n现有记录尚不足以作出机制结论。\n<!-- pi-agent:managed:end -->\n\n## Human review\n保留人工复核：先核对实验条件。\n",
		);
		await writeFile(
			join(vault, "Library/Papers/source.md"),
			"# 自切观察记录\n\n限定条件下的行为观察；不能直接推广到所有物种。\n\n[[Wiki/Topic|相关综述]]\n\n## Human review\n证据仍需原文核对。\n",
		);
		for (let i = 0; i < 25; i++)
			await writeFile(join(vault, `Library/Papers/fixture-${i}.md`), `# 隔离材料 ${i}\n仅供界面测试。\n`);
		const service = await services.getKnowledgeService();
		let prep = await service.prepare({ cwd, project: "project-a", query: "自切" });
		await service.request("reconcile");
		await service.read(prep.ticket, cwd, { path: "Wiki/Topic.md" });
		await service.read(prep.ticket, cwd, { path: "Library/Papers/source.md" });
		const proposal = (title) =>
			review.stageWikiProposal(service, prep.ticket, cwd, {
				path: "Wiki/Topic.md",
				title,
				markdown:
					"## 当前认识\n\n在限定实验条件下观察到自切行为。\n\n## 适用范围与未知\n\n尚不能据此确定具体神经机制，需要继续核对原文。",
				rationale: "把新观察与原先的证据不足状态并列，保留适用范围。",
				source_paths: ["Library/Papers/source.md"],
			});
		const accept = await proposal("候选 A：补充观察范围"),
			reject = await proposal("候选 B：待拒绝候选");
		const knowledge = new KnowledgeUiService();
		await knowledge.connect();
		const backend = {
			knowledge,
			startKnowledgeSetup: async (input) => actions.push({ action: "setup", input }),
			resumeKnowledgeCheck: async (input) => actions.push({ action: "resume", input }),
			prompt: async (sessionId, text) => actions.push({ action: "prompt", sessionId, text }),
		};
		// Real review host/IPC with a scripted model result. No provider request and no live Wiki approval in this GUI fixture.
		backend.reviewKnowledgeWithModel = async (input) =>
			knowledge.reviewWithModel(input, {
				check: async () => {},
				evaluate: async (request) => {
					actions.push({ action: "model-review", autoApply: input.autoApply });
					return {
						model: "fixture/offline-reviewer",
						data: {
							summary: "现有来源只覆盖有限条件，请人工核对原文。",
							source_paths: JSON.parse(request.packet).sources.map((s) => s.path),
							cautions: ["原文证据仍需人工复核。"],
							verdict: "needs-human",
							checks: {
								evidenceSupportsChanges: false,
								scopeAndUncertaintyPreserved: true,
								noUnresolvedContradictions: true,
								humanContentPreserved: true,
								noInstructionInjection: true,
							},
						},
						usage: { inputTokens: 900, outputTokens: 120, cost: 0 },
					};
				},
			});
		backend.cancelKnowledgeModelReview = async () => {};
		app.dock?.hide();
		registerKnowledgeIpc(backend);
		ipcMain.handle(IpcChannels.ProjectPickDirectory, () => join(root, "New Vault"));
		let usageReads = 0;
		ipcMain.handle(IpcChannels.SessionStats, () => {
			usageReads++;
			return {
				inputTokens: 200,
				outputTokens: 100,
				cacheReadTokens: 800,
				cacheWriteTokens: 0,
				totalTokens: usageReads > 1 ? 2200 : 1100,
				requests: usageReads > 1 ? 2 : 1,
				cost: 0,
				scope: "sdk-session",
			};
		});
		ipcMain.handle("knowledge-fixture:info", () => ({ cwd, accept: accept.id, reject: reject.id }));
		window = new BrowserWindow({
			width: 1200,
			height: 960,
			show: false,
			webPreferences: {
				preload: join(root, "preload.cjs"),
				contextIsolation: true,
				nodeIntegration: false,
				sandbox: false,
				offscreen: true,
				backgroundThrottling: false,
			},
		});
		window.webContents.on("console-message", (event) => {
			if (event.level === "error") errors.push(event.message);
		});
		window.webContents.on("render-process-gone", (_event, detail) =>
			errors.push(`renderer gone: ${detail.reason}`),
		);
		const js = (code) => window.webContents.executeJavaScript(code, true);
		const wait = async (test, label) => {
			for (let i = 0; i < 160; i++) {
				if (await js(`Boolean(${test})`)) return;
				await pause(50);
			}
			throw new Error(`UI timeout: ${label} / ${await js("document.body.innerText.slice(0,3000)")}`);
		};
		const click = async (text, scope = "document") => {
			const ok = await js(
				`(()=>{const root=${scope};const button=[...root.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled);if(!button)return false;button.click();return true;})()`,
			);
			assert(ok, `Enabled button: ${text}`);
		};
		const capture = async (name) => {
			await pause(120);
			await writeFile(join(screenshots, `${name}.png`), (await window.webContents.capturePage()).toPNG());
		};
		await window.loadFile(join(root, "dist/index.html"));
		await wait("document.body.innerText.includes('Research Vault')", "real overview");
		await pause(900);
		assert(await js(`document.body.innerText.includes(${JSON.stringify(vault)})`));
		assert(await js("document.body.innerText.includes('文献库 · Zotero')"));
		checks.push("actual Vault and indexed counts rendered");
		checks.push("Zotero literature card is visible on knowledge overview");
		await capture("01-overview-light");
		await wait(
			"document.querySelector('[data-testid=knowledge-specialists-settings] select')",
			"specialist policy controls",
		);
		await wait(
			"document.querySelectorAll('[data-testid=knowledge-specialist-cards] article').length===5",
			"five protected specialist cards",
		);
		assert(
			await js(
				"document.querySelector('[data-testid=knowledge-specialists-settings]').innerText.includes('knowledge-wiki-editor')",
			),
		);
		assert(
			await js(
				"document.querySelector('[data-testid=knowledge-specialists-settings]').innerText.includes('fixture/research-model')||[...document.querySelectorAll('[data-testid=knowledge-specialists-settings] select')].some(s=>s.value==='fixture/research-model')",
			),
		);
		assert(
			await js(
				"[...document.querySelectorAll('[data-testid=knowledge-specialists-settings] select')].some(s=>s.value==='high')",
			),
		);
		await js(
			"(()=>{const select=document.querySelector('[data-testid=knowledge-specialists-settings] select');select.value='off';select.dispatchEvent(new Event('change',{bubbles:true}));})()",
		);
		await wait(
			"document.querySelector('[data-testid=knowledge-specialists-settings] select').value==='off'&&!document.querySelector('[data-testid=knowledge-specialists-settings] select').disabled",
			"persist off mode",
		);
		assert.equal(JSON.parse(await readFile(join(root, "app-state/specialists.json"), "utf8")).mode, "off");
		await js(
			"(()=>{const select=document.querySelector('[data-testid=knowledge-specialists-settings] select');select.value='automatic';select.dispatchEvent(new Event('change',{bubbles:true}));})()",
		);
		await wait(
			"document.querySelector('[data-testid=knowledge-specialists-settings] select').value==='automatic'&&!document.querySelector('[data-testid=knowledge-specialists-settings] select').disabled",
			"restore automatic mode",
		);
		checks.push(
			"four specialist roles, explicit model-cost and permission information; real IPC mode change persists without calling a model",
		);
		await capture("06-specialist-settings");
		await wait(
			"document.querySelector('[data-testid=tools-skills-overview]')",
			"Tools & Skills capability overview",
		);
		assert(
			await js("document.querySelector('[data-testid=tools-skills-overview]').innerText.includes('23%')"),
		);
		assert(
			await js(
				"document.querySelector('[data-testid=tools-skills-fixture]').innerText.includes('research_search_knowledge')",
			),
		);
		checks.push("Tools & Skills shows active/lazy/always-on registry metadata and measured schema footprint");
		await capture("07-tools-skills");
		await wait("document.querySelector('[data-testid=run-inspector]')", "Run Inspector");
		await js("document.querySelector('[data-testid=run-inspector]').open=true");
		assert(
			await js(
				"document.querySelector('[data-testid=run-inspector]').innerText.includes('research_check_answer')",
			),
		);
		assert(
			await js(
				"document.querySelector('[data-testid=run-inspector]').innerText.includes('Library/Papers/source.md')",
			),
		);
		assert(
			await js("!document.querySelector('[data-testid=run-inspector]').innerText.includes('PRIVATE_CHAIN')"),
		);
		assert(await js("document.querySelector('[data-testid=run-retrievals]').innerText.includes('词法候选')"));
		assert(
			await js(
				"document.querySelector('[data-testid=run-diagnostics]').innerText.includes('session-token-budget')",
			),
		);
		checks.push(
			"Run Inspector shows observable models/stages/tools/subagents/reads/artifacts/publication gate without private thinking",
		);
		await capture("07-run-inspector");
		await wait(
			"document.querySelector('[data-testid=session-usage]').innerText.includes('80.0%')",
			"SDK cumulative usage footer",
		);
		assert(usageReads >= 1);
		const initialUsageReads = usageReads;
		await js("window.knowledgeUsageBoundary();true");
		await wait(
			"document.querySelector('[data-testid=session-usage]').innerText.includes('2.2k')",
			"same-session completed-response usage refresh",
		);
		assert(usageReads > initialUsageReads, "stats IPC refreshed without changing session ID");
		checks.push("session total refreshes at a new committed response within the same session");
		assert(await js("document.querySelector('[data-testid=turn-usage]').innerText.includes('80.0%')"));
		await js(
			"document.querySelector('[data-testid=turn-usage]').open=true;document.querySelector('[data-testid=session-usage]').open=true;document.querySelector('[data-testid=usage-progress-fixture]').scrollIntoView({block:'center'});true",
		);
		await wait(
			"document.querySelector('[data-testid=session-usage]').innerText.includes('未提供有效计价')",
			"zero cost not mistaken for free",
		);
		await capture("08-usage-and-public-progress");
		checks.push(
			"per-turn settlement and cumulative SDK stats IPC render correct 80% token-weighted cache ratio; zero cost is not called free; public progress is visibly separate (usage fixture data)",
		);

		await click("预览目录与模板");
		await wait(
			"document.body.innerText.includes('笔记模板正文')&&document.body.innerText.includes('Templates/Source.md')",
			"preview without a new path",
		);
		checks.push("existing binding supplies default preview and actual template bodies");
		await click("选择文件夹");
		await click("预览目录与模板");
		await wait("document.body.innerText.includes('内置模板预览')", "directory preview");
		await assert.rejects(readFile(join(root, "New Vault", "Home.md")));
		checks.push("folder selection and read-only template preview");
		await click("开始初始化问答");
		assert.equal(actions[0].action, "setup");
		assert.equal(actions[0].input.path, join(root, "New Vault"));
		checks.push("setup UI routes selected path into the bound skill entry");
		await click("索引与维护");
		await wait(
			"document.querySelector('[data-testid=knowledge-maintenance]')&&document.body.innerText.includes('隔离')",
			"maintenance tab",
		);
		await pause(150);
		await click("下一页");
		checks.push("maintenance page navigation");
		await click("核对目录 / 重试索引");
		await wait("document.body.innerText.includes('维护操作已完成')", "real maintenance");
		checks.push("real backend reconciliation completed");
		await click("Wiki 审核");
		await wait("document.body.innerText.includes('候选 A')", "proposal list");
		// Candidate selection is a real DOM click, not an application-state override.
		await js("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('候选 A')).click()");
		await wait(
			"document.body.innerText.includes('修改前托管区')||document.body.innerText.includes('现有记录尚不足')",
			"diff loaded",
		);
		await pause(400);
		assert(
			await js(
				"[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='应用已查看的候选').disabled",
			),
		);
		checks.push("approval disabled before explicit review acknowledgment");
		await capture("02-wiki-diff-light");
		// Real background index invalidation may make the preview stale; exercise the visible refresh rather than bypass it.
		if (await js("document.querySelector('[data-testid=wiki-model-review] button').disabled"))
			await click("重新加载预览");
		await wait(
			"document.querySelector('[data-testid=wiki-model-review] button')&&!document.querySelector('[data-testid=wiki-model-review] button').disabled",
			"fresh model-review preview",
		);
		await click("模型自动审核");
		assert(
			await js(
				"[...document.querySelectorAll('[data-testid=wiki-model-review] button')].find(b=>b.textContent==='开始审核').disabled",
			),
		);
		assert(
			await js(
				"[...document.querySelectorAll('[data-testid=wiki-model-review] input')].every(b=>!b.checked)",
			),
		);
		await js("document.querySelector('[data-testid=wiki-model-review] input').click()");
		await click("开始审核");
		await wait(
			"document.querySelector('[data-testid=wiki-model-review-result]')?.innerText.includes('需要人工审核')",
			"model review verdict and audit panel",
		);
		await wait(
			"document.querySelector('[data-testid=wiki-model-review-usage]')?.innerText.includes('1.0k tokens')&&document.querySelector('[data-testid=wiki-model-review-usage]')?.innerText.includes('未提供有效计价')",
			"model review usage receipt",
		);
		assert.equal(actions.find((a) => a.action === "model-review").autoApply, false);
		assert((await readFile(join(vault, "Wiki/Topic.md"), "utf8")).includes("现有记录尚不足"));
		await js(
			"document.querySelector('[data-testid=wiki-model-review]').scrollIntoView({block:'center'});true",
		);
		await capture("13-wiki-model-review");
		checks.push(
			"model review button uses explicit cost acknowledgment; auto-apply unchecked; real preview/IPC/audit shows 1.0k token receipt and unknown pricing honestly; scripted needs-human result leaves Wiki unchanged",
		);

		await click("受保护的人工内容");
		assert(await js("document.body.innerText.includes('保留人工复核')"));
		checks.push("human text visibly protected");
		await click("修改差异");
		await click("读取来源");
		await wait(
			"document.querySelector('[data-testid=knowledge-note]')&&document.body.innerText.includes('证据仍需原文核对')",
			"source reader",
		);
		checks.push("actual source lines and human review loaded");
		await wait("document.querySelector('[data-testid=knowledge-note] a[href]')", "clickable Vault reference");
		await js("document.querySelector('[data-testid=knowledge-note] a[href]').click()");
		await wait(
			"document.querySelector('[role=dialog] [data-testid=knowledge-note]')&&document.querySelector('[role=dialog]').innerText.includes('Wiki/Topic.md')",
			"click opens current scoped Wiki note",
		);
		await js("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
		await wait("!document.querySelector('[role=dialog]')", "close note");
		checks.push("existing Vault wikilinks render and open actual scoped notes");

		checks.push(
			"graphical smoke stops before approval; write/conflict paths are covered by isolated backend tests",
		);
		state.requestWikiReviewUi({ sessionId: "fixture" }, "");
		await wait("document.querySelector('[role=dialog]')", "command opens dedicated modal");
		await js("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
		await wait("!document.querySelector('[role=dialog]')", "escape closes review");
		checks.push("command-to-panel bridge and Escape close");
		// Real reads/search/validation feed the same host UI state bridge.
		await service.request("reconcile");
		await pause(500);
		prep = await service.prepare({ cwd, project: "project-a", query: "自切" });
		const ctx = { sessionId: "fixture" };
		state.beginKnowledgeFlow(ctx, { vaultId: bound.vaultId, revision: bound.bindingRevision, vault });
		state.updateKnowledgeFlow(ctx, {
			phase: "navigation",
			project: "project-a",
			navigation: prep.navigation.map((p) => ({
				path: p.path,
				hash: p.hash,
				startLine: p.startLine,
				endLine: p.endLine,
				missing: !!p.missing,
			})),
		});
		state.noteKnowledgeRead(ctx, await service.read(prep.ticket, cwd, { path: "Wiki/Topic.md" }));
		const search = await service.search(prep.ticket, cwd, { query: "自切" });
		state.noteKnowledgeSearch(ctx, search, false);
		state.noteKnowledgeRead(ctx, await service.read(prep.ticket, cwd, { path: "Library/Papers/source.md" }));
		state.updateKnowledgeFlow(ctx, { phase: "checking" });
		const proof = await service.validateAnswer(prep.ticket, cwd, "限定条件的记录 [[Library/Papers/source]]");
		state.publicationKnowledgeFlow(ctx, { ...proof, status: "released" });
		await wait(
			"document.querySelector('[data-testid=knowledge-flow-card]')&&document.body.innerText.includes('发布检查通过')",
			"flow card",
		);
		await js("document.querySelector('[data-testid=knowledge-flow-card] button[aria-expanded]').click()");
		await capture("03-flow-light");
		checks.push("actual read-search-publication phases and evidence records rendered");
		await wait(
			"document.body.innerText.includes('具体检索结果')&&document.body.innerText.includes('限定条件下的行为观察')",
			"real search excerpts",
		);
		checks.push("actual matched titles and bounded excerpts visible, not just stage labels");
		assert.equal(
			await js(
				"!![...document.querySelectorAll('[data-testid=knowledge-flow-card] button')].find(b=>b.textContent.trim()==='管理知识库')",
			),
			false,
		);
		checks.push("management label removed from the flow card");
		await js("document.documentElement.dataset.theme='dark'");
		await capture("04-dark");
		checks.push("dark theme screenshot");
		window.setSize(520, 900);
		await pause(200);
		assert(
			await js("document.documentElement.scrollWidth<=window.innerWidth+1"),
			"no horizontal overflow at narrow width",
		);
		await capture("05-narrow");
		checks.push("narrow layout without document overflow");
		state.noteKnowledgeSpecialist(ctx, {
			id: "fixture-specialist",
			role: "navigator",
			name: "knowledge-navigator",
			label: "知识导航员",
			status: "running",
			action: "knowledge_search",
			model: "fixture/model",
			startedAt: Date.now(),
		});
		await wait(
			"document.querySelector('[data-testid=knowledge-flow-card]').innerText.includes('知识导航员')",
			"specialist phase shown",
		);
		state.noteKnowledgeSpecialist(ctx, {
			id: "fixture-specialist",
			role: "navigator",
			name: "knowledge-navigator",
			label: "知识导航员",
			status: "completed",
			action: "knowledge_submit",
			model: "fixture/model",
			inputTokens: 1200,
			outputTokens: 140,
			sourceCount: 2,
			sources: [
				{
					path: "Library/Papers/source.md",
					hash: "fixture-current-version",
					startLine: 1,
					endLine: 5,
					excerpt: "限定条件下的行为观察。",
				},
			],
			summary: "仅为隔离测试的交接摘要；来源范围已列出。",
			endedAt: Date.now(),
			hiddenThinking: "DO_NOT_RENDER_THOUGHTS",
		});
		await wait(
			"document.querySelector('[data-testid=knowledge-specialist-runs]').innerText.includes('1200')",
			"specialist usage and result card",
		);
		assert(!(await js("document.body.innerText.includes('DO_NOT_RENDER_THOUGHTS')")));
		checks.push(
			"compact specialist stage, result and usage render without hidden reasoning (scripted worker event; real UI)",
		);
		await capture("07-specialist-runs-narrow");

		window.setSize(1200, 960);
		await js(
			"document.documentElement.dataset.theme='light';document.querySelector('#stage-timeline-fixture').style.display='block';window.stageTimelineFixture.start();window.stageTimelineFixture.first();true",
		);
		await wait(
			"document.querySelector('#stage-timeline-fixture [data-testid=progress-note]')?.innerText.includes('先定位主题')",
			"public stage visible before its tools finish",
		);
		const timelineOrder = () =>
			js(
				"[...document.querySelector('#stage-timeline-fixture').querySelectorAll('[data-testid=progress-note],[data-testid=tool-phase-group]')].map(n=>n.dataset.testid==='progress-note'?'stage:'+n.querySelector('p').textContent:'tools')",
			);
		assert.deepEqual(await timelineOrder(), ["stage:先定位主题和已有证据", "tools"]);
		await js("window.stageTimelineFixture.next();true");
		await wait(
			"document.querySelectorAll('#stage-timeline-fixture [data-testid=progress-note]').length===2",
			"next stage visible without waiting for entire run",
		);
		assert.deepEqual(await timelineOrder(), [
			"stage:先定位主题和已有证据",
			"tools",
			"stage:补查缺失的软件参数",
			"tools",
		]);
		await js(
			"window.stageTimelineFixture.done();document.querySelector('#stage-timeline-fixture').scrollIntoView({block:'center'});true",
		);
		await wait(
			"document.querySelector('#stage-timeline-fixture').innerText.includes('本轮交付说明')",
			"final reply remains after phase summary",
		);
		const expectedTimeline = [
			"stage:先定位主题和已有证据",
			"tools",
			"stage:补查缺失的软件参数",
			"tools",
			"stage:本阶段小结：明确已知与缺口",
		];
		assert.deepEqual(await timelineOrder(), expectedTimeline);
		await js(
			"document.querySelectorAll('#stage-timeline-fixture [data-testid=tool-phase-group] details').forEach(n=>n.open=true);true",
		);
		assert.deepEqual(await timelineOrder(), expectedTimeline);
		await js(
			"(()=>{const root=document.querySelector('#stage-timeline-fixture');for(const node of root.parentElement.children)if(node!==root)node.style.display='none';for(const group of root.querySelectorAll('[data-testid=tool-phase-group]')){const details=[...group.querySelectorAll('details')];details.forEach(d=>d.open=false);if(details.length>1)details[0].open=true;}root.scrollIntoView({block:'start'});const scroll=root.querySelector('.chat-scrollbar');if(scroll){scroll.scrollTop=0;scroll.dispatchEvent(new Event('scroll'));}return true;})()",
		);
		await capture("09-ordered-stage-timeline");
		window.setSize(520, 980);
		await pause(400);
		await js("document.querySelector('#stage-timeline-fixture').scrollIntoView({block:'center'});true");
		assert(
			await js("document.documentElement.scrollWidth<=window.innerWidth+1"),
			"timeline no horizontal overflow",
		);
		assert.deepEqual(await timelineOrder(), expectedTimeline);
		await capture("10-ordered-stage-timeline-narrow");
		checks.push(
			"actual MessageList shows live completed public summary before its tools, then next summary/tools and stage summary; finalization, expand/collapse and narrow width preserve order (scripted public tool results, no raw reasoning)",
		);

		await js(
			"window.sidebarFixture.begin();document.querySelector('#stage-timeline-fixture').style.display='none';document.querySelector('[data-testid=sidebar-actions-fixture]').style.display='block';document.querySelector('[data-testid=sidebar-actions-fixture]').classList.remove('hidden');document.querySelector('[data-testid=sidebar-actions-fixture]').scrollIntoView({block:'center'});document.documentElement.dataset.theme='light';true",
		);
		await wait(
			"document.querySelector('[data-testid=project-sidebar-actions] > button:nth-child(2)').textContent.trim()==='Obsidian'",
			"visible Obsidian sidebar label",
		);
		const actionGeometry = () =>
			js(
				"[...document.querySelector('[data-testid=project-sidebar-actions]').children].map(b=>{const r=b.getBoundingClientRect(),i=b.querySelector('svg').getBoundingClientRect(),t=b.querySelector('span').getBoundingClientRect();return {tag:b.tagName,label:b.textContent.trim(),x:r.x,y:r.y,width:r.width,height:r.height,iconX:i.x,iconWidth:i.width,textX:t.x};})",
			);
		const aligned = (rows) => {
			assert.equal(rows.length, 3);
			for (const row of rows) {
				assert.equal(row.tag, "BUTTON");
				assert(row.width > 180 && row.height >= 28, "sidebar row must be visible and full width");
				for (const k of ["x", "width", "height", "iconX", "iconWidth", "textX"])
					assert(Math.abs(row[k] - rows[0][k]) < 0.5, `equal sidebar ${k}`);
			}
			assert.equal(rows[1].label, "Obsidian");
		};
		aligned(await actionGeometry());
		// Offscreen windows are not OS-focused. Drive Chromium's real input with focus emulation; do not steal the user's active application.
		window.webContents.debugger.attach("1.3");
		await window.webContents.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
		await js(
			"window.sidebarFixture.reset();document.querySelector('[data-testid=project-sidebar-actions] > button').focus();true",
		);
		await window.webContents.debugger.sendCommand("Input.dispatchKeyEvent", {
			type: "keyDown",
			key: "Tab",
			code: "Tab",
			windowsVirtualKeyCode: 9,
		});
		await window.webContents.debugger.sendCommand("Input.dispatchKeyEvent", {
			type: "keyUp",
			key: "Tab",
			code: "Tab",
			windowsVirtualKeyCode: 9,
		});
		await wait(
			"document.activeElement?.dataset.testid==='obsidian-shortcut'",
			"sidebar keyboard focus order",
		);
		await window.webContents.debugger.sendCommand("Input.dispatchKeyEvent", {
			type: "keyDown",
			key: "Enter",
			code: "Enter",
			windowsVirtualKeyCode: 13,
			text: "\r",
			unmodifiedText: "\r",
		});
		await window.webContents.debugger.sendCommand("Input.dispatchKeyEvent", {
			type: "keyUp",
			key: "Enter",
			code: "Enter",
			windowsVirtualKeyCode: 13,
		});
		await wait(
			"window.sidebarFixture.state().open&&window.sidebarFixture.state().category==='knowledge'",
			"Enter opens knowledge settings",
		);
		await js("window.sidebarFixture.reset();true");
		const middle = (await actionGeometry())[1];
		await window.webContents.debugger.sendCommand("Input.dispatchMouseEvent", {
			type: "mousePressed",
			x: Math.floor(middle.x + middle.width - 4),
			y: Math.floor(middle.y + middle.height / 2),
			button: "left",
			clickCount: 1,
		});
		await window.webContents.debugger.sendCommand("Input.dispatchMouseEvent", {
			type: "mouseReleased",
			x: Math.floor(middle.x + middle.width - 4),
			y: Math.floor(middle.y + middle.height / 2),
			button: "left",
			clickCount: 1,
		});
		await wait(
			"window.sidebarFixture.state().open&&window.sidebarFixture.state().category==='knowledge'",
			"full row right edge opens knowledge settings",
		);
		checks.push(
			"real sidebar Settings/Obsidian/Help rows have equal measured hit rectangles, icon and text alignment; visible Obsidian name; Tab/Enter and far-right click open knowledge settings",
		);
		await capture("11-sidebar-aligned-light");
		await js("window.sidebarFixture.language('en');document.documentElement.dataset.theme='dark';true");
		await wait(
			"document.querySelector('[data-testid=project-sidebar-actions]').innerText.includes('Help')",
			"English sidebar",
		);
		aligned(await actionGeometry());
		assert(
			await js("document.documentElement.scrollWidth<=window.innerWidth+1"),
			"sidebar no narrow-window overflow",
		);
		checks.push("sidebar geometry remains equal in English/dark at narrow window width");
		await capture("12-sidebar-aligned-dark");
		await js("window.sidebarFixture.end();true");
		window.webContents.debugger.detach();

		assert.equal(errors.length, 0, "renderer errors");
		await writeFile(
			join(root, "validation.json"),
			JSON.stringify(
				{
					passed: true,
					writeApprovalClicked: false,
					checks,
					consoleErrors: errors,
					screenshots,
					setupProviderCalled: false,
					folderPicker: "scripted selection; actual UI and backend preview",
					realKnowledgeApis: true,
					realElectron: true,
				},
				null,
				2,
			),
		);
		assert.equal(errors.length, 0, "renderer errors");
		console.log(JSON.stringify({ passed: true, checks, root, screenshots }));
		knowledge.dispose();
		await services.closeKnowledgeServices();
		window.destroy();
		app.quit();
	} catch (error) {
		console.error(error.stack || error);
		try {
			await writeFile(
				join(root, "failure.json"),
				JSON.stringify({ error: String(error), checks, errors }, null, 2),
			);
			if (window)
				await writeFile(join(root, "failure.png"), (await window.webContents.capturePage()).toPNG());
		} catch {}
		await services?.closeKnowledgeServices?.();
		app.exit(1);
	}
}
app
	.whenReady()
	.then(run)
	.catch((error) => {
		console.error(error);
		app.exit(1);
	});
