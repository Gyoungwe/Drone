import { expect, it, vi } from "vitest";
import { createP5JobSpend } from "./p5-job-spend";
import type { SpendGate } from "./p5-spend-ledger";

const scope = { workspaceId: "workspace-1", metered: true };
const known = {
	...scope,
	state: "known",
	inputTokens: 120,
	outputTokens: 30,
	cacheReadTokens: 200,
	cacheWriteTokens: 10,
	cost: { currency: "USD", amountMicros: 40 },
} as const;
const second = {
	...known,
	inputTokens: 25,
	outputTokens: 7,
	cacheReadTokens: 5,
	cacheWriteTokens: 2,
	cost: { currency: "USD", amountMicros: 9 },
};

function fixture() {
	const ledger = {
		check: vi.fn<SpendGate["check"]>().mockResolvedValue("allowed"),
		record: vi.fn<SpendGate["record"]>().mockResolvedValue(undefined),
	};
	return { ...createP5JobSpend(ledger, scope.workspaceId), ledger };
}

it.each(["allowed", "denied"] as const)("delegates the check unchanged and returns %s", async (decision) => {
	const { gate, ledger } = fixture();
	ledger.check.mockResolvedValue(decision);
	await expect(gate.check(scope)).resolves.toBe(decision);
	expect(ledger.check).toHaveBeenCalledExactlyOnceWith(scope);
	expect(ledger.check.mock.calls[0]?.[0]).toBe(scope);
});

it("sums known usage without writing to the ledger", async () => {
	const { gate, usage, ledger } = fixture();
	await gate.record(known);
	await gate.record(second);
	expect(usage()).toStrictEqual({
		state: "known",
		inputTokens: 145,
		outputTokens: 37,
		cacheReadTokens: 205,
		cacheWriteTokens: 12,
		cost: { currency: "USD", amountMicros: 49 },
	});
	expect(ledger.record).not.toHaveBeenCalled();
});

it.each([null, 25])("keeps computable totals for unknown usage with input %s", async (inputTokens) => {
	const { gate, usage } = fixture();
	await gate.record({ ...second, state: "unknown", inputTokens });
	await gate.record(known);
	expect(usage()).toStrictEqual({
		state: "unknown",
		inputTokens: inputTokens === null ? null : 145,
		outputTokens: 37,
		cacheReadTokens: 205,
		cacheWriteTokens: 12,
		cost: { currency: "USD", amountMicros: 49 },
	});
});

it("returns unknown usage when no metered calls completed", () => {
	const { usage } = fixture();
	expect(usage()).toStrictEqual({
		state: "unknown",
		inputTokens: null,
		outputTokens: null,
		cacheReadTokens: null,
		cacheWriteTokens: null,
		cost: null,
	});
});

it.each([
	["different currencies", { currency: "EUR", amountMicros: 9 }],
	["missing cost", null],
] as const)("leaves cost unreported for %s", async (_reason, cost) => {
	const { gate, usage } = fixture();
	await gate.record(known);
	await gate.record({ ...second, cost });
	await gate.record(second);
	expect(usage().cost).toBeNull();
});

it.each([
	{
		field: "null read count",
		cache: { cacheReadTokens: null, cacheWriteTokens: 2 },
		total: { cacheReadTokens: null, cacheWriteTokens: 12 },
	},
	{
		field: "absent write count",
		cache: { cacheReadTokens: 5 },
		total: { cacheReadTokens: 205, cacheWriteTokens: null },
	},
])("keeps cache fields independent with a $field", async ({ cache, total }) => {
	const { gate, usage } = fixture();
	await gate.record({ ...scope, state: "known", inputTokens: 25, outputTokens: 7, cost: null, ...cache });
	expect(usage()).toMatchObject({
		cacheReadTokens: cache.cacheReadTokens,
		cacheWriteTokens: cache.cacheWriteTokens ?? null,
	});
	await gate.record(known);
	expect(usage()).toMatchObject({ state: "known", ...total });
});

it("ignores unmetered reports", async () => {
	const { gate, usage, ledger } = fixture();
	await gate.record({ ...known, metered: false });
	expect(usage().state).toBe("unknown");
	await gate.record(known);
	const total = structuredClone(usage());
	await gate.record({ ...second, state: "unknown", metered: false });
	expect(usage()).toStrictEqual(total);
	expect(ledger.record).not.toHaveBeenCalled();
});

it("rejects a workspace mismatch without accumulating the report", async () => {
	const { gate, usage, ledger } = fixture();
	await gate.record(known);
	const total = structuredClone(usage());
	await expect(gate.record({ ...second, workspaceId: "workspace-2" })).rejects.toThrow(
		new Error("P5 job spend workspace mismatch"),
	);
	expect(usage()).toStrictEqual(total);
	expect(ledger.record).not.toHaveBeenCalled();
});
