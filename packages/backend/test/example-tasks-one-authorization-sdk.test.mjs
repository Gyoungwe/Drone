import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { activeExampleTaskMilestones, composeExampleTaskPrompt, exampleTask } from "@drone/shared";
import { fauxToolCall as call, fauxProvider, fauxAssistantMessage as reply } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { expect, it, vi } from "vitest";
import { closeKnowledgeServices } from "../../../.pi/lib/knowledge/service.mjs";
import { PiBackend } from "../src/pi-backend";

/**
 * 六方向示例任务 · 一次授权闭环（真实 SDK 端到端模拟）。
 *
 * 模拟用户：从示例卡发起任务，只在任务授权卡上点一次「同意本次请求」。此后出现的任何弹窗、
 * 权限确认、任务面板操作或再补一句「继续」，都记为一次中断。
 * 模拟模型：像真实模型那样分多个回合工作——先只读准备，再 task_plan；每返回一个副作用
 * （写文件 / 命令 / Zotero 写入 / task_wait）就以一句状态话结束本回合。这是最容易产生
 * 断点的节奏：每一次回合结束都必须由宿主自动接续，而不是等用户。
 */

const PAPERS = [
	{
		doi: "10.1000/gut-pd.2021.001",
		title: "Gut microbiome signatures in prodromal Parkinson's disease",
		creators: [{ last_name: "Doe", first_name: "Jane" }],
		date: "2021",
		publication: "Journal of Examples",
	},
	{
		doi: "10.1000/gut-pd.2023.002",
		title: "Short-chain fatty acids and early Parkinson's diagnosis",
		creators: [{ last_name: "Roe", first_name: "Richard" }],
		date: "2023",
		publication: "Journal of Examples",
	},
];
const SCENARIOS = [
	{
		id: "planning-hypotheses",
		values: { question: "睡眠剥夺是否通过炎症通路影响工作记忆？", background: "" },
	},
	{
		id: "evidence-literature",
		values: { topic: "肠道菌群与帕金森病早期诊断", years: "2019–2025", zotero: "no" },
	},
	{
		id: "evidence-literature",
		label: "evidence-literature (zotero=yes)",
		values: { topic: "肠道菌群与帕金森病早期诊断", years: "2019–2025", zotero: "yes" },
		zotero: true,
	},
	{
		id: "analysis-explore",
		values: { data: "data.csv", question: "treatment 组与 control 组的 score 是否有差异" },
		fixtures: { "data.csv": "group,score\ntreatment,1.2\ncontrol,0.8\n" },
		shell: "echo quality-check-ok",
	},
	{
		id: "writing-section",
		values: { section: "Introduction", material: "", venue: "" },
	},
	{
		id: "presentation-figures",
		values: { results: "results.csv", format: "pptx" },
		fixtures: { "results.csv": "condition,mean,sd\nA,1.0,0.1\nB,1.4,0.2\n" },
		shell: "echo figures-rendered",
	},
	{
		id: "engineering-handoff",
		values: { project: ".", recipient: "" },
		shell: "echo inventory-only",
	},
];
const EFFECT_TOOLS = new Set(["write", "bash", "research_zotero_save", "task_wait"]);

/** 示例里程碑 → task_plan 契约：file 用建议文件名；zotero_item 每篇一条、DOI 留空；human_review 原样。 */
function contractFor(task, values) {
	const milestones = [];
	for (const m of activeExampleTaskMilestones(task, values)) {
		if (m.acceptance.kind === "zotero_item") {
			for (const [i, paper] of PAPERS.entries())
				milestones.push({
					id: `m${milestones.length + 1}`,
					title: `${m.title.zh} · 第 ${i + 1} 篇`,
					acceptance: { kind: "zotero_item" },
					paper,
				});
			continue;
		}
		const hint = m.acceptance.hint || `deliverable-${milestones.length + 1}.md`;
		const path = hint.endsWith("/") ? `${hint}figure-1.svg` : hint;
		milestones.push({
			id: `m${milestones.length + 1}`,
			title: m.title.zh,
			acceptance: m.acceptance.kind === "file" ? { kind: "file", path } : { kind: m.acceptance.kind },
			path: m.acceptance.kind === "file" ? path : null,
		});
	}
	return milestones;
}
function contentFor(path, title) {
	if (path.endsWith(".svg"))
		return `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><title>${title}</title></svg>\n`;
	return `# ${title}\n\n模拟模型在授权范围内生成的交付内容。\n`;
}
const textOf = (message) =>
	(message?.content || [])
		.filter((b) => b.type === "text")
		.map((b) => b.text)
		.join(" ");

