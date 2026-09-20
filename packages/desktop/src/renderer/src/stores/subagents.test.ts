import type { SubagentPanelRun } from "@drone/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const pi = {
	listSessionSubagents: vi.fn(),
	listSubagentRuns: vi.fn(async () => []),
	dispatchSubagents: vi.fn(),
	abortSubagentRun: vi.fn(async () => true),
};
vi.mock("../api", () => ({ getPi: () => pi }));

import { findRunForApproval, selectSessionRuns, summarizeRuns, useSubagentsStore } from "./subagents";

function run(overrides: Partial<SubagentPanelRun>): SubagentPanelRun {
	return {
		runId: "r1",
		dispatchId: "d1",
		parentSessionId: "s1",
		agent: "scout",
		source: "builtin",
		task: "t",
		cwd: "/p",
		requiredTools: [],
		followUp: true,
		status: "running",
		contextState: "none",
		createdAt: 1,
		pendingApprovalIds: [],
		...overrides,
	};
}

beforeEach(() => {
	useSubagentsStore.setState({ agentsBySession: {}, runsBySession: {}, focusRunId: null, draftAgent: null });
	pi.dispatchSubagents.mockReset();
	pi.listSessionSubagents.mockReset();
});

describe("subagents store", () => {
	it("summarizeRuns：运行中含需要回复 / 等待审批；排队单独计；终态不计；有活要等你 → attention", () => {
		expect(
			summarizeRuns([
				run({ runId: "a", status: "running" }),
				run({ runId: "b", status: "waiting_approval" }),
				run({ runId: "c", status: "queued" }),
				run({ runId: "d", status: "done" }),
				run({ runId: "e", status: "aborted" }),
			]),
		).toEqual({ active: 2, queued: 1, attention: true });
		expect(summarizeRuns([run({ status: "running" })])).toEqual({ active: 1, queued: 0, attention: false });
		expect(summarizeRuns([])).toEqual({ active: 0, queued: 0, attention: false });
	});

	it("findRunForApproval：按 pendingApprovalIds 归因审批请求", () => {
		const runs = [run({ runId: "a" }), run({ runId: "b", pendingApprovalIds: ["perm-1"] })];
		expect(findRunForApproval(runs, "perm-1")?.runId).toBe("b");
		expect(findRunForApproval(runs, "perm-9")).toBeUndefined();
	});

	it("applyRun 按 runId 覆盖；selectSessionRuns 新的在前且无会话返回稳定空数组", () => {
		const store = useSubagentsStore.getState();
		store.applyRun("s1", run({ runId: "a", createdAt: 1 }));
		store.applyRun("s1", run({ runId: "b", createdAt: 2 }));
		store.applyRun("s1", run({ runId: "a", createdAt: 1, status: "done" }));
		const runs = selectSessionRuns(useSubagentsStore.getState(), "s1");
		expect(runs.map((item) => [item.runId, item.status])).toEqual([
			["b", "running"],
			["a", "done"],
		]);
		expect(selectSessionRuns(useSubagentsStore.getState(), null)).toBe(
			selectSessionRuns(useSubagentsStore.getState(), "nope"),
		);
	});

	it("dispatch：回执里的记录只在事件没先到时落入（事件版本优先）", async () => {
		const receipt = {
			dispatchId: "d1",
			runs: [run({ runId: "a", status: "queued" }), run({ runId: "b", status: "queued" })],
		};
		pi.dispatchSubagents.mockResolvedValue(receipt);
		useSubagentsStore.getState().applyRun("s1", run({ runId: "a", status: "running" }));
		await useSubagentsStore.getState().dispatch("s1", { tasks: [{ agent: "scout", task: "t" }] });
		const runs = useSubagentsStore.getState().runsBySession.s1 ?? {};
		expect(runs.a?.status).toBe("running");
		expect(runs.b?.status).toBe("queued");
	});

	it("loadAgents：缓存期内不重复拉取，force 强制；失败写 error 不丢旧快照", async () => {
		const snapshot = {
			sessionId: "s1",
			cwd: "/p",
			agents: [],
			maxConcurrent: 3,
			projectTrusted: true,
			userAgentsDir: "/u/agents",
			projectAgentsDir: "/p/.pi/agents",
			readOnly: false,
		};
		pi.listSessionSubagents.mockResolvedValue(snapshot);
		await useSubagentsStore.getState().loadAgents("s1");
		await useSubagentsStore.getState().loadAgents("s1");
		expect(pi.listSessionSubagents).toHaveBeenCalledTimes(1);
		pi.listSessionSubagents.mockRejectedValueOnce(new Error("boom"));
		await useSubagentsStore.getState().loadAgents("s1", true);
		const entry = useSubagentsStore.getState().agentsBySession.s1;
		expect(entry?.error).toBe("boom");
		expect(entry?.snapshot).toEqual(snapshot);
		expect(entry?.loading).toBe(false);
	});
});
