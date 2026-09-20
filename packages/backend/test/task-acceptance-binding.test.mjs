import { afterEach, expect, it, vi } from "vitest";
import {
	effectiveAcceptance,
	registerAcceptanceVerifier,
	resetAcceptanceVerifiers,
} from "../../../.pi/lib/tasks/acceptance.mjs";
import { createTaskAuthorization } from "../../../.pi/lib/tasks/ask-authorization.mjs";
import { remainingExplanation } from "../../../.pi/lib/tasks/remaining.mjs";
import { createTaskWorkbench } from "../../../.pi/lib/tasks/workbench.mjs";

vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 });
afterEach(() => resetAcceptanceVerifiers());

/** 一个 zotero_item 形状的验收器：按 DOI 读回；写入回执经 identify 带回 DOI（挂钩 2）。 */
function zoteroLike(library) {
	return {
		fields: ["doi", "collection"],
		evidenceKind: "zotero-read-only-item-identity",
		verify: async (acceptance) => {
			if (!acceptance.doi) return { state: "pending", reason: "doi-unbound" };
			const key = library.get(acceptance.doi.toLowerCase());
			return key ? { state: "found", itemId: key } : { state: "not-found" };
		},
		identify: (event, details) =>
			event.toolName === "research_zotero_save" && details?.status === "saved" && details.doi
				? { doi: details.doi.toLowerCase(), ignored: "dropped" }
				: null,
		consent: (acceptance) => (acceptance.doi ? { doi: acceptance.doi } : { slot: true }),
		pending: (m) => ({
			reason: m.acceptance.doi ? `Zotero 里还没有读回 ${m.acceptance.doi}` : "这一项还没有对应的文献",
			next: "写入后自动绑定",
		}),
	};
}
function setup(milestones) {
	const library = new Map();
	// 走真实登记表（挂钩 2）：工作台、剩余说明与授权卡读的是同一份定义
	registerAcceptanceVerifier("zotero_item", zoteroLike(library));
	const j = createTaskWorkbench({ requireAuthorization: true });
	j.attach("scope-binding");
	j.begin("精读三篇并进入 Zotero");
	j.plan({ goal: "精读三篇并进入 Zotero", summary: "摘要", milestones });
	j.command({ taskId: j.snapshot().id, revision: j.view().revision, action: "authorize-task" });
	return { j, library };
}
const zoteroMilestone = (id, extra = {}) => ({
	id,
	title: `文献 ${id} 进入 Zotero`,
	acceptance: { kind: "zotero_item", ...extra },
});
/** 模拟一次已授权任务内的写入：guard 记账 → 工具返回回执 → observe。 */
async function save(j, id, doi, status = "saved") {
	// 每次输入都带上调用 id，避免触发工作台对完全相同副作用的幂等拦截
	const event = {
		toolName: "research_zotero_save",
		toolCallId: id,
		input: { doi, title: `paper ${doi}`, run_dir: id },
	};
	expect(j.guard(event)).toBeNull();
	await j.observe({ ...event, details: { status, doi, zoteroKey: "ABCD1234" }, content: [] }, "/unused");
}