/** 脚本化模型：按上下文推断下一步；每个副作用返回后先结束回合（真实模型的常见节奏）。 */
function scriptedModel(task, scenario, contract) {
	const plan = {
		goal: task.goal.zh,
		summary: `${task.title.zh}：${task.goal.zh}`,
		writeDirectories: ["."],
		milestones: contract.map(({ id, title, acceptance }) => ({ id, title, acceptance })),
	};
	const steps = [];
	if (scenario.shell)
		steps.push({
			label: "bash",
			matches: (tc) => tc.name === "bash",
			calls: () => [call("bash", { command: scenario.shell })],
		});
	for (const m of contract.filter((m) => m.path))
		steps.push({
			label: `write ${m.path}`,
			matches: (tc) => tc.name === "write" && tc.arguments?.path === m.path,
			calls: () => [call("write", { path: m.path, content: contentFor(m.path, m.title) })],
		});
	const zotero = contract.filter((m) => m.paper);
	if (zotero.length)
		steps.push({
			label: "zotero batch",
			matches: (tc) => tc.name === "research_zotero_save",
			// 一次并行批量写入（真实模型常这么做）：每篇一条，DOI 到此时才知道
			calls: () => zotero.map((m) => call("research_zotero_save", { ...m.paper })),
			done: (calls, ok) =>
				zotero.every((m) =>
					calls.some(
						(tc) => tc.name === "research_zotero_save" && tc.arguments?.doi === m.paper.doi && ok(tc),
					),
				),
		});
	for (const m of contract.filter((m) => m.acceptance.kind === "human_review"))
		steps.push({
			label: `review ${m.id}`,
			matches: (tc) => tc.name === "task_wait" && tc.arguments?.milestoneId === m.id,
			calls: () => [
				call("task_wait", {
					kind: "review",
					title: `请过目：${m.title}`,
					reason: "这一项约定由你亲自看过才算完成",
					milestoneId: m.id,
				}),
			],
		});
	const decide = (context) => {
		const messages = context.messages;
		const calls = [];
		for (const m of messages)
			if (m.role === "assistant") for (const b of m.content) if (b.type === "toolCall") calls.push(b);
		const results = new Map();
		for (const m of messages) if (m.role === "toolResult") results.set(m.toolCallId, m);
		const ok = (tc) => {
			const r = results.get(tc.id);
			return !!r && !r.isError;
		};
		const last = messages[messages.length - 1];
		// 真实模型看到工具不在当前可见集合里时，会先 capability_load（宿主按需暴露工具，不算中断）
		const visible = new Set((context.tools || []).map((t) => t.name));
		const needed = ["write", ...(scenario.shell ? ["bash"] : [])];
		if (needed.some((name) => !visible.has(name)))
			return reply([call("capability_load", { capabilities: ["coding", "files"], task: task.title.zh })], {
				stopReason: "toolUse",
			});
		const planCall = calls.find((tc) => tc.name === "task_plan");
		if (!planCall) return reply([call("task_plan", plan)], { stopReason: "toolUse" });
		if (!/"authorized":true/.test(textOf(results.get(planCall.id))))
			return reply("没有获得授权，任务停在原地，不改动任何文件。");
		if (last?.role === "toolResult" && EFFECT_TOOLS.has(last.toolName))
			return reply(`这一步（${last.toolName}）已经返回；剩余交付接着做。`);
		for (const step of steps) {
			const attempts = calls.filter(step.matches);
			const finished = step.done ? step.done(calls, ok) : attempts.some(ok);
			if (finished) continue;
			if (attempts.length >= 2) return reply(`${step.label} 连续失败两次，停止重试，等待说明。`);
			return reply(step.calls(), { stopReason: "toolUse" });
		}
		const lastEffect = Math.max(-1, ...calls.map((tc, i) => (EFFECT_TOOLS.has(tc.name) ? i : -1)));
		if (!calls.some((tc, i) => tc.name === "task_status" && i > lastEffect && ok(tc)))
			return reply([call("task_status", {})], { stopReason: "toolUse" });
		return reply("约定的交付都已完成，文件都在项目目录里。");
	};
	return (context) => {
		const response = decide(context);
		if (process.env.ONE_AUTH_DEBUG) {
			const trail = context.messages
				.map((m) =>
					m.role === "toolResult"
						? `R:${m.toolName}${m.isError ? "!" : ""}`
						: m.role === "assistant"
							? `A:${m.content.map((b) => (b.type === "toolCall" ? b.name : "text")).join("+")}`
							: `${m.role}:${m.customType || ""}`,
				)
				.join(" ");
			const chosen = response.content
				.map((b) => (b.type === "toolCall" ? b.name : `text(${b.text.slice(0, 30)})`))
				.join("+");
			const errors = context.messages
				.filter((m) => m.role === "toolResult" && m.isError)
				.map((m) => `${m.toolName}: ${textOf(m).slice(0, 300)}`);
			console.log(
				`DECIDE [${trail}] -> ${chosen}${errors.length ? `\n  ERRORS: ${errors.join(" | ")}` : ""}`,
			);
		}
		return response;
	};
}

