import { emptyTranscript, reduceEvent, type SessionEvent } from "@percho/shared";
import { describe, expect, it } from "vitest";

const ev = (type: string, extra: Record<string, unknown> = {}) => ({ type, ...extra }) as SessionEvent;
const message = (text: string) => ({
	role: "assistant",
	content: [{ type: "text", text }],
	timestamp: 42,
	stopReason: "stop",
});
describe("authoritative non-streaming final snapshots", () => {
	it("shows final-only replies and does not duplicate on turn completion", () => {
		let s = reduceEvent(emptyTranscript(), ev("turn_start"));
		s = reduceEvent(s, ev("message_start", { message: { ...message(""), content: [] } }));
		s = reduceEvent(s, ev("message_end", { message: message("Visible completion") }));
		expect(s.streaming?.text).toBe("Visible completion");
		s = reduceEvent(s, ev("turn_end", { message: message("Visible completion"), toolResults: [] }));
		s = reduceEvent(s, ev("agent_settled"));
		expect(s.messages.filter((m) => m.kind === "assistant")).toHaveLength(1);
		expect(JSON.stringify(s.messages)).toContain("Visible completion");
	});
	it("replaces stale deltas with the checked final notice", () => {
		let s = reduceEvent(emptyTranscript(), ev("turn_start"));
		s = reduceEvent(
			s,
			ev("message_update", {
				assistantMessageEvent: { type: "text_delta", delta: "old delta", contentIndex: 0 },
			}),
		);
		s = reduceEvent(s, ev("message_end", { message: message("检查未通过") }));
		expect(s.streaming?.text).toBe("检查未通过");
	});
	it("hydrates from turn_end when message_end is unavailable", () => {
		const s = reduceEvent(
			emptyTranscript(),
			ev("turn_end", { message: message("Final snapshot"), toolResults: [] }),
		);
		expect(JSON.stringify(s.messages)).toContain("Final snapshot");
	});
	it("does not treat custom navigation and tool results as assistant text", () => {
		let s = reduceEvent(emptyTranscript(), ev("turn_start"));
		s = reduceEvent(
			s,
			ev("message_end", { message: { role: "toolResult", content: [{ type: "text", text: "tool data" }] } }),
		);
		expect(s.streaming?.text).toBe("");
	});
});
