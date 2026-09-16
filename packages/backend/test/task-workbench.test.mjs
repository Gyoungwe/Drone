import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createEvidenceRecovery } from "../../../.pi/lib/tasks/evidence.mjs";
import {
	createTaskWorkbench,
	inspectTaskFile,
	LIMITS,
	WORKBENCH_ENTRY,
} from "../../../.pi/lib/tasks/workbench.mjs";

vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 });
const dirs = [];
afterEach(async () => {
	for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});
async function fixture() {
	const dir = await mkdtemp(join(tmpdir(), "percho-task-v2-"));
	dirs.push(dir);
	return dir;
}
function setup(extra = {}) {
	const entries = [];
	const j = createTaskWorkbench({
		persist: (data) => entries.push({ customType: WORKBENCH_ENTRY, data }),
		...extra,
	});
	j.attach("scope-a");
	j.begin("分析实验数据");
	return { j, entries };
}
function act(j, action, extra = {}) {
	return j.command({ taskId: j.snapshot().id, revision: j.view().revision, action, ...extra });
}
const effect = (id = "write-1", path = "data.csv") => ({
	toolName: "write",
	toolCallId: id,
	input: { path, content: "value\n1" },
});
const plan = (j, path = "data.csv") =>
	j.plan({ milestones: [{ id: "data", title: "交付数据文件", acceptance: { kind: "file", path } }] });