/** 本地 Zotero 连接器桩：按 DOI 保存、按 DOI 读回（与 zotero-save-tool 测试同形）。 */
function zoteroConnectorStub(saved) {
	return async (url, init = {}) => {
		const u = new URL(String(url));
		const json = (body, status = 200, headers = {}) =>
			new Response(JSON.stringify(body), {
				status,
				headers: { "Content-Type": "application/json", ...headers },
			});
		if (u.pathname === "/connector/ping") return json({});
		if (u.pathname === "/connector/getSelectedCollection")
			return json({
				libraryID: 1,
				libraryName: "My Library",
				libraryEditable: true,
				editable: true,
				id: null,
				name: "My Library",
			});
		if (u.pathname === "/connector/saveItems") {
			const body = JSON.parse(String(init.body || "{}"));
			for (const item of body.items || []) {
				const doi = String(item.DOI || "").toLowerCase();
				const key = `K${saved.size + 1}`.padEnd(8, "Z");
				saved.set(doi, {
					key,
					data: { key, title: item.title, itemType: "journalArticle", DOI: item.DOI, collections: [] },
				});
			}
			return json({ items: [] }, 201);
		}
		if (u.pathname === "/api/users/0/items") {
			const q = (u.searchParams.get("q") || "").toLowerCase();
			const items = [...saved.values()].filter((i) => !q || i.data.DOI.toLowerCase() === q);
			return json(items, 200, { "Total-Results": String(items.length) });
		}
		if (u.pathname.endsWith("/children")) return json([], 200, { "Total-Results": "0" });
		return new Response("not found", { status: 404 });
	};
}

async function settle(session) {
	// 自动接续在 agent_end 后由 setTimeout(0)+空闲轮询启动；等到会话真正安静下来。
	for (;;) {
		await vi.waitFor(() => expect(session.isStreaming).toBe(false), { timeout: 30000, interval: 20 });
		await new Promise((r) => setTimeout(r, 350));
		if (!session.isStreaming) return;
	}
}
function latestTask(session) {
	const view = [...session.messages].reverse().find((m) => m.details?.taskView)?.details.taskView;
	if (!view) return null;
	return view.tasks.find((t) => t.id === view.activeTaskId) || view.tasks[view.tasks.length - 1] || null;
}

