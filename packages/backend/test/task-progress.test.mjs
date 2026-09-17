import { expect, it, vi } from "vitest";
import { createTaskAuthorization } from "../../../.pi/lib/tasks/ask-authorization.mjs";
import { createTaskProgression } from "../../../.pi/lib/tasks/progress-action.mjs";
import { remainingExplanation } from "../../../.pi/lib/tasks/remaining.mjs";
import { createTaskWorkbench } from "../../../.pi/lib/tasks/workbench.mjs";

function fixture(approved = true, kind = "file") {
	const j = createTaskWorkbench({
		requireAuthorization: true,
		inspect: async () => {
			throw new Error("fixture file missing");
		},
	});
	j.attach("scope");
	j.begin("交付报告");
	j.plan({
		summary: "原范围内生成报告",
		milestones: [{ id: "report", title: "报告", acceptance: { kind, path: "report.md" } }],
	});
	if (approved) j.command({ taskId: j.snapshot().id, revision: j.view().revision, action: "authorize-task" });
	const checkBinding = vi.fn(async () => null),
		send = vi.fn(),
		next = vi.fn(),
		prepare = vi.fn();
	const run = createTaskProgression(j, {
		askAuthorization: createTaskAuthorization(j, checkBinding),
		checkBinding,
		continueAuthorized: next,
		prepareRemaining: prepare,
		send,
	});
	const ctx = { cwd: "/fixture", isIdle: () => true, ui: { select: vi.fn(), input: vi.fn() } };
	const input = () => ({ taskId: j.snapshot().id, revision: j.view().revision, action: "progress" });
	return { j, run, ctx, input, next, checkBinding };
}
it("explains remaining dependencies and evidence without asserting missing files", () => {
	const { j } = fixture();
	const before = j.snapshot();
	const report = remainingExplanation(before);
	expect(report).toContain("已验收 0/1");
	expect(report).toContain("不能据此断言文件不存在");
	expect(report).toContain("report.md");
	expect(j.snapshot()).toEqual(before);
	const task = { ...before, operations: [{ state: "verified", artifact: { path: "report.md" } }] };
	expect(remainingExplanation(task)).toContain("已有产物记录");
	task.milestones = [
		{ id: "first", title: "前置报告", state: "pending", dependsOn: [], acceptance: { kind: "file" } },
		{ id: "second", title: "总结", state: "pending", dependsOn: ["first"], acceptance: { kind: "file" } },
	];
	expect(remainingExplanation(task)).toContain("前置项尚未验收：前置报告");
});
it("no plan has no invented percent", () =>
	expect(remainingExplanation({ milestones: [] })).toContain("暂不计算完成百分比"));