it("multiple generic tasks require a user choice instead of guessing a continuation", () => {
	const { j } = setup();
	const first = j.snapshot().id;
	j.begin("配置代码环境");
	expect(j.begin("继续")).toEqual({ selectionRequired: true });
	expect(() => j.guard(effect())).toThrow("Select a task");
	j.command({ taskId: first, revision: j.view().revision, action: "select" });
	expect(j.begin("继续").taskId).toBe(first);
	expect(j.view().tasks).toHaveLength(2);
});
it("stale UI cannot select or acknowledge a different revision", () => {
	const { j } = setup();
	const old = j.view().revision;
	plan(j);
	expect(() => j.command({ taskId: j.snapshot().id, revision: old, action: "cancel" })).toThrow("Refresh");
});
it("other-session snapshots and fake state labels cannot grant completion", () => {
	const { j, entries } = setup();
	const restored = createTaskWorkbench();
	restored.attach("other", entries);
	expect(restored.snapshot()).toBeNull();
	expect(j.snapshot().state).not.toBe("completed");
});
it("pending side effects survive restart and cannot be blindly replayed", () => {
	const { j, entries } = setup();
	expect(j.guard(effect())).toBeNull();
	const restored = createTaskWorkbench();
	restored.attach("scope-a", entries);
	expect(restored.snapshot().state).toBe("blocked");
	restored.begin("继续");
	expect(restored.guard(effect("retry"))).toMatchObject({ block: true });
});
it("a task switch cannot steal an in-flight operation", () => {
	const { j } = setup();
	const first = j.snapshot().id;
	j.begin("second task");
	j.guard(effect());
	expect(() => j.command({ taskId: first, revision: j.view().revision, action: "select" })).toThrow(
		"Stop the running agent",
	);
});
it("two identical failures stop early while corrected arguments may proceed", async () => {
	const { j } = setup();
	for (const id of ["one", "two"]) {
		expect(j.guard(effect(id))).toBeNull();
		await j.observe({ ...effect(id), isError: true });
	}
	expect(j.guard(effect("three"))).toMatchObject({ block: true });
	expect(j.guard(effect("fixed", "fixed.csv"))).toBeNull();
});
it("status spam cannot reset stage or lifetime budgets", () => {
	const { j } = setup();
	for (let i = 0; i < LIMITS.stageCalls; i++)
		expect(j.guard({ toolName: "set_status", toolCallId: String(i), input: {} })).toBeNull();
	expect(j.guard({ toolName: "set_status", input: {} })).toMatchObject({ block: true });
	expect(j.snapshot().budget.calls).toBe(LIMITS.stageCalls);
	expect(j.guard({ toolName: "task_status" })).toBeNull();
});
it("explicit stage continuation never resets total budget", () => {
	const { j } = setup();
	for (let i = 0; i < 4; i++) {
		for (let k = 0; k < 48; k++) j.guard({ toolName: "read", toolCallId: `${i}-${k}`, input: {} });
		if (i < 3) act(j, "next-stage");
	}
	expect(() => act(j, "next-stage")).toThrow("Absolute task budget");
	expect(j.snapshot().budget.calls).toBe(192);
});
it.each(["completed", "verified", "operational"])(
	"model label %s does not satisfy acceptance",
	async (state) => {
		const { j } = setup();
		plan(j);
		j.guard({ toolName: "plugin", toolCallId: "p", input: {} });
		await j.observe({
			toolName: "plugin",
			toolCallId: "p",
			details: { state, verified: true, completed: true },
		});
		j.settle();
		expect(j.snapshot().state).not.toBe("completed");
	},
);
it("native file acceptance requires user-approved plan and real readback", async () => {
	const dir = await fixture();
	await writeFile(join(dir, "data.csv"), "value\n1");
	const { j } = setup();
	plan(j);
	await j.reconcile(dir);
	expect(j.snapshot().state).not.toBe("completed");
	act(j, "approve-plan");
	await j.reconcile(dir);
	expect(j.snapshot().state).toBe("completed");
	expect(j.render()).toContain("不是科研结论");
});
it("observed milestone progress can checkpoint once, not by re-writing status", async () => {
	const dir = await fixture();
	const { j } = setup();
	plan(j);
	act(j, "approve-plan");
	j.guard(effect());
	await writeFile(join(dir, "data.csv"), "value\n1");
	await j.observe(effect(), dir);
	expect(j.advanceStage()).toBe(true);
	expect(j.advanceStage()).toBe(false);
	expect(j.snapshot().budget.calls).toBe(1);
});
it("dependencies reject missing IDs and cycles before any plan is saved", () => {
	const { j } = setup();
	expect(() =>
		j.plan({
			milestones: [{ id: "a", title: "A", dependsOn: ["b"], acceptance: { kind: "file", path: "a" } }],
		}),
	).toThrow("Dependencies");
	expect(j.snapshot().milestones).toEqual([]);
});
it("unresolved Wiki candidate is never completed by a model flag", async () => {
	const { j } = setup();
	j.guard({ toolName: "research_propose_wiki_update", toolCallId: "wiki", input: {} });
	await j.observe({
		toolName: "research_propose_wiki_update",
		toolCallId: "wiki",
		details: { id: "candidate-1", status: "applied" },
	});
	j.settle();
	expect(j.snapshot().operations[0].state).toBe("awaiting-review");
	expect(j.snapshot().state).not.toBe("completed");
});
it("only scoped Wiki review records satisfy a Wiki milestone", async () => {
	const { j } = setup({
		getWikiStatus: async () => ({ status: "applied", path: "Wiki/Topic.md", stale: false }),
	});
	j.plan({
		milestones: [
			{ id: "wiki", title: "审核并应用", acceptance: { kind: "wiki_review", path: "Wiki/Topic.md" } },
		],
	});
	act(j, "approve-plan");
	j.guard({ toolName: "research_propose_wiki_update", toolCallId: "wiki", input: {} });
	await j.observe({
		toolName: "research_propose_wiki_update",
		toolCallId: "wiki",
		details: { id: "candidate-1" },
	});
	await j.reconcile("/unused");
	expect(j.snapshot().state).toBe("completed");
});
it("waiting time is separate and cancellation is not consent", () => {
	let clock = 0;
	const { j } = setup({ now: () => new Date(clock).toISOString() });
	const a = j.wait({ kind: "authorization", title: "选择写入方式", reason: "需要用户选择" });
	clock = 120000;
	expect(j.view().tasks[0].waitMs).toBe(120000);
	act(j, "dismiss", { actionId: a.id });
	expect(j.snapshot().state).toBe("blocked");
	expect(j.snapshot().actions[0].state).toBe("cancelled");
});
it("action links reject credentials and executable protocols", () => {
	const { j } = setup();
	for (const url of [
		"javascript:alert(1)",
		"https://x.invalid/?token=secret",
		"https://user:password@x.invalid/",
	])
		expect(() => j.wait({ kind: "download", title: "Paper", url })).toThrow();
});
it("file selection is explicit; duplicates are not counted twice", async () => {
	const dir = await fixture();
	await writeFile(join(dir, "a.csv"), "value\n1");
	const { j } = setup();
	const a = j.wait({ kind: "file", title: "A" }),
		b = j.wait({ kind: "file", title: "B" });
	const input = (id) => ({
		taskId: j.snapshot().id,
		revision: j.view().revision,
		actionId: id,
		path: "a.csv",
	});
	await j.acceptFile(input(a.id), dir);
	await expect(j.acceptFile(input(b.id), dir)).rejects.toThrow("already associated");
});
it("HTML disguised as a PDF is rejected without mutation", async () => {
	const dir = await fixture();
	await writeFile(join(dir, "paper.pdf"), "<html>sign in</html>");
	await expect(inspectTaskFile(dir, "paper.pdf", { kind: "pdf" })).rejects.toThrow("Not a PDF");
});
it("private files, stale versions and changed binding do not inherit verification", async () => {
	const dir = await fixture();
	await writeFile(join(dir, ".env"), "KEY=secret");
	await expect(inspectTaskFile(dir, ".env")).rejects.toThrow("non-private");
	const { j } = setup();
	const result = j.begin("继续", [], "new-binding");
	expect(result.blocked).toBe(true);
	expect(j.guard(effect())).toMatchObject({ block: true });
});
it("legacy checkpoints migrate as unreviewed without changing original records", () => {
	const entries = [
		{
			customType: "percho-task-checkpoint-v1",
			data: { scope: "a", goal: "old task", receipts: [{ id: "old", tool: "bash", state: "verified" }] },
		},
	];
	const j = createTaskWorkbench();
	j.attach("a", entries);
	expect(j.snapshot().receipts[0].state).toBe("legacy-unreviewed");
	expect(entries[0].data.receipts[0].state).toBe("verified");
});
it("evicted evidence is restored under current permission/version and remains bounded", async () => {
	const dir = await fixture();
	await writeFile(join(dir, "data.txt"), "one\ntwo\nthree");
	const allow = vi.fn(async () => {}),
		e = createEvidenceRecovery({ authorize: allow });
	e.attach("s", "t");
	await e.capture({ toolCallId: "r", input: { path: "data.txt", offset: 2, limit: 1 } }, dir, null);
	await expect(e.restore({ receiptId: "r", path: "data.txt" }, dir, async () => null)).rejects.toThrow(
		"recovery-unavailable",
	);
	for (let i = 0; i < 2; i++) {
		e.evict(["r"]);
		expect((await e.restore({ receiptId: "r", path: "data.txt" }, dir, async () => null)).text).toBe("two");
	}
	e.evict(["r"]);
	await expect(e.restore({ receiptId: "r", path: "data.txt" }, dir, async () => null)).rejects.toThrow(
		"recovery-unavailable",
	);
	expect(allow).toHaveBeenCalledTimes(2);
});
it("revoked permission or changed bytes invalidate recovery instead of reusing a cache grant", async () => {
	const dir = await fixture();
	await writeFile(join(dir, "data.txt"), "one");
	const allow = vi.fn(async () => {}),
		e = createEvidenceRecovery({ authorize: allow });
	e.attach("s", "t");
	await e.capture({ toolCallId: "r", input: { path: "data.txt" } }, dir, "binding");
	e.evict(["r"]);
	allow.mockRejectedValueOnce(new Error("denied"));
	await expect(e.restore({ receiptId: "r", path: "data.txt" }, dir, async () => "binding")).rejects.toThrow(
		"denied",
	);
	await writeFile(join(dir, "data.txt"), "two");
	await expect(e.restore({ receiptId: "r", path: "data.txt" }, dir, async () => "binding")).rejects.toThrow(
		"differs",
	);
});
