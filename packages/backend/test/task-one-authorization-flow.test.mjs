import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { remainingExplanation } from "../../../.pi/lib/tasks/remaining.mjs";
import { shouldAskToContinue } from "../../../.pi/lib/tasks/turn-end-prompt.mjs";
import { createTaskWorkbench, LIMITS, WORKBENCH_ENTRY } from "../../../.pi/lib/tasks/workbench.mjs";

/**
 * 一次授权闭环的宿主机制：授权后模型中途收口 → 自动接续（有进展才续、有上限）；
 * 并行批次不被阶段检查点误拦；命令类操作只有返回记录时不再否决完成。
 */
vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 });
const dirs = [];
afterEach(async () => {
	for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});
async function fixture() {
	const dir = await mkdtemp(join(tmpdir(), "drone-one-auth-flow-"));
	dirs.push(dir);
	return dir;
}
function authorized(files) {
	const entries = [];
	const j = createTaskWorkbench({
		requireAuthorization: true,
		persist: (data) => entries.push({ customType: WORKBENCH_ENTRY, data }),
	});
	j.attach("scope-flow");
	j.begin("按示例任务交付几个文件");
	j.plan({
		goal: "按示例任务交付几个文件",
		summary: "写入约定的交付文件",
		writeDirectories: ["."],
		milestones: files.map((path, i) => ({
			id: `m${i + 1}`,
			title: `交付 ${path}`,
			acceptance: { kind: "file", path },
		})),
	});
	j.command({ taskId: j.snapshot().id, revision: j.view().revision, action: "authorize-task" });
	return j;
}
const write = (id, path) => ({ toolName: "write", toolCallId: id, input: { path, content: "x" } });
async function deliver(j, dir, id, path) {
	expect(j.guard(write(id, path))).toBeNull();
	await writeFile(join(dir, path), "x");
	await j.observe(write(id, path), dir);
}
const viewTask = (j) => j.view().tasks.find((t) => t.id === j.snapshot().id);

it("授权后每个有进展的回合末都自动接续；原地打转、等用户、结果不明或已完成时不接续", async () => {
	const dir = await fixture();
	const j = authorized(["a.md", "b.md", "c.md"]);
	// 还没做任何事就收口：没有新进展，不自动接续（交给回合末的询问逻辑）
	expect(j.reserveHandoff()).toBe(false);
	await deliver(j, dir, "w1", "a.md");
	await j.reconcile(dir);
	expect(j.reserveHandoff()).toBe(true);
	expect(j.snapshot()).toMatchObject({
		state: "partial",
		reason: "automatic-handoff",
		budget: { autoHandoffs: 1 },
	});
	expect(j.render()).toContain("按你之前的授权接着做剩下的");
	// 同一份进展只能换一次接续：模型若只回一句话，不会无限循环
	expect(j.reserveHandoff()).toBe(false);
	expect(shouldAskToContinue(viewTask(j))).toBe(false);
	// 有待用户处理的事项时不接续
	await deliver(j, dir, "w2", "b.md");
	j.wait({ kind: "review", title: "请过目", reason: "约定由你看过", milestoneId: "m3" });
	expect(j.snapshot().state).toBe("waiting_user");
	expect(j.snapshot().reason).toBeNull();
	expect(j.reserveHandoff()).toBe(false);
	const action = j.snapshot().actions[0];
	j.command({
		taskId: j.snapshot().id,
		revision: j.view().revision,
		action: "acknowledge",
		actionId: action.id,
	});
	// 操作结果不明（started）时不接续
	expect(j.guard(write("w3", "c.md"))).toBeNull();
	expect(j.reserveHandoff()).toBe(false);
	await writeFile(join(dir, "c.md"), "x");
	await j.observe(write("w3", "c.md"), dir);
	await j.reconcile(dir);
	// 全部交付完成：任务收尾，不再接续
	expect(j.snapshot().state).toBe("completed");
	expect(j.reserveHandoff()).toBe(false);
});

it("自动接续有上限，且不会扩大总步数预算", async () => {
	const dir = await fixture();
	const files = Array.from({ length: LIMITS.autoHandoffs + 2 }, (_, i) => `f${i}.md`);
	const j = authorized(files);
	let granted = 0;
	for (const [i, path] of files.entries()) {
		await deliver(j, dir, `w${i}`, path);
		if (i === files.length - 1) break;
		if (j.reserveHandoff()) granted++;
	}
	expect(granted).toBe(LIMITS.autoHandoffs);
	expect(j.snapshot().budget.autoHandoffs).toBe(LIMITS.autoHandoffs);
	expect(j.snapshot().budget.calls).toBe(files.length);
	expect(j.snapshot().executionConsent.maxCalls).toBe(LIMITS.totalCalls);
});

it("并行批次里兄弟操作仍在执行时，阶段检查点照常推进而不是误报阶段步数用完", async () => {
	const dir = await fixture();
	const j = authorized(["a.md", "b.md"]);
	await deliver(j, dir, "w1", "a.md");
	// 第二个写入已开始（started）但还没返回：阶段检查点不该被它否决
	expect(j.guard(write("w2", "b.md"))).toBeNull();
	expect(j.snapshot().operations.map((o) => o.state)).toEqual(["verified", "started"]);
	expect(j.advanceStage()).toBe(true);
	expect(j.snapshot().reason).toBe("automatic-stage-checkpoint");
	// 结果不明（unknown）的操作仍然否决：那需要先核对
	j.pause("interrupted");
	expect(j.snapshot().operations[1].state).toBe("unknown");
	expect(j.advanceStage()).toBe(false);
});

it("命令只有返回记录（无法独立读回）不再让任务永远停在部分完成，剩余说明如实标注", async () => {
	const dir = await fixture();
	const j = authorized(["report.md"]);
	const bash = { toolName: "bash", toolCallId: "b1", input: { command: "echo check" } };
	expect(j.guard(bash)).toBeNull();
	await j.observe({ ...bash, content: [{ type: "text", text: "check" }] }, dir);
	expect(j.snapshot().operations[0].state).toBe("returned");
	await deliver(j, dir, "w1", "report.md");
	await j.reconcile(dir);
	expect(j.snapshot().state).toBe("completed");
	const summary = remainingExplanation(j.snapshot());
	expect(summary).toContain("约定的交付都已确认完成");
	expect(summary).toContain("1 步命令/外部操作只有返回记录、没有独立核对");
	// 结果不明的操作依然阻止完成
	const j2 = authorized(["report.md"]);
	expect(j2.guard(bash)).toBeNull();
	await deliver(j2, dir, "w1", "report.md");
	j2.pause("interrupted");
	await j2.reconcile(dir);
	expect(j2.snapshot().state).toBe("blocked");
});
