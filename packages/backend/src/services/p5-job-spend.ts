import type { P5BackgroundUsage } from "./p5-background-scheduler";
import type { SpendGate } from "./p5-spend-ledger";

export interface P5JobSpend {
	/** Pass as P5CriticPorts.spend inside one background job. */
	readonly gate: SpendGate;
	/** The job's total usage, returned from P5BackgroundJob.run. */
	usage(): P5BackgroundUsage;
}

function sumTokens(previous: number | null | undefined, next: number | null | undefined): number | null {
	return previous == null || next == null ? null : previous + next;
}

function sumUsage(previous: P5BackgroundUsage, next: P5BackgroundUsage): P5BackgroundUsage {
	const previousCost = previous.cost;
	const nextCost = next.cost;
	const breakdown = {
		cacheReadTokens: sumTokens(previous.cacheReadTokens, next.cacheReadTokens),
		cacheWriteTokens: sumTokens(previous.cacheWriteTokens, next.cacheWriteTokens),
		cost:
			previousCost !== null && nextCost !== null && previousCost.currency === nextCost.currency
				? { currency: previousCost.currency, amountMicros: previousCost.amountMicros + nextCost.amountMicros }
				: null,
	};
	if (previous.state === "known" && next.state === "known") {
		return {
			...breakdown,
			state: "known",
			inputTokens: previous.inputTokens + next.inputTokens,
			outputTokens: previous.outputTokens + next.outputTokens,
		};
	}
	return {
		...breakdown,
		state: "unknown",
		inputTokens: sumTokens(previous.inputTokens, next.inputTokens),
		outputTokens: sumTokens(previous.outputTokens, next.outputTokens),
	};
}

export function createP5JobSpend(ledger: SpendGate, workspaceId: string): P5JobSpend {
	let total: P5BackgroundUsage | undefined;
	return {
		gate: {
			check: (input) => ledger.check(input),
			async record({ workspaceId: recordedWorkspaceId, metered, ...usage }) {
				if (recordedWorkspaceId !== workspaceId) throw new Error("P5 job spend workspace mismatch");
				if (!metered) return;
				total =
					total === undefined
						? {
								...usage,
								cacheReadTokens: usage.cacheReadTokens ?? null,
								cacheWriteTokens: usage.cacheWriteTokens ?? null,
							}
						: sumUsage(total, usage);
			},
		},
		usage: () =>
			total ?? {
				state: "unknown",
				inputTokens: null,
				outputTokens: null,
				cacheReadTokens: null,
				cacheWriteTokens: null,
				cost: null,
			},
	};
}