it.each([undefined, "暂不处理", "自由文字"])(
	"cancel/non-choice does not change state or resume: %s",
	async (choice) => {
		const f = fixture(),
			before = f.j.view();
		f.ctx.ui.select.mockResolvedValue(choice);
		await f.run(f.input(), f.ctx);
		expect(f.j.view()).toEqual(before);
		expect(f.next).not.toHaveBeenCalled();
	},
);
it("one proceed decision preserves consent and schedules continuation without marking completion", async () => {
	const f = fixture(),
		consent = f.j.authorization();
	f.ctx.ui.select.mockResolvedValue("接着做完剩下的");
	await f.run(f.input(), f.ctx);
	expect(f.next).toHaveBeenCalledOnce();
	expect(f.ctx.ui.select).toHaveBeenCalledOnce();
	expect(f.j.authorization()).toEqual(consent);
	expect(f.j.snapshot().milestones[0].state).not.toBe("completed");
});
it("read-only check never launches execution", async () => {
	const f = fixture();
	f.ctx.ui.select.mockResolvedValue("仅核对已有产物");
	await f.run(f.input(), f.ctx);
	expect(f.next).not.toHaveBeenCalled();
});
it("unapproved task uses exact native authorization rather than generic proceed", async () => {
	const f = fixture(false);
	f.ctx.ui.select.mockResolvedValue("同意本次请求");
	await f.run(f.input(), f.ctx);
	expect(f.j.authorization()).toBeTruthy();
	expect(f.ctx.ui.select).toHaveBeenCalledOnce();
	expect(f.next).toHaveBeenCalledOnce();
});
it("stale revision after the popup is rejected", async () => {
	const f = fixture();
	f.ctx.ui.select.mockImplementation(async () => {
		f.j.pause("external-change");
		return "接着做完剩下的";
	});
	await expect(f.run(f.input(), f.ctx)).rejects.toThrow("变化");
	expect(f.next).not.toHaveBeenCalled();
});
it("changed binding after the popup is rejected", async () => {
	const f = fixture();
	let binding = null;
	f.checkBinding.mockImplementation(async () => binding);
	f.ctx.ui.select.mockImplementation(async () => {
		binding = "other-vault";
		return "接着做完剩下的";
	});
	await expect(f.run(f.input(), f.ctx)).rejects.toThrow("变化");
	expect(f.next).not.toHaveBeenCalled();
});
it("double click shares one native question and one continuation", async () => {
	const f = fixture();
	let choose;
	f.ctx.ui.select.mockImplementation(
		() =>
			new Promise((resolve) => {
				choose = resolve;
			}),
	);
	const input = f.input();
	const a = f.run(input, f.ctx),
		b = f.run(input, f.ctx);
	await vi.waitFor(() => expect(choose).toBeTypeOf("function"));
	choose("接着做完剩下的");
	await Promise.all([a, b]);
	expect(f.ctx.ui.select).toHaveBeenCalledOnce();
	expect(f.next).toHaveBeenCalledOnce();
});
it("no implicit Wiki approval", async () => {
	const f = fixture();
	f.j.wait({ kind: "review", title: "审阅 Wiki", reason: "需要核对候选" });
	f.ctx.ui.select.mockResolvedValue("暂不处理");
	await f.run(f.input(), f.ctx);
	expect(f.ctx.ui.select.mock.calls[0][1]).toEqual(["暂不处理", "仅核对已有产物"]);
	expect(f.next).not.toHaveBeenCalled();
});

it("cancelling file input leaves both acceptance and the pending action unchanged", async () => {
	const f = fixture();
	f.j.wait({ kind: "file", title: "输入文件", reason: "需要原始数据", milestoneId: "report" });
	const before = f.j.snapshot();
	f.ctx.ui.select.mockResolvedValue("提交所需文件");
	f.ctx.ui.input.mockResolvedValue(undefined);
	await f.run(f.input(), f.ctx);
	expect(f.j.snapshot()).toEqual(before);
	expect(f.next).not.toHaveBeenCalled();
});
it("failed file inspection never acknowledges the file or resumes", async () => {
	const f = fixture();
	f.j.wait({ kind: "file", title: "输入文件", reason: "需要原始数据", milestoneId: "report" });
	f.ctx.ui.select.mockResolvedValue("提交所需文件");
	f.ctx.ui.input.mockResolvedValue("/fixture/no-file");
	await expect(f.run(f.input(), f.ctx)).rejects.toThrow("fixture file missing");
	expect(f.j.snapshot().actions[0].state).toBe("pending");
	expect(f.next).not.toHaveBeenCalled();
});
it("only explicit actual human review satisfies the corresponding criterion", async () => {
	const f = fixture(true, "human_review");
	f.j.wait({ kind: "review", title: "审阅报告", reason: "核对报告内容", milestoneId: "report" });
	f.ctx.ui.select.mockResolvedValue("我已亲自看过这些内容");
	await f.run(f.input(), f.ctx);
	expect(f.j.snapshot().milestones[0].state).toBe("completed");
	expect(f.j.snapshot().milestones[0].evidence.kind).toBe("human-review");
	expect(f.next).not.toHaveBeenCalled();
});
it("hard budget checkpoint does not offer an execution bypass", async () => {
	const f = fixture();
	f.j.pause("total-budget");
	f.ctx.ui.select.mockResolvedValue("接着做完剩下的");
	const before = f.j.view();
	await f.run(f.input(), f.ctx);
	expect(f.ctx.ui.select.mock.calls[0][1]).toEqual(["暂不处理", "仅核对已有产物"]);
	expect(f.j.view()).toEqual(before);
	expect(f.next).not.toHaveBeenCalled();
});
