import { describe, expect, it, vi } from "vitest";
import { makeTurnContextExtension } from "./turn-context";

function fakePi() {
	const handlers: Record<string, (event: unknown, ctx: unknown) => unknown> = {};
	return {
		handlers,
		on: (name: string, fn: (event: unknown, ctx: unknown) => unknown) => {
			handlers[name] = fn;
		},
		getThinkingLevel: () => "high",
	};
}
const ctx = {
	sessionManager: { getSessionId: () => "s1" },
	getContextUsage: () => ({ tokens: 40_000, contextWindow: 200_000, percent: 20 }),
	model: { provider: "anthropic", id: "m1", contextWindow: 200_000 },
};

describe("turn context extension (P16)", () => {
	it("appends one hidden note with remaining tokens and date", () => {
		const pi = fakePi();
		const ext = makeTurnContextExtension({
			now: () => new Date("2026-10-12T17:30:00Z"),
			timeZone: () => "Asia/Shanghai",
		});
		ext.factory(pi as never);
		const first = pi.handlers.context?.({ messages: [{ role: "user", content: "hi" }] }, ctx) as {
			messages: Array<{ content: string; role: string }>;
		};
		expect(first.messages).toHaveLength(2);
		expect(first.messages[1]?.content).toContain("today 2026-10-13");
		expect(first.messages[1]?.content).toContain("~160000 of 200000");
		const again = pi.handlers.context?.({ messages: first.messages }, ctx) as { messages: unknown[] };
		expect(again.messages).toHaveLength(2);
	});
	it("records mode / model / effort / context per turn", () => {
		const pi = fakePi();
		const recordMeta = vi.fn();
		makeTurnContextExtension({ recordMeta, getMode: () => "single" }).factory(pi as never);
		pi.handlers.before_agent_start?.({ prompt: "x" }, ctx);
		expect(recordMeta).toHaveBeenCalledWith("s1", {
			mode: "single",
			provider: "anthropic",
			model: "m1",
			effort: "high",
			contextTokens: 40_000,
			contextWindow: 200_000,
		});
	});
});
