import { describe, expect, it } from "vitest";
import {
	attentionTitle,
	canTransition,
	deriveRunState,
	groupRunningFirst,
	isStoppedTurn,
	newPromptIds,
	planBarLabel,
	RUN_STATES,
	type RunSnapshot,
	type RunState,
	receiptMatches,
	stepGroupHeader,
	stepLabel,
	thinkingLabel,
	transition,
	writtenPath,
} from "./run-state";

const base: RunSnapshot = {
	pendingSend: false,
	agentActive: false,
	firstEventSeen: false,
	thinking: false,
	streamingText: false,
	runningTools: 0,
	planning: false,
	pendingAsks: 0,
	stopped: false,
	error: false,
	delivered: false,
};

describe("run state machine (P14)", () => {
	it("derives all 11 states", () => {
		const active = { ...base, agentActive: true, firstEventSeen: true };
		const cases: Array<[RunState, RunSnapshot]> = [
			["Idle", base],
			["Optimistic", { ...base, pendingSend: true }],
			["HostInit", { ...base, agentActive: true }],
			["Thinking", { ...active, thinking: true }],
			["Planning", { ...active, planning: true }],
			["Running", { ...active, runningTools: 2 }],
			["AwaitingInput", { ...active, runningTools: 1, pendingAsks: 1 }],
			["Streaming", { ...active, streamingText: true }],
			["Delivered", { ...base, delivered: true }],
			["Stopped", { ...base, stopped: true }],
			["Error", { ...active, error: true }],
		];
		expect(cases.map(([s]) => s).sort()).toEqual([...RUN_STATES].sort());
		for (const [state, snap] of cases) expect(deriveRunState(snap), state).toBe(state);
	});
	it("walks the happy path and the stop / error branches", () => {
		const path: RunState[] = [
			"Idle",
			"Optimistic",
			"HostInit",
			"Thinking",
			"Planning",
			"Running",
			"AwaitingInput",
			"Running",
			"Streaming",
			"Delivered",
			"Idle",
		];
		let s: RunState = "Idle";
		for (const next of path.slice(1)) s = transition(s, next);
		expect(s).toBe("Idle");
		expect(transition(transition("Running", "Stopped"), "Idle")).toBe("Idle");
		expect(transition("Thinking", "Stopped")).toBe("Stopped");
		expect(transition(transition("Running", "Error"), "Running")).toBe("Running");
	});
	it("rejects illegal transitions", () => {
		for (const [from, to] of [
			["Idle", "Running"],
			["Idle", "Delivered"],
			["Delivered", "Running"],
			["Stopped", "Running"],
			["AwaitingInput", "Delivered"],
			["Optimistic", "Delivered"],
		] as Array<[RunState, RunState]>) {
			expect(canTransition(from, to), `${from}→${to}`).toBe(false);
			expect(() => transition(from, to)).toThrow();
		}
		for (const s of RUN_STATES) expect(canTransition(s, s)).toBe(true);
	});
});

describe("run state copy (P14)", () => {
	it("thinking timer ticks then freezes", () => {
		expect(thinkingLabel(0, null, 3400, true)).toBe("思考中 3s");
		expect(thinkingLabel(0, 4210, 99_000, true)).toBe("深度思考 4.2s");
		expect(thinkingLabel(0, 4210, 99_000, false)).toBe("Thought for 4.2s");
	});
	it("plan bar", () => {
		const items = [
			{ content: "比对", status: "completed" },
			{ content: "定量", status: "in_progress" },
			{ content: "差异分析", status: "pending" },
		];
		expect(planBarLabel(items, true)).toBe("下一步：定量 2/3");
		expect(
			planBarLabel(
				items.map((i) => ({ ...i, status: "completed" })),
				true,
			),
		).toBe("全部步骤已完成 3/3");
		expect(planBarLabel([], true)).toBeNull();
	});
	it("step rows: verb + object + duration", () => {
		expect(stepLabel({ name: "read", args: { path: "/p/data/samples.csv" }, durationMs: 120 }, true)).toBe(
			"读取「samples.csv」 · 120ms",
		);
		expect(stepLabel({ name: "bash", args: { command: "Rscript deseq.R" }, durationMs: 83_000 }, true)).toBe(
			"运行「Rscript deseq.R」 · 1m23s",
		);
		expect(stepLabel({ name: "custom_tool", args: {} }, false)).toBe("custom_tool");
		expect(stepGroupHeader(3, true, true)).toBe("正在运行 3 个步骤");
		expect(stepGroupHeader(3, false, true)).toBe("3 个步骤");
		expect(stepGroupHeader(1, false, false)).toBe("1 step");
	});
	it("attention title, written path, sidebar grouping", () => {
		expect(attentionTitle("Drone", 2)).toBe("(2) Drone");
		expect(attentionTitle("(2) Drone", 0)).toBe("Drone");
		expect(attentionTitle("(2) Drone", 3)).toBe("(3) Drone");
		expect(writtenPath("write", { path: "a.md" })).toBe("a.md");
		expect(writtenPath("read", { path: "a.md" })).toBeNull();
		expect(groupRunningFirst([1, 2, 3, 4], (n) => n % 2 === 0)).toEqual({ running: [2, 4], rest: [1, 3] });
	});
});

describe("P14 Optimistic / Stopped helpers", () => {
	it("newPromptIds 生成两个不同 id，回执一致才匹配", () => {
		const ids = newPromptIds();
		expect(ids.clientMessageId).toMatch(/^u-/);
		expect(ids.assistantMessageId).toMatch(/^a-/);
		expect(newPromptIds().clientMessageId).not.toBe(ids.clientMessageId);
		expect(receiptMatches({ kind: "agent", ...ids } as never, ids)).toBe(true);
		expect(receiptMatches({ clientMessageId: "x", assistantMessageId: ids.assistantMessageId }, ids)).toBe(
			false,
		);
		expect(receiptMatches({}, ids)).toBe(true);
	});
	it("isStoppedTurn 识别 aborted 与中止错误文案，不误判真实错误", () => {
		expect(isStoppedTurn("aborted", undefined)).toBe(true);
		expect(isStoppedTurn("error", "This operation was aborted")).toBe(true);
		expect(isStoppedTurn("error", "rate limited")).toBe(false);
		expect(isStoppedTurn("stop", undefined)).toBe(false);
	});
});
