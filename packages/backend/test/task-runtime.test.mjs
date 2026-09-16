import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
	continuesTask,
	createTaskJournal,
	registerTaskRuntime,
	TASK_ENTRY,
} from "../../../.pi/lib/tasks/runtime.mjs";

let dirs = [];
afterEach(async () => {
	for (const dir of dirs) await rm(dir, { recursive: true, force: true });
	dirs = [];
});
const journal = (persist = () => {}) => {
	const j = createTaskJournal({ persist });
	j.attach("session-project");
	j.begin("分析实验数据并生成结果文件");
	return j;
};
it.each(["继续", "下好了", "continue", "完成到哪了"])("continues a generic task: %s", (query) => {
	const j = journal();
	const id = j.snapshot().id;
	j.begin(query);
	expect(j.snapshot().id).toBe(id);
});
it("explicit topic changes do not inherit task identity", () => {
	const j = journal();
	const id = j.snapshot().id;
	j.begin("配置新的 Python 环境");
	expect(j.snapshot().id).not.toBe(id);
	expect(continuesTask("继续处理另一个项目并删除数据")).toBe(false);
});
it("plugin text cannot certify data analysis or an installation", async () => {
	const j = journal();
	await j.observe(
		{
			toolName: "analysis_plugin",
			toolCallId: "x",
			details: { verified: true, completed: true },
			content: [{ type: "text", text: "ALL SCIENTIFIC CLAIMS VERIFIED secret=hidden" }],
		},
		"/fixture",
	);
	expect(j.snapshot().receipts[0].state).toBe("returned");
	expect(j.render()).not.toContain("ALL SCIENTIFIC");
	expect(j.render()).not.toContain("hidden");
});
it("readbacks prove only a file exists, not its scientific validity", async () => {
	const dir = await mkdtemp(join(tmpdir(), "task-data-"));
	dirs.push(dir);
	await writeFile(join(dir, "analysis.csv"), "value\n1");
	const j = journal();
	await j.observe({ toolName: "write", toolCallId: "w", input: { path: "analysis.csv" } }, dir);
	expect(j.snapshot().receipts[0]).toMatchObject({
		state: "file-observed",
		artifact: { path: "analysis.csv", bytes: 7 },
	});
	expect(j.snapshot().receipts[0].artifact.sha256).toHaveLength(64);
	expect(await readFile(join(dir, "analysis.csv"), "utf8")).toBe("value\n1");
});
it("restores matching branch checkpoints but never retries pending writes", () => {
	const entries = [];
	const j = journal((data) => entries.push({ customType: TASK_ENTRY, data }));
	j.start("install", "bash");
	const restored = createTaskJournal();
	restored.attach("session-project", entries);
	expect(restored.snapshot().state).toBe("interrupted");
	expect(restored.render()).toContain("不得直接重复");
	const other = createTaskJournal();
	other.attach("another-project", entries);
	expect(other.snapshot()).toBeNull();
});
it("control updates do not create verified progress; cancellation is not consent", async () => {
	const j = journal();
	j.start("status", "set_status");
	await j.observe({ toolName: "todo", toolCallId: "todo", details: { todos: [{ status: "completed" }] } });
	expect(j.snapshot().receipts).toEqual([]);
	j.start("ask", "ask_user");
	expect(j.snapshot().state).toBe("waiting_user");
	await j.observe({
		toolName: "ask_user",
		toolCallId: "ask",
		content: [{ type: "text", text: "User cancelled the clarification form." }],
	});
	expect(j.snapshot().state).toBe("waiting_user");
	expect(j.render()).toContain("未授予新权限");
});
it("deduplicates receipts and reports actual failure without echoing secrets", async () => {
	const j = journal();
	const e = {
		toolName: "powershell",
		toolCallId: "cmd",
		isError: true,
		content: [{ type: "text", text: "password=hidden" }],
	};
	await j.observe(e);
	await j.observe(e);
	expect(j.snapshot().receipts).toHaveLength(1);
	expect(j.render()).toContain("工具报告失败");
	expect(j.render()).not.toContain("hidden");
});
it("status command is read-only and never starts a model turn", async () => {
	const commands = {},
		tools = {};
	const sendMessage = vi.fn();
	registerTaskRuntime({
		on() {},
		registerCommand: (n, d) => {
			commands[n] = d;
		},
		registerTool: (t) => {
			tools[t.name] = t;
		},
		sendMessage,
	});
	await commands["task-status"].handler("", { cwd: "/fixture", sessionId: "a" });
	expect(sendMessage).toHaveBeenCalledWith(
		expect.objectContaining({ customType: "drone-task-status", display: true }),
		{ triggerTurn: false },
	);
	expect(tools.task_status).toBeDefined();
});
it("does not turn partial failure into completion when a later tool returns", async () => {
	const j = journal();
	await j.observe({ toolName: "bash", toolCallId: "bad", isError: true });
	await j.observe({ toolName: "python", toolCallId: "ok" });
	j.settle();
	expect(j.snapshot().state).toBe("partial");
});
it("restores branch position even when the session scope has not changed", () => {
	const entries = [];
	const j = journal((data) => entries.push({ customType: TASK_ENTRY, data }));
	const before = [...entries];
	j.begin("配置另一个环境");
	j.attach("session-project", before, true);
	expect(j.snapshot().goal).toBe("分析实验数据并生成结果文件");
});
it("does not hash private files or files outside the workspace", async () => {
	const dir = await mkdtemp(join(tmpdir(), "task-private-"));
	dirs.push(dir);
	await writeFile(join(dir, ".env"), "API_KEY=hidden");
	const j = journal();
	await j.observe({ toolName: "write", toolCallId: "private", input: { path: ".env" } }, dir);
	expect(j.snapshot().receipts[0].artifact).toBeUndefined();
	expect(j.render()).not.toContain("hidden");
});
it("keeps proposed next action distinct from observed completion", async () => {
	const j = journal();
	await j.observe({ toolName: "todo", details: { todos: [{ content: "检查数据版本", status: "pending" }] } });
	expect(j.render()).toContain("模型计划的下一步（不是完成证明）：检查数据版本");
	expect(j.snapshot().receipts).toEqual([]);
});