it.each(SCENARIOS.map((s) => ({ ...s, label: s.label || s.id })))(
	"$label: one authorization card, then the task completes without further interruptions",
	async (scenario) => {
		const task = exampleTask(scenario.id);
		const root = await realpath(await mkdtemp(join(tmpdir(), "drone-one-auth-")));
		let backend;
		const metrics = { asks: [], permissions: [], panelActions: 0, nudges: 0 };
		try {
			const cwd = join(root, "project"),
				agentDir = join(root, "agent");
			await mkdir(cwd);
			await mkdir(agentDir);
			for (const [name, content] of Object.entries(scenario.fixtures || {})) {
				await mkdir(dirname(join(cwd, name)), { recursive: true });
				await writeFile(join(cwd, name), content);
			}
			vi.stubEnv("DRONE_KNOWLEDGE_DIR", join(root, "app"));
			vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
			vi.stubEnv("PI_RESEARCH_DESKTOP_CONFIG", undefined);
			vi.stubEnv("ZOTERO_API_KEY", undefined);
			const saved = new Map();
			const network = vi.spyOn(globalThis, "fetch").mockImplementation(
				scenario.zotero
					? zoteroConnectorStub(saved)
					: () => {
							throw new Error("Network forbidden in fixture");
						},
			);
			const runtime = await ModelRuntime.create({
				authPath: join(agentDir, "auth.json"),
				modelsPath: null,
				modelsStorePath: join(agentDir, "cache.json"),
				allowModelNetwork: false,
				refreshOnCreate: false,
			});
			const faux = fauxProvider({ provider: "one-auth-fixture" });
			runtime.registerNativeProvider(faux.provider);
			vi.spyOn(runtime, "hasConfiguredAuth").mockReturnValue(true);
			backend = new PiBackend({
				projectTrust: true,
				webFetch: false,
				subagentPreferBuiltin: false,
				desktopIntegration: {
					appendSystemPrompt: [],
					additionalExtensionPaths: [
						resolve("../../.pi/extensions/obsidian-workbench.mjs"),
						...(scenario.zotero ? [resolve("../../.pi/extensions/zotero-literature.mjs")] : []),
					],
					additionalSkillPaths: [],
				},
			});
			backend.modelRuntime = runtime;
			// 模拟用户：第一张卡（任务授权）同意；之后每一次弹窗都是一次中断，选最能推进的选项让流程走完。
			backend.onAskRequest((req) => {
				const options = (req.questions?.[0]?.options || []).map((o) => o.value);
				metrics.asks.push({ title: req.title || req.toolCallId, options });
				const pick =
					["同意本次请求", "接着做完剩下的", "我已亲自看过这些内容", "提交所需文件"].find((o) =>
						options.includes(o),
					) || options[options.length - 1];
				queueMicrotask(() =>
					backend.respondAsk(req.id, {
						kind: "answer",
						mode: "submit",
						answers: { value: { values: [pick] } },
					}),
				);
			});
			backend.onPermissionRequest((req) => {
				metrics.permissions.push(req.title);
				queueMicrotask(() => backend.respondPermission(req.id, "allow"));
			});
			const meta = await backend.createSession({
				cwd,
				provider: faux.provider.id,
				modelId: faux.getModel().id,
			});
			const session = backend.registry.get(meta.sessionId).session;
			const contract = contractFor(task, scenario.values);
			faux.setResponses(Array.from({ length: 80 }, () => scriptedModel(task, scenario, contract)));
			// 示例卡发出的那条首条消息（去掉 /skill 前缀：技能展开与授权链路无关）
			const prompt = composeExampleTaskPrompt(task, scenario.values, "zh").replace(/^\/\S+\s*/, "");
			await session.prompt(prompt, { expandPromptTemplates: false });
			let current = null;
			for (let round = 0; round < 8; round++) {
				await settle(session);
				current = latestTask(session);
				if (process.env.ONE_AUTH_DEBUG)
					console.log(
						`ROUND ${round}: state=${current?.state} reason=${current?.reason} pending=${current?.actions
							.filter((a) => a.state === "pending")
							.map((a) => a.kind)
							.join(
								",",
							)} asks=${metrics.asks.length} milestones=${current?.milestones.map((m) => `${m.id}:${m.state}`).join(",")}`,
					);
				if (!current || current.state === "completed") break;
				if (current.actions.some((a) => a.state === "pending")) {
					// 用户只能打开任务面板 →「推进剩余事项」→ 在弹窗里确认
					metrics.panelActions++;
					const view = [...session.messages].reverse().find((m) => m.details?.taskView)?.details.taskView;
					const command = Buffer.from(
						JSON.stringify({ taskId: current.id, revision: view.revision, action: "progress" }),
					).toString("base64url");
					await backend.prompt(meta.sessionId, `/task-action ${command}`);
					continue;
				}
				// 没有弹窗、没有待办，任务却停了：用户只能再说一句「继续」
				metrics.nudges++;
				await session.prompt("继续", { expandPromptTemplates: false });
			}
			const summary = {
				scenario: scenario.label || scenario.id,
				asks: metrics.asks.map((a) => a.title),
				permissions: metrics.permissions,
				panelActions: metrics.panelActions,
				nudges: metrics.nudges,
				providerCalls: faux.state.callCount,
				state: current?.state,
				milestones: `${current?.milestones.filter((m) => m.state === "completed").length}/${current?.milestones.length}`,
				reason: current?.reason,
			};
			console.log(`ONE-AUTH ${JSON.stringify(summary)}`);
			if (!scenario.zotero) expect(network).not.toHaveBeenCalled();
			for (const m of contract.filter((m) => m.path))
				expect(await readFile(join(cwd, m.path), "utf8")).toContain(m.title);
			// 一次授权：唯一的弹窗是任务授权卡；没有权限确认、没有面板操作、不用再说「继续」。
			expect(metrics.asks.map((a) => a.title)).toEqual([expect.stringContaining("开始执行这个任务")]);
			expect(metrics.permissions).toEqual([]);
			expect(metrics.panelActions).toBe(0);
			expect(metrics.nudges).toBe(0);
			expect(current?.state).toBe("completed");
			expect(current.milestones.every((m) => m.state === "completed")).toBe(true);
			if (scenario.zotero) expect(saved.size).toBe(PAPERS.length);
		} finally {
			backend?.dispose();
			await closeKnowledgeServices();
			vi.restoreAllMocks();
			vi.unstubAllEnvs();
			await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
		}
	},
	120000,
);