it("plan-time-empty zotero_item milestones bind to save receipts in order and verify by the bound DOI", async () => {
	const { j, library } = setup([zoteroMilestone("p1"), zoteroMilestone("p2")]);
	expect(j.snapshot().milestones.map((m) => m.acceptance.doi)).toEqual(["", ""]);
	// 空身份是"精读后写入的一篇"槽位：授权卡上写明后，宿主把尚未绑定的槽位列进写入同意（每个槽位放行一次写入）
	expect(j.authorization(true).acceptances).toEqual([
		{ milestoneId: "p1", kind: "zotero_item", slot: true },
		{ milestoneId: "p2", kind: "zotero_item", slot: true },
	]);
	await j.reconcile("/unused");
	expect(j.snapshot().milestones.map((m) => m.state)).toEqual(["pending", "pending"]);
	expect(remainingExplanation(j.snapshot())).toContain("这一项还没有对应的文献");

	await save(j, "save-1", "10.1111/IMB.12628");
	let [p1, p2] = j.snapshot().milestones;
	expect(p1.bound).toMatchObject({
		fields: { doi: "10.1111/imb.12628" },
		via: "research_zotero_save",
		operationId: "save-1",
	});
	expect(p1.bound.fields).not.toHaveProperty("ignored");
	expect(p1.acceptance.doi).toBe(""); // 契约本身不改写
	expect(effectiveAcceptance(p1).doi).toBe("10.1111/imb.12628");
	expect(p2.bound).toBeUndefined();
	// 回执自动绑定的身份不扩大写入同意；已绑定的槽位也不再为第二篇放行
	expect(j.authorization(true).acceptances).toEqual([{ milestoneId: "p2", kind: "zotero_item", slot: true }]);

	library.set("10.1111/imb.12628", "KEY00001");
	await j.reconcile("/unused");
	[p1, p2] = j.snapshot().milestones;
	expect(p1).toMatchObject({ state: "completed", evidence: { state: "found", itemId: "KEY00001" } });
	expect(p2.state).toBe("pending");

	// 同一 DOI 再次写入（去重复用）不会占用第二个空位
	await save(j, "save-1b", "10.1111/imb.12628");
	expect(j.snapshot().milestones[1].bound).toBeUndefined();
	// 第二个空位还在时，其它 DOI 会绑上去而不是记为未对应
	expect(j.snapshot().unboundIdentities || []).toEqual([]);

	await save(j, "save-2", "10.1073/pnas.2206025119");
	library.set("10.1073/pnas.2206025119", "KEY00002");
	// 空位用完后再写入第三篇：记录为未对应，趁同类里程碑还没全部验收时提示可改绑
	await save(j, "save-3", "10.1186/s12864-019-5838-3");
	expect(j.snapshot().unboundIdentities).toHaveLength(1);
	expect(remainingExplanation(j.snapshot())).toContain("rebind");
	await j.reconcile("/unused");
	expect(j.snapshot().milestones.map((m) => m.state)).toEqual(["completed", "completed"]);
	// 同类里程碑都已验收后，多出来的写入只是额外沉淀，不再提示改绑
	expect(remainingExplanation(j.snapshot())).not.toContain("rebind");
	// 读回成功同时确认了带回身份的写入操作（含去重复用那次）；未对应任何里程碑的写入仍按原规则计为未核实
	expect(j.snapshot().operations.map((o) => [o.id, o.state])).toEqual([
		["save-1", "verified"],
		["save-1b", "verified"],
		["save-2", "verified"],
		["save-3", "returned"],
	]);
	// 只有返回记录的操作不再否决完成：交付以验收过的里程碑为准，剩余说明如实标注未独立核对的那一步
	expect(j.snapshot().state).toBe("completed");
	expect(remainingExplanation(j.snapshot())).toContain("1 步命令/外部操作只有返回记录");
});

it("failed or unverified receipts never bind", async () => {
	const { j } = setup([zoteroMilestone("p1")]);
	const event = { toolName: "research_zotero_save", toolCallId: "save-x", input: { doi: "10.1/x" } };
	expect(j.guard(event)).toBeNull();
	await j.observe(
		{ ...event, details: { status: "failed", doi: "10.1/x" }, content: [], isError: true },
		"/unused",
	);
	expect(j.snapshot().milestones[0].bound).toBeUndefined();
	await save(j, "save-y", "10.1/y", "blocked");
	expect(j.snapshot().milestones[0].bound).toBeUndefined();
});

