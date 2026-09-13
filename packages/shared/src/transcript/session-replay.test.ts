import { describe, expect, it } from "vitest";
import { deriveTurnUsage, type ReportedUsage, sumReportedUsage } from "../usage-display";
import { deriveRunInspectors } from "./run-inspector";
import { deriveTurnTimings } from "./turn-timings";
import type { UIMessage, UIToolCall } from "./types";

function fixture(turns: number): UIMessage[] {
	const messages: UIMessage[] = [];
	for (let turn = 0; turn < turns; turn++) {
		const topic = turn % 2 === 0 ? "Mantispidae" : "Hemerobiidae";
		const time = turn * 1000 + 1;
		messages.push({
			kind: "user",
			id: `u${turn}`,
			text: `${topic} fixture question`,
			images: [],
			timestamp: time,
		});
		const usage: ReportedUsage = {
			id: `response${turn}`,
			provider: turn % 3 ? "provider-a" : "provider-b",
			model: "synthetic",
			input: 200,
			output: 100,
			cacheRead: 800,
			cacheWrite: 0,
			reasoning: 40,
			cost: null,
		};
		const search: UIToolCall = {
			id: `search${turn}`,
			key: `search${turn}`,
			name: "research_search_knowledge",
			args: JSON.stringify({ query: topic }),
			output: JSON.stringify({
				hits: [{ path: `Library/Papers/${topic}.md` }],
				retrieval: {
					mode: "lexical-fallback",
					query: topic,
					lexicalCandidates: 1,
					semanticCandidates: 0,
					mergedCandidates: 1,
					fallbackReason: "fixture-provider-offline",
				},
			}),
			state: "done",
			endedAt: time + 200,
		};
		const answer: UIMessage = {
			kind: "assistant",
			id: `a${turn}`,
			text: "Synthetic response, not a scientific claim.",
			thinking: "",
			tools: [search],
			usage,
			timestamp: time + 300,
		};
		messages.push(answer, { ...answer, id: `replayed-${turn}` });
		if (turn % 10 === 0)
			messages.push({
				kind: "system",
				id: `compact${turn}`,
				text: "Synthetic compaction receipt",
				timestamp: time + 320,
				compact: { status: "done", reason: "threshold", tokensBefore: 1234 },
			});
	}
	return messages;
}

describe("bounded synthetic long-session transcript replay", () => {
	it.each([20, 50])("retains %i turn boundaries, dedupes receipts and agrees with session sums", (turns) => {
		const messages = fixture(turns);
		const immutable = JSON.stringify(messages);
		const inspectors = deriveRunInspectors(messages);
		const totals = deriveTurnUsage(messages);
		const timings = deriveTurnTimings(messages, turns * 1000);
		expect(inspectors).toHaveLength(turns);
		expect(timings).toHaveLength(turns);
		expect(totals).toHaveLength(turns);
		for (let i = 0; i < turns; i++) {
			const run = inspectors[i];
			expect(run?.turnIndex).toBe(i);
			expect(run?.tools).toHaveLength(1);
			expect(run?.models[0]?.responses).toBe(1);
			expect(run?.sourcePaths).toEqual([]);
			expect(run?.publication.status).toBe("not-run");
			expect(run?.retrievals[0]?.query).toBe(i % 2 === 0 ? "Mantispidae" : "Hemerobiidae");
			expect(totals[i]?.total).toBe(1100);
			expect(totals[i]?.cacheRate).toBe(0.8);
		}
		const usages = messages.flatMap((m) => (m.kind === "assistant" && m.usage ? [m.usage] : []));
		const session = sumReportedUsage(usages);
		expect(session.requests).toBe(turns);
		expect(session.total).toBe(totals.reduce((sum, t) => sum + t.total, 0));
		expect(session.total).toBe(turns * 1100); // reasoning is a subset of output, never counted twice.
		expect(session.cost).toBeNull();
		expect(JSON.stringify(messages)).toBe(immutable);
	});
	it("does not collide reported IDs across different providers/models", () => {
		const usage: ReportedUsage = {
			id: "same-id",
			provider: "a",
			model: "m",
			input: 10,
			output: 5,
			cacheRead: 0,
			cacheWrite: 0,
			cost: 0,
		};
		const total = sumReportedUsage([usage, usage, { ...usage, provider: "b" }, { ...usage, model: "n" }]);
		expect(total.requests).toBe(3);
		expect(total.total).toBe(45);
	});
	it("legacy responses without telemetry do not gain invented usage/read/gate success", () => {
		const messages = fixture(1).map((m) =>
			m.kind === "assistant" ? { ...m, usage: undefined, tools: [] } : m,
		);
		expect(deriveTurnUsage(messages)[0]).toMatchObject({
			requests: 0,
			total: 0,
			cacheRate: null,
			cost: null,
		});
		const run = deriveRunInspectors(messages)[0];
		expect(run?.models).toEqual([]);
		expect(run?.publication.status).toBe("not-run");
	});
	it("bounds failure and retrieval summaries even in pathological tool-heavy turns", () => {
		const messages = fixture(1);
		const first = messages.find((m) => m.kind === "assistant");
		if (!first || first.kind !== "assistant") throw new Error("fixture missing");
		const source = first.tools[0];
		if (!source) throw new Error("fixture tool missing");
		first.tools = Array.from({ length: 1000 }, (_, i) => ({
			...source,
			id: `t${i}`,
			key: `t${i}`,
			output: JSON.stringify({
				status: "failed",
				reason: "fixture-offline",
				retrieval: { mode: "lexical-fallback", query: "fixture", fallbackReason: "offline" },
			}),
		}));
		const run = deriveRunInspectors(messages)[0];
		expect(run?.retrievals.length).toBeLessThanOrEqual(48);
		expect(run?.diagnostics.length).toBeLessThanOrEqual(24);
	});
});
