import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Receipt } from "@gyoungwe/plugin-api/p5-receipts";
import { expect, it, onTestFinished, vi } from "vitest";
import { createP5FactStore } from "../plugins/p5-facts";
import { createP5ReceiptStore } from "../plugins/p5-receipt-store";
import { StorageRegistry } from "../storage/registry";
import { createP5DecisionFacts } from "./p5-decision-facts";

const scope = {
	workspaceId: "workspace-1",
	sessionId: "session-1",
	callerSourceHash: "a".repeat(64),
	providerSourceHash: "b".repeat(64),
};
const request = { requestId: "host-request-1" };
const reference = { receiptRef: "host-receipt-1" };
const acceptance: Omit<Receipt, "requestId"> = {
	...reference,
	operation: "compute.rerun.submit",
	inputSha256: "c".repeat(64),
	scope,
	category: "compute-preflight",
	decision: "approved",
	status: "accepted",
	at: "2026-11-18T00:00:00Z",
	resultSha256: null,
	readback: [],
	parentReceiptRef: null,
};
const completion = {
	status: "succeeded",
	at: "2026-11-18T00:01:00Z",
	resultSha256: "d".repeat(64),
	readback: [],
} as const;

async function fixture() {
	const directory = await mkdtemp(join(tmpdir(), "drone-p5-decision-"));
	onTestFinished(() => rm(directory, { recursive: true, force: true }));
	const registry = new StorageRegistry();
	const facts = createP5FactStore({ path: join(directory, "facts.json"), registry });
	const receipts = createP5ReceiptStore({ path: join(directory, "receipts.json"), registry });
	const append = vi.fn(facts.append);
	const getByRef = vi.fn(receipts.getByRef);
	const produce = createP5DecisionFacts({ append, getByRef, scope, decisionKind: "compute-submit" });
	return { facts, receipts, append, getByRef, produce };
}

it("journals a successful host-approved receipt through real F1 storage", async () => {
	const { facts, receipts, produce } = await fixture();
	await receipts.accept(request, acceptance);
	await receipts.finish(request, completion);
	const fact = await produce(reference);
	expect(fact).toEqual({
		id: expect.stringMatching(/^decision:[a-f0-9]{64}$/),
		sequence: 1,
		kind: "decision",
		entityId: request.requestId,
		at: completion.at,
		status: "succeeded",
		artifactRefs: [],
		runReceiptRef: reference.receiptRef,
		decisionKind: "compute-submit",
		basis: [request.requestId],
		summary: expect.stringMatching(/^decision decision:[a-f0-9]{64} sha256:[a-f0-9]{64}$/),
	});
	expect(await produce(reference)).toEqual(fact);
	expect(await facts.read(scope, { after: null, limit: 64 })).toEqual({
		cursor: fact?.id,
		facts: [fact],
	});
});

it("ignores an asserted decision reference absent from the host receipt store", async () => {
	const { produce, append, facts } = await fixture();
	expect(await produce(reference)).toBeUndefined();
	expect(append).not.toHaveBeenCalled();
	expect((await facts.read(scope, { after: null, limit: 64 })).facts).toEqual([]);
});

it.each(["accepted", "failed", "cancelled", "cleanup-failed", "outcome-unknown"] as const)(
	"does not journal an approved action with status %s",
	async (status) => {
		const { produce, receipts, append, facts } = await fixture();
		await receipts.accept(request, acceptance);
		if (status !== "accepted") await receipts.finish(request, { ...completion, status, resultSha256: null });
		expect(await produce(reference)).toBeUndefined();
		expect(append).not.toHaveBeenCalled();
		expect((await facts.read(scope, { after: null, limit: 64 })).facts).toEqual([]);
	},
);

it.each(["denied", "not-required"] as const)("does not journal a %s decision", async (decision) => {
	const { produce, receipts, append, facts } = await fixture();
	await receipts.accept(request, {
		...acceptance,
		decision,
		status: decision === "denied" ? "failed" : "accepted",
	});
	if (decision === "not-required") await receipts.finish(request, completion);
	expect(await produce(reference)).toBeUndefined();
	expect(append).not.toHaveBeenCalled();
	expect((await facts.read(scope, { after: null, limit: 64 })).facts).toEqual([]);
});

it.each([
	["workspaceId", "workspace-2"],
	["sessionId", "session-2"],
	["callerSourceHash", "e".repeat(64)],
	["providerSourceHash", "f".repeat(64)],
] as const)("rejects a receipt with a different %s", async (field, value) => {
	const { produce, receipts, append, facts } = await fixture();
	await receipts.accept(request, { ...acceptance, scope: { ...scope, [field]: value } });
	await receipts.finish(request, completion);
	expect(await produce(reference)).toBeUndefined();
	expect(append).not.toHaveBeenCalled();
	expect((await facts.read(scope, { after: null, limit: 64 })).facts).toEqual([]);
});

it.each([
	{ ...acceptance, ...request },
	{ ...reference, receipt: { ...acceptance, ...request } },
	{ ...reference, summary: "Synthetic plugin assertion" },
	{ id: "plugin-decision", kind: "compute-submit", summary: "Synthetic plugin assertion", basis: [] },
])("rejects caller-supplied receipt objects and asserted metadata: %#", async (input) => {
	const { produce, receipts, append, getByRef, facts } = await fixture();
	await receipts.accept(request, acceptance);
	await receipts.finish(request, completion);
	await expect(produce(input)).rejects.toThrow("Invalid P5 decision receipt reference");
	expect(getByRef).not.toHaveBeenCalled();
	expect(append).not.toHaveBeenCalled();
	expect((await facts.read(scope, { after: null, limit: 64 })).facts).toEqual([]);
});