it("a planned DOI is not silently replaced; the receipt is recorded as unbound and rebind needs the user", async () => {
	const { j, library } = setup([zoteroMilestone("p1", { doi: "10.1/planned-wrong" })]);
	expect(j.authorization(true).acceptances).toEqual([
		{ milestoneId: "p1", kind: "zotero_item", doi: "10.1/planned-wrong" },
	]);
	await save(j, "save-1", "10.1/real");
	let m = j.snapshot().milestones[0];
	expect(m.bound).toBeUndefined();
	expect(j.snapshot().unboundIdentities).toEqual([
		expect.objectContaining({ kind: "zotero_item", doi: "10.1/real", tool: "research_zotero_save" }),
	]);
	expect(remainingExplanation(j.snapshot())).toContain("task_wait kind=rebind");

	// 非法改绑请求
	expect(() =>
		j.wait({ kind: "rebind", title: "换", reason: "r", milestoneId: "nope", doi: "10.1/real" }),
	).toThrow("existing milestone");
	expect(() => j.wait({ kind: "rebind", title: "换", reason: "r", milestoneId: "p1" })).toThrow(
		"supply the new doi",
	);
	expect(() =>
		j.wait({ kind: "rebind", title: "换", reason: "r", milestoneId: "p1", doi: "10.1/PLANNED-WRONG" }),
	).toThrow("already names");

	const action = j.wait({
		kind: "rebind",
		title: "换成真实文献",
		reason: "计划里的 DOI 解析到另一篇论文",
		milestoneId: "p1",
		doi: "10.1/real",
	});
	expect(action).toMatchObject({
		kind: "rebind",
		previous: "10.1/planned-wrong",
		expected: { doi: "10.1/real" },
	});
	expect(j.snapshot().state).toBe("waiting_user");
	expect(() =>
		j.wait({ kind: "rebind", title: "再换", reason: "r", milestoneId: "p1", doi: "10.1/other" }),
	).toThrow("already waiting");

	// 用户拒绝：什么都不变
	j.command({ taskId: j.snapshot().id, revision: j.view().revision, action: "dismiss", actionId: action.id });
	m = j.snapshot().milestones[0];
	expect(m.bound).toBeUndefined();
	expect(effectiveAcceptance(m).doi).toBe("10.1/planned-wrong");

	// 用户同意：按新 DOI 核对，且新 DOI 进入写入同意（等同计划点名）
	const again = j.wait({
		kind: "rebind",
		title: "换成真实文献",
		reason: "同上",
		milestoneId: "p1",
		doi: "10.1/real",
	});
	j.command({
		taskId: j.snapshot().id,
		revision: j.view().revision,
		action: "acknowledge",
		actionId: again.id,
	});
	m = j.snapshot().milestones[0];
	expect(m.bound).toMatchObject({ fields: { doi: "10.1/real" }, via: "rebind", actionId: again.id });
	expect(m.acceptance.doi).toBe("10.1/planned-wrong");
	expect(m.state).toBe("pending");
	expect(j.snapshot().unboundIdentities).toEqual([]);
	expect(j.authorization(true).acceptances).toEqual([
		{ milestoneId: "p1", kind: "zotero_item", doi: "10.1/real" },
	]);
	library.set("10.1/real", "KEY0REAL");
	await j.reconcile("/unused");
	expect(j.snapshot().milestones[0]).toMatchObject({ state: "completed", evidence: { itemId: "KEY0REAL" } });
});

it("rebind is refused for kinds without a doi field and before the plan is approved", () => {
	registerAcceptanceVerifier("zotero_item", zoteroLike(new Map()));
	const j = createTaskWorkbench({ requireAuthorization: true });
	j.attach("scope-rebind");
	j.begin("任务");
	j.plan({
		goal: "任务",
		summary: "摘要",
		milestones: [
			{ id: "f", title: "文件", acceptance: { kind: "file", path: "out.md" } },
			zoteroMilestone("z", { doi: "10.1/a" }),
		],
	});
	expect(() => j.wait({ kind: "rebind", title: "换", reason: "r", milestoneId: "z", doi: "10.1/b" })).toThrow(
		"approved plan",
	);
	j.command({ taskId: j.snapshot().id, revision: j.view().revision, action: "authorize-task" });
	expect(() => j.wait({ kind: "rebind", title: "换", reason: "r", milestoneId: "f", doi: "10.1/b" })).toThrow(
		"declares a doi field",
	);
});

it("the rebind confirmation card shows old and new DOI and only the exact approval applies it", async () => {
	const { j } = setup([zoteroMilestone("p1", { doi: "10.1/planned-wrong" })]);
	const action = j.wait({
		kind: "rebind",
		title: "换成真实文献",
		reason: "计划里的 DOI 指向另一篇",
		milestoneId: "p1",
		doi: "10.1/real",
	});
	const ask = createTaskAuthorization(j);
	const input = () => ({
		taskId: j.snapshot().id,
		revision: j.view().revision,
		action: "ask-authorization",
		actionId: action.id,
	});
	let shown = "";
	const select = async (text) => {
		shown = text;
		return "yes";
	};
	expect(await ask(input(), { ui: { select } })).toBe(false);
	expect(shown).toContain("更换这一项对应的文献");
	expect(shown).toContain("原来的 DOI：10.1/planned-wrong");
	expect(shown).toContain("换成的 DOI：10.1/real");
	expect(j.snapshot().milestones[0].bound).toBeUndefined();
	expect(await ask(input(), { ui: { select: async () => "同意本次请求" } })).toBe(true);
	expect(j.snapshot().milestones[0].bound).toMatchObject({ fields: { doi: "10.1/real" }, via: "rebind" });
	expect(j.snapshot().actions[0].state).toBe("acknowledged");
});
