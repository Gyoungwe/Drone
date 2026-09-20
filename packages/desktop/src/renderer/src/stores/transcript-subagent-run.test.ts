import {
	emptyTranscript,
	reduceEvent,
	type SessionEvent,
	SUBAGENT_RESULT_CUSTOM_TYPE,
	type SubagentPanelRun,
} from "@drone/shared";
import { describe, expect, it } from "vitest";

function run(overrides: Partial<SubagentPanelRun>): SubagentPanelRun {
	return {
		runId: "r1",
		dispatchId: "d1",
		parentSessionId: "s1",
		agent: "scout",
		source: "builtin",
		task: "map the rules",
		cwd: "/p",
		requiredTools: [],
		followUp: true,
		status: "queued",
		contextState: "none",
		createdAt: 100,
		queuePosition: 1,
		pendingApprovalIds: [],
		...overrides,
	};
}

const ev = (payload: SubagentPanelRun): SessionEvent => ({ type: "subagent_run", run: payload });

describe("transcript reducer · 面板派发行", () => {
	it("同一次派发的多个 run 落同一行；按 runId 原地更新，不追加新行", () => {
		let state = reduceEvent(emptyTranscript(), ev(run({ runId: "a" })));
		state = reduceEvent(state, ev(run({ runId: "b", queuePosition: 2 })));
		expect(state.messages).toHaveLength(1);
		const row = state.messages[0];
		if (row?.kind !== "subagent") throw new Error("expected subagent row");
		expect(row.id).toBe("pd-d1");
		expect(row.runs.map((item) => item.panel?.runId)).toEqual(["a", "b"]);
		expect(row.runs[0]?.status).toBe("running"); // queued 也按 running 呈现（卡内标签写排队中）

		state = reduceEvent(
			state,
			ev(run({ runId: "a", status: "running", childSessionId: "c1", sessionFile: "/tmp/a.jsonl" })),
		);
		state = reduceEvent(
			state,
			ev(run({ runId: "a", status: "done", childSessionId: "c1", content: "ok", contextState: "pending" })),
		);
		expect(state.messages).toHaveLength(1);
		const updated = state.messages[0];
		if (updated?.kind !== "subagent") throw new Error("expected subagent row");
		expect(updated.runs[0]?.status).toBe("done");
		expect(updated.runs[0]?.sessionId).toBe("c1");
		expect(updated.runs[0]?.panel?.contextState).toBe("pending");
		// key 稳定（React 不重挂）
		const firstKey = row.runs[0]?.key;
		expect(updated.runs[0]?.key).toBe(firstKey);
	});

	it("失败 → error；已中止按中性完成态（卡内写已中止）", () => {
		let state = reduceEvent(emptyTranscript(), ev(run({ runId: "a", status: "error", error: "boom" })));
		state = reduceEvent(state, ev(run({ runId: "b", status: "aborted" })));
		const row = state.messages[0];
		if (row?.kind !== "subagent") throw new Error("expected subagent row");
		expect(row.runs.map((item) => item.status)).toEqual(["error", "done"]);
		expect(row.runs[1]?.panel?.status).toBe("aborted");
	});

	it("结果 custom 消息进入上下文（message_end）→ 同一张卡标记已进入上下文；没有行时补建", () => {
		const delivered = run({ runId: "a", status: "done", content: "ok", contextState: "pending" });
		const event = {
			type: "message_end",
			message: {
				role: "custom",
				customType: SUBAGENT_RESULT_CUSTOM_TYPE,
				content: "result",
				display: true,
				details: { v: 1, run: delivered },
				timestamp: 200,
			},
		} as unknown as SessionEvent;
		let state = reduceEvent(emptyTranscript(), ev(run({ runId: "a", status: "running" })));
		state = reduceEvent(state, event);
		expect(state.messages).toHaveLength(1);
		const row = state.messages[0];
		if (row?.kind !== "subagent") throw new Error("expected subagent row");
		expect(row.runs[0]?.panel?.contextState).toBe("delivered");
		expect(row.runs[0]?.status).toBe("done");

		const fresh = reduceEvent(emptyTranscript(), event);
		expect(fresh.messages).toHaveLength(1);
	});

	it("非面板 custom 消息不产行", () => {
		const state = reduceEvent(emptyTranscript(), {
			type: "message_end",
			message: { role: "custom", customType: "todo-reminder", content: "x", display: true, timestamp: 1 },
		} as unknown as SessionEvent);
		expect(state.messages).toHaveLength(0);
	});
});
