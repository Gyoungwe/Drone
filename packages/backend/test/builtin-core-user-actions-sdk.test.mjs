// What the user does for a running task of the built-in pi-core: hand it a file it waits for, or confirm a
// human review, through the task panel's progress action. Ported from the in-process task-file-progress
// test at the P4 switch. Real SDK sessions and the managed runtime in a restricted process; only the model
// is the offline faux provider.
import { mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { getCurrentTools } from "@earendil-works/pi-ai/utils/transcript";
import { afterEach, expect, it, vi } from "vitest";

const environment = vi.hoisted(() => ({ userData: "" }));
vi.mock("electron", () => ({ app: { isPackaged: false, getPath: () => environment.userData } }));

import { startBuiltinCore, TASK_TOOLS } from "./fixtures/builtin-core.mjs";

const live = {};
afterEach(async () => {
	await live.host?.close();
	delete live.host;
});

const stage = (...calls) => fauxAssistantMessage(calls, { stopReason: "toolUse" });
const SUBMIT_FILE = "提交所需文件",
	REVIEWED = "我已亲自看过这些内容";

/**
 * The offline model plans `milestone`, then asks the user with task_wait `wait`, then writes nothing
 * until the task is continued: a continuation writes result.md once.
 */
const script = (milestone, wait) => (context) => {
	const messages = context.messages || [];
	if (!getCurrentTools(messages).some((tool) => tool.name === "task_plan"))
		return fauxAssistantMessage("internal");
	const done = (name) => messages.some((m) => m.role === "toolResult" && m.toolName === name && !m.isError);
	const last = messages.findLast((m) => m.role === "assistant" || m.role === "toolResult");
	if (!done("task_plan"))
		return stage(
			fauxToolCall("task_plan", {
				goal: "One bounded result",
				summary: "One bounded result",
				writeDirectories: ["."],
				milestones: [milestone],
			}),
		);
	if (!done("task_wait")) return stage(fauxToolCall("task_wait", wait));
	if (last?.role === "toolResult" && last.toolName === "task_wait") return fauxAssistantMessage("waiting");
	if (milestone.acceptance.kind === "file" && !done("write"))
		return stage(fauxToolCall("write", { path: "result.md", content: "# Delivered\n" }));
	return fauxAssistantMessage("DELIVERED");
};

async function setup(respond, answer) {
	live.host = await startBuiltinCore({
		root: await realpath(await mkdtemp(join(tmpdir(), "drone-builtin-actions-"))),
		setUserData: (path) => {
			environment.userData = path;
		},
		respond,
		answer,
		backend: { lazyCapabilities: false, tools: ["read", "write", ...TASK_TOOLS] },
	});
	return live.host;
}

/** The task panel's progress action for the session's current task. */
const progress = async (s) => {
	const view = s.view();
	const task = view.tasks.find((t) => t.id === view.activeTaskId);
	const payload = Buffer.from(
		JSON.stringify({ taskId: task.id, revision: view.revision, action: "progress" }),
	).toString("base64url");
	await s.prompt(`/task-action ${payload}`);
	return task;
};

const fileTask = (answerPath) => {
	const asked = [];
	const respond = script(
		{ id: "report", title: "Report", acceptance: { kind: "file", path: "result.md" } },
		{ kind: "file", title: "输入数据", reason: "提供现有 input.csv", milestoneId: "report" },
	);
	const answer = (question) => {
		asked.push(question.type === "text" ? "input" : (question.options ?? []).map((o) => o.value));
		return question.type === "text" ? answerPath() : SUBMIT_FILE;
	};
	return { asked, respond, answer };
};

it("a task waiting for a file goes on once the user submits it", async () => {
	let input;
	const f = fileTask(() => input);
	const t = await setup(f.respond, f.answer);
	const s = await t.open("project");
	input = join(s.cwd, "input.csv");
	await writeFile(input, "id,value\na,1\n");
	await s.prompt("Create a report file from my input.");
	expect((await s.status()).snapshot).toMatchObject({ state: "waiting_user" });
	expect(f.asked).toEqual([]);

	await progress(s);
	expect(f.asked).toEqual([[expect.any(String), expect.any(String), SUBMIT_FILE], "input"]);
	expect((await s.status()).snapshot).toMatchObject({ state: "completed" });
	expect(await readFile(join(s.cwd, "result.md"), "utf8")).toContain("Delivered");
	expect(t.dialogs).toEqual(["capability:task.grant.request"]);
	expect(s.errors).toEqual([]);
}, 120000);

it("cancelling the file question leaves the task waiting and writes nothing", async () => {
	const f = fileTask(() => undefined);
	const t = await setup(f.respond, f.answer);
	const s = await t.open("project");
	await s.prompt("Create a report file from my input.");
	await progress(s);
	expect(f.asked).toEqual([[expect.any(String), expect.any(String), SUBMIT_FILE], "input"]);
	expect((await s.status()).snapshot).toMatchObject({ state: "waiting_user" });
	await expect(readFile(join(s.cwd, "result.md"))).rejects.toMatchObject({ code: "ENOENT" });
	expect(s.errors).toEqual([]);
}, 120000);

it("confirming a human review completes its milestone", async () => {
	const respond = script(
		{ id: "review", title: "Review output", acceptance: { kind: "human_review" } },
		{
			kind: "review",
			title: "Check recorded output",
			reason: "Human acceptance required",
			milestoneId: "review",
		},
	);
	const t = await setup(respond, () => REVIEWED);
	const s = await t.open("project");
	await s.prompt("Prepare a bounded human review.");
	expect((await s.status()).snapshot).toMatchObject({ state: "waiting_user" });
	await progress(s);
	expect((await s.status()).snapshot).toMatchObject({ state: "completed" });
	expect(s.errors).toEqual([]);
}, 120000);
