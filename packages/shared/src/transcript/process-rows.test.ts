import { describe, expect, it } from "vitest";
import type { ChatRow } from "./chat-rows";
import { groupProcessRows } from "./process-rows";
import type { UIMessage, UIToolCall } from "./types";

const tool = (name: string, key: string, state: UIToolCall["state"] = "done"): UIToolCall => ({
	key,
	id: key,
	name,
	args: "{}",
	output: "",
	state,
});

const user = (id: string): ChatRow => ({
	kind: "message",
	key: id,
	message: { kind: "user", id, text: "hi", images: [], timestamp: 1 },
	metaInGroup: false,
	showActions: false,
	streaming: false,
});

const text = (id: string): ChatRow => ({
	kind: "message",
	key: id,
	message: { kind: "assistant", id, text: "done", thinking: "", tools: [], timestamp: 2 },
	metaInGroup: true,
	showActions: true,
	streaming: false,
});

const progress = (id: string, status: string): ChatRow => {
	const message: UIMessage = {
		kind: "assistant",
		id,
		text: "",
		thinking: "",
		tools: [],
		timestamp: 2,
		progress: { text: status, kind: "update" },
	};
	return {
		kind: "message",
		key: `${id}:progress`,
		message,
		metaInGroup: true,
		showActions: false,
		streaming: false,
	};
};

const meta = (key: string, tools: UIToolCall[], working = false, statusText?: string): ChatRow => ({
	kind: "metaGroup",
	key,
	items: [{ thinking: "", tools }],
	working,
	endImmediately: !working,
	subagentCount: 0,
	...(statusText ? { statusText } : {}),
});

describe("groupProcessRows", () => {
	it("folds consecutive stage notes and tool groups into one process segment", () => {
		const rows = [
			user("u1"),
			progress("a1", "先读文件"),
			meta("g1", [tool("read", "t1"), tool("read", "t2")]),
			progress("a2", "开始修改"),
			meta("g2", [tool("edit", "t3"), tool("bash", "t4")]),
			text("a3"),
		];
		const out = groupProcessRows(rows);
		expect(out.map((r) => r.kind)).toEqual(["message", "process", "message"]);
		const seg = out[1];
		if (seg?.kind !== "process") throw new Error("expected process segment");
		expect(seg.rows).toHaveLength(4);
		expect(seg.stages).toBe(2);
		expect(seg.tools).toBe(4);
		expect(seg.working).toBe(false);
		expect(seg.latestStage?.text).toBe("开始修改");
		expect(seg.categories.map((c) => `${c.category}:${c.count}`)).toEqual(["read:2", "edit:1", "bash:1"]);
	});

	it("keeps a lone tool group as a plain row and carries live status when working", () => {
		const lone = groupProcessRows([user("u1"), meta("g1", [tool("read", "t1")]), text("a1")]);
		expect(lone.map((r) => r.kind)).toEqual(["message", "metaGroup", "message"]);

		const live = groupProcessRows([
			user("u2"),
			progress("a2", "检索中"),
			meta("g2", [tool("grep", "t2", "running")], true, "正在搜索 src"),
		]);
		const seg = live[1];
		if (seg?.kind !== "process") throw new Error("expected process segment");
		expect(seg.working).toBe(true);
		expect(seg.statusText).toBe("正在搜索 src");
	});

	it("never swallows conclusion rows (user, text, subagent, turnDiff)", () => {
		const turnDiff: ChatRow = {
			kind: "turnDiff",
			key: "turn-diff-0",
			running: false,
			afterMetaGroup: false,
			entering: false,
		};
		const out = groupProcessRows([user("u1"), meta("g1", []), progress("a1", "x"), text("a2"), turnDiff]);
		expect(out.map((r) => r.kind)).toEqual(["message", "process", "message", "turnDiff"]);
	});

	it("does not split a process segment on invisible task-view messages", () => {
		const taskView: ChatRow = {
			kind: "message",
			key: "tv1",
			message: {
				kind: "assistant",
				id: "tv1",
				text: "",
				thinking: "",
				tools: [],
				timestamp: 2,
				taskView: {
					version: 2,
					revision: 1,
					activeTaskId: null,
					selectionRequired: false,
					tasks: [],
					limits: { stageCalls: 0, totalCalls: 0 },
				},
			},
			metaInGroup: true,
			showActions: false,
			streaming: false,
		};
		const out = groupProcessRows([
			user("u1"),
			progress("a1", "规划"),
			meta("g1", [tool("task_plan", "t1")]),
			taskView,
			progress("a2", "执行"),
			meta("g2", [tool("bash", "t2")]),
			text("a3"),
		]);
		expect(out.map((r) => r.kind)).toEqual(["message", "process", "message"]);
		const seg = out[1];
		if (seg?.kind !== "process") throw new Error("expected process segment");
		expect(seg.rows).toHaveLength(5);
		expect(seg.stages).toBe(2);
	});
});
