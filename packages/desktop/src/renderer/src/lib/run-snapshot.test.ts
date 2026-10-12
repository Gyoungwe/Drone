import { deriveRunState } from "@drone/shared";
import { describe, expect, it } from "vitest";
import { runSnapshotOf } from "./run-snapshot";

const streaming = (over: Record<string, unknown> = {}) =>
	({ text: "", thinking: "", tools: [], activity: [], ...over }) as never;
const entry = (over: Record<string, unknown> = {}) =>
	({
		agentActive: true,
		streaming: null,
		todos: [],
		pendingLlmError: null,
		messages: [],
		unseenCompletion: false,
		...over,
	}) as never;

describe("runSnapshotOf (P14)", () => {
	it("maps transcript states", () => {
		expect(deriveRunState(runSnapshotOf(entry(), 0))).toBe("HostInit");
		expect(deriveRunState(runSnapshotOf(entry({ streaming: streaming({ thinking: "hmm" }) }), 0))).toBe(
			"Thinking",
		);
		expect(
			deriveRunState(runSnapshotOf(entry({ streaming: streaming({ tools: [{ state: "running" }] }) }), 0)),
		).toBe("Running");
		expect(
			deriveRunState(runSnapshotOf(entry({ streaming: streaming({ tools: [{ state: "running" }] }) }), 1)),
		).toBe("AwaitingInput");
		expect(deriveRunState(runSnapshotOf(entry({ streaming: streaming({ text: "结果" }) }), 0))).toBe(
			"Streaming",
		);
		expect(deriveRunState(runSnapshotOf(entry({ agentActive: false }), 0))).toBe("Idle");
		const delivered = { kind: "assistant", tools: [{ name: "deliver_files", state: "done" }] };
		expect(
			deriveRunState(
				runSnapshotOf(entry({ agentActive: false, unseenCompletion: true, messages: [delivered] }), 0),
			),
		).toBe("Delivered");
		expect(deriveRunState(runSnapshotOf(entry({ pendingLlmError: { code: "X" } }), 0))).toBe("Error");
	});
});
