import {
	buildChatRows,
	deriveTurnUsage,
	emptyTranscript,
	messagesToUIMessages,
	reduceEvent,
	reportedUsage,
	type SessionEvent,
	sumReportedUsage,
} from "@percho/shared";
import { describe, expect, it } from "vitest";

const ev = (type: string, extra: Record<string, unknown> = {}) => ({ type, ...extra }) as SessionEvent;
const response = (id: string, patch: Record<string, unknown> = {}) => ({
	role: "assistant",
	responseId: id,
	timestamp: 10,
	content: [{ type: "text", text: "Visible" }],
	usage: { input: 200, output: 100, cacheRead: 800, cacheWrite: 0, reasoning: 40, cost: { total: 0 } },
	...patch,
});
describe("native SDK usage display adapters", () => {
	it("shows token-weighted cache hits and never counts reasoning twice", () => {
		const first = reportedUsage(response("1"))!,
			second = reportedUsage(
				response("2", { usage: { input: 90, output: 10, cacheRead: 10, cacheWrite: 0, cost: { total: 0 } } }),
			)!;
		const sum = sumReportedUsage([first, second]);
		expect(sum.total).toBe(1210);
		expect(sum.output).toBe(110);
		expect(sum.cacheRate).toBeCloseTo(810 / 1100);
		expect(sum.cacheRate).not.toBe(0.45);
	});
	it("counts cache writes in the input denominator, not as cache hits", () => {
		const u = reportedUsage(
			response("1", { usage: { input: 100, output: 10, cacheRead: 100, cacheWrite: 800 } }),
		)!;
		expect(sumReportedUsage([u]).cacheRate).toBe(0.1);
		expect(sumReportedUsage([u]).cost).toBeNull();
	});
	it("shows unknown rather than fabricating a hit rate for missing cache metrics", () => {
		const u = reportedUsage(response("1", { usage: { input: 100, output: 10 } }))!;
		expect(sumReportedUsage([u]).cacheRate).toBeNull();
		expect(sumReportedUsage([]).cacheRate).toBeNull();
		expect(reportedUsage({ usage: { input: -3, output: 8 } })).toBeUndefined();
	});
	it("deduplicates authoritative snapshots of one SDK response", () => {
		const u = reportedUsage(response("same"))!;
		expect(sumReportedUsage([u, u]).requests).toBe(1);
	});
	it("preserves blocked and failed request usage through live finalization", () => {
		let s = reduceEvent(
			emptyTranscript(),
			ev("message_start", { message: { role: "user", content: "Question", timestamp: 1 } }),
		);
		for (const [id, stopReason] of [
			["1", "error"],
			["2", "stop"],
		] as const) {
			const m = response(id, {
				stopReason,
				knowledgePublication: { id, status: "blocked" },
				content: [{ type: "text", text: "Host failure report" }],
			});
			s = reduceEvent(s, ev("turn_start"));
			s = reduceEvent(s, ev("message_end", { message: m }));
			s = reduceEvent(s, ev("turn_end", { message: m, toolResults: [] }));
		}
		s = reduceEvent(s, ev("agent_settled"));
		expect(deriveTurnUsage(s.messages)[0]?.requests).toBe(2);
		expect(deriveTurnUsage(s.messages)[0]?.total).toBe(2200);
	});
	it("a status-only tool response still contributes to the turn settlement", () => {
		let s = reduceEvent(
			emptyTranscript(),
			ev("message_start", { message: { role: "user", content: "Question", timestamp: 1 } }),
		);
		const m = response("status", {
			content: [{ type: "toolCall", id: "c", name: "set_status", arguments: { text: "Reading" } }],
			stopReason: "toolUse",
		});
		s = reduceEvent(s, ev("turn_start"));
		s = reduceEvent(s, ev("turn_end", { message: m, toolResults: [] }));
		expect(deriveTurnUsage(s.messages)[0]?.requests).toBe(1);
		expect(
			buildChatRows(s, "fixture").filter((r) => r.kind === "message" && r.message.kind === "assistant"),
		).toHaveLength(0);
	});
	it("per-user-turn settlement does not split a tool loop into several bills", () => {
		const u = reportedUsage(response("1"))!,
			v = reportedUsage(response("2"))!,
			w = reportedUsage(response("3"))!;
		expect(
			deriveTurnUsage([
				{ kind: "user" },
				{ kind: "assistant", usage: u },
				{ kind: "assistant", usage: v },
				{ kind: "user" },
				{ kind: "assistant", usage: w },
			]).map((x) => x.requests),
		).toEqual([2, 1]);
	});
	it("history replay retains usage without adding another tokenizer or estimator", () => {
		const usage = reportedUsage(response("history"))!;
		const messages = messagesToUIMessages([
			{ role: "user", text: "Question", thinking: "", tools: [], images: [], timestamp: 1 },
			{ role: "assistant", text: "", thinking: "", tools: [], images: [], timestamp: 2, usage },
		]);
		expect(deriveTurnUsage(messages)[0]?.total).toBe(1100);
	});
	it("public progress appears as a message while hidden thinking remains absent", () => {
		let s = reduceEvent(emptyTranscript(), ev("turn_start"));
		s = reduceEvent(
			s,
			ev("tool_execution_end", {
				toolName: "set_status",
				toolCallId: "s",
				isError: false,
				result: {
					details: {
						status: "Reading source notes",
						detail: "Need the version-matched parameters.",
						next: "Open the manual reference.",
						hiddenReasoning: "MUST_NOT_APPEAR",
					},
				},
			}),
		);
		s = reduceEvent(s, ev("turn_end", { message: response("p", { content: [] }), toolResults: [] }));
		const rows = buildChatRows(s, "fixture");
		expect(JSON.stringify(rows)).toContain("version-matched");
		expect(JSON.stringify(rows)).not.toContain("MUST_NOT_APPEAR");
	});
});
