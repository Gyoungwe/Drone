import { describe, expect, it } from "vitest";
import {
	createSpecialistBudget,
	decideSpecialistRun,
} from "../../../.pi/lib/knowledge/orchestration-policy.mjs";
import { withSpecialistSlot } from "../../../.pi/lib/knowledge/specialist-host.mjs";
import { runKnowledgeSpecialist } from "../src/knowledge/specialist-runner";

describe("synthetic long-session specialist stress", () => {
	it.each([20, 50])("keeps bounded counts over %i deterministic turns", (turns) => {
		const budget = createSpecialistBudget({
			maxRunsPerTurn: 4,
			maxRunsPerSession: 20,
			maxToolOperations: 80,
		});
		let completed = 0;
		for (let turn = 0; turn < turns; turn++) {
			budget.begin();
			const role = turn % 2 ? "evidence" : "navigator";
			const decision = decideSpecialistRun({
				role,
				task: `topic-${turn % 3}`,
				sourcePaths: role === "evidence" ? ["Library/Papers/a.md"] : [],
			});
			if (decision.decision === "run" && budget.reserve(`${turn}:${role}`)) {
				budget.commit(`${turn}:${role}`, budget.snapshot.turn);
				completed++;
			}
		}
		expect(completed).toBeLessThanOrEqual(20);
		expect(budget.snapshot.reservations).toBe(0);
		expect(budget.snapshot.toolOperations).toBe(0);
	});
	it("cancellation removes queued work and later work recovers", async () => {
		const release = [];
		const work = () => new Promise((resolve) => release.push(resolve));
		const first = withSpecialistSlot(undefined, work, { concurrency: 1, queueWaitMs: 100 });
		const abort = new AbortController();
		const queued = withSpecialistSlot(abort.signal, work, { concurrency: 1, queueWaitMs: 100 });
		abort.abort();
		await expect(queued).rejects.toThrow("cancelled");
		release.shift()?.();
		await first;
		const recovered = withSpecialistSlot(undefined, async () => "ok", { concurrency: 1 });
		expect(await recovered).toBe("ok");
	});
	it("transfers queued ownership without leaking active slots", async () => {
		const work = () => new Promise((resolve) => setTimeout(resolve, 5));
		const runs = [1, 2, 3, 4].map(() => withSpecialistSlot(undefined, work, { concurrency: 1 }));
		expect(
			(await import("../../../.pi/lib/knowledge/specialist-host.mjs")).specialistQueueSnapshot().active,
		).toBe(1);
		await Promise.all(runs);
		expect(
			(await import("../../../.pi/lib/knowledge/specialist-host.mjs")).specialistQueueSnapshot(),
		).toEqual({ active: 0, queueLength: 0 });
	});
	it("charges reported provider usage before a later SDK call", async () => {
		const calls = [];
		const deps = {
			getRuntime: async () => ({
				getModels: () => [],
				getModel: () => undefined,
				completeSimple: async () => {
					calls.push(1);
					return {
						role: "assistant",
						content: [{ type: "toolCall", id: "x", name: "knowledge_submit", arguments: {} }],
						stopReason: "toolUse",
						usage: { input: 3, output: 2, totalTokens: 5, cost: { total: 0.01 } },
					};
				},
			}),
			getModelPreference: async () => undefined,
		};
		await expect(
			runKnowledgeSpecialist(deps, {
				role: "evidence",
				task: "x",
				packet: "{}",
				parentModel: { id: "m", provider: "p", reasoning: false },
				capabilities: [],
				check: async () => {},
				progress: () => {},
				onUsage: () => {
					throw new Error("budget stop");
				},
			}),
		).rejects.toThrow("budget stop");
		expect(calls).toHaveLength(1);
	});
	it("records an over-budget provider response before stopping the next call", () => {
		const budget = createSpecialistBudget({ maxTokensPerTurn: 5, maxTokensPerSession: 20 });
		budget.begin();
		expect(() => budget.updateUsage({ totalTokens: 7, cost: 0.01 }, budget.snapshot.turn)).toThrow(
			"token budget",
		);
		expect(budget.snapshot.turnTokens).toBe(7);
		expect(budget.snapshot.sessionTokens).toBe(7);
	});
});
