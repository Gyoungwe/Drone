import { describe, expect, it } from "vitest";
import { isAwaitingFirstOutput } from "./chat-rows";
import type { SessionTranscriptState } from "./types";

const streaming = (patch: Record<string, unknown> = {}) =>
	({ id: "s", text: "", thinking: "", tools: [], subagentRuns: [], ...patch }) as never;

function state(patch: Partial<SessionTranscriptState>): SessionTranscriptState {
	return { messages: [], streaming: null, agentActive: true, ...patch } as unknown as SessionTranscriptState;
}

describe("isAwaitingFirstOutput (center orb visibility)", () => {
	const user = { kind: "user", id: "u", text: "hi" } as never;
	const assistant = { kind: "assistant", id: "a", text: "", thinking: "", tools: [] } as never;

	it("is true only between sending and the first visible output of the turn", () => {
		expect(state({ messages: [user] }).agentActive).toBe(true);
		expect(isAwaitingFirstOutput(state({ messages: [user] }))).toBe(true);
		expect(isAwaitingFirstOutput(state({ messages: [user], streaming: streaming() }))).toBe(true);
	});

	it("gives way once thinking, a tool card, text or a committed message appears", () => {
		expect(
			isAwaitingFirstOutput(state({ messages: [user], streaming: streaming({ thinking: "…plan" }) })),
		).toBe(false);
		expect(isAwaitingFirstOutput(state({ messages: [user], streaming: streaming({ tools: [{}] }) }))).toBe(
			false,
		);
		expect(isAwaitingFirstOutput(state({ messages: [user], streaming: streaming({ text: "Answer" }) }))).toBe(
			false,
		);
		// a long multi-cycle run: earlier output is already committed, a fresh empty container must not bring the orb back
		expect(isAwaitingFirstOutput(state({ messages: [user, assistant], streaming: streaming() }))).toBe(false);
	});

	it("is false when the agent is not running", () => {
		expect(isAwaitingFirstOutput(state({ messages: [user], agentActive: false }))).toBe(false);
	});
});
