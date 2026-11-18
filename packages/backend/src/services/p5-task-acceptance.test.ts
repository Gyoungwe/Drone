import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Receipt } from "@gyoungwe/plugin-api/p5-receipts";
import { expect, it, vi } from "vitest";
import { createP5FactStore, p5FactSummary } from "../plugins/p5-facts";
import { createP5ReceiptStore } from "../plugins/p5-receipt-store";
import { StorageRegistry } from "../storage/registry";
import {
	createP5TaskAcceptanceIssuer,
	type P5CommittedTaskTransition,
	type P5TaskOwnerAttachment,
} from "./p5-task-acceptance";

const at = "2026-11-18T00:00:00Z";
const session = { workspaceId: "workspace-1", sessionId: "session-1" };
async function recordReceipt(
	receipts: ReturnType<typeof createP5ReceiptStore>,
	transition: P5CommittedTaskTransition,
	override: Partial<Receipt>,
) {
	const receipt: Receipt = {
		...transition.receipt,
		scope: {
			...session,
			callerSourceHash: transition.attachment.callerSourceHash,
			providerSourceHash: transition.attachment.ownerSourceHash,
		},
		receiptRef: "receipt-1",
		category: null,
		decision: "not-required",
		status: "succeeded",
		at,
		readback: [],
		parentReceiptRef: null,
		...override,
	};
	await receipts.accept(receipt, { ...receipt, status: "accepted", resultSha256: null });
	if (receipt.status !== "accepted") await receipts.finish(receipt, { ...receipt, status: receipt.status });
}
async function setup() {
	const directory = await mkdtemp(join(tmpdir(), "drone-T143-"));
	const registry = new StorageRegistry();
	const path = join(directory, "facts.json");
	const openFacts = () => createP5FactStore({ path, registry });
	const facts = openFacts();
	const receipts = createP5ReceiptStore({ path: join(directory, "receipts.json"), registry });
	const attachment: P5TaskOwnerAttachment = {
		session: { ...session },
		generation: 1,
		callerSourceHash: "a".repeat(64),
		ownerSourceHash: "b".repeat(64),
	};
	const transition: P5CommittedTaskTransition = {
		attachment,
		taskId: "task-1",
		transitionId: "transition-1",
		state: "completed",
		durable: true,
		at,
		receipt: {
			requestId: "request-1",
			operation: "task.complete",
			inputSha256: "c".repeat(64),
			resultSha256: "d".repeat(64),
		},
	};
	const observe = vi.fn(async (): Promise<P5CommittedTaskTransition | undefined> => transition);
	const isLive = vi.fn((candidate: P5TaskOwnerAttachment) => candidate === attachment);
	const issuer = createP5TaskAcceptanceIssuer({
		facts,
		receipts,
		observeCommittedTransition: observe,
		isLive,
	});
	const record = (override: Partial<Receipt> = {}) => recordReceipt(receipts, transition, override);
	const read = () => openFacts().read(session, { after: null, limit: 64 });
	return { path, facts, receipts, attachment, transition, observe, isLive, issuer, record, read };
}
type Fixture = Awaited<ReturnType<typeof setup>>;
async function unchanged(fixture: Fixture, action: () => Promise<unknown>) {
	const seed = {
		id: "seed",
		kind: "decision",
		entityId: "seed",
		at,
		status: "accepted",
		artifactRefs: [],
		runReceiptRef: null,
		decisionKind: null,
		basis: [],
	} as const;
	await fixture.facts.append(session, { ...seed, summary: p5FactSummary(seed) });
	const before = await readFile(fixture.path);
	await action();
	expect(await readFile(fixture.path)).toEqual(before);
}

it("journals exactly one scoped, content-free acceptance readable after reopening", async () => {
	const fixture = await setup();
	await fixture.record();
	const fact = await fixture.issuer.observeTaskAcceptance(fixture.attachment, "receipt-1");
	expect(fact).toEqual({
		id: expect.stringMatching(/^task-accepted:[a-f0-9]{64}$/),
		sequence: 1,
		kind: "task-accepted",
		entityId: "task-1",
		at,
		status: "accepted",
		artifactRefs: [],
		runReceiptRef: "receipt-1",
		decisionKind: null,
		summary: expect.stringMatching(/^task-accepted task-accepted:/),
		basis: ["transition-1"],
	});
	expect(await fixture.read()).toEqual({ cursor: fact?.id, facts: [fact] });
	expect(
		await createP5FactStore({ path: fixture.path, registry: new StorageRegistry() }).read(
			{ ...session, sessionId: "other" },
			{ after: null, limit: 64 },
		),
	).toEqual({ cursor: null, facts: [] });
});

it.each(["missing", "accepted", "failed", "cancelled", "cleanup-failed", "outcome-unknown"] as const)(
	"does not accept a %s receipt",
	async (status) => {
		const fixture = await setup();
		if (status !== "missing") await fixture.record({ status, resultSha256: null });
		await unchanged(fixture, async () => {
			expect(await fixture.issuer.observeTaskAcceptance(fixture.attachment, "receipt-1")).toBeUndefined();
		});
	},
);

it.each([
	["operation", "session.records.append"],
	["requestId", "other-request"],
	["inputSha256", "e".repeat(64)],
	["resultSha256", "f".repeat(64)],
	["workspaceId", "other-workspace"],
	["sessionId", "other-session"],
	["callerSourceHash", "e".repeat(64)],
	["providerSourceHash", "f".repeat(64)],
])("rejects a succeeded receipt with another %s binding", async (key, value) => {
	const fixture = await setup();
	const scope = {
		...session,
		callerSourceHash: fixture.attachment.callerSourceHash,
		providerSourceHash: fixture.attachment.ownerSourceHash,
	};
	const override = key in scope ? { scope: { ...scope, [key]: value } } : { [key]: value };
	await fixture.record(override);
	await unchanged(fixture, async () => {
		expect(await fixture.issuer.observeTaskAcceptance(fixture.attachment, "receipt-1")).toBeUndefined();
	});
});

it.each([{ durable: false }, { state: "running" }, { attachment: {} }, undefined])(
	"rejects an ineligible or unverified transition: %j",
	async (override) => {
		const fixture = await setup();
		await fixture.record();
		fixture.observe.mockResolvedValue(
			override === undefined
				? undefined
				: {
						...fixture.transition,
						...override,
						attachment: override.attachment ? { ...fixture.attachment } : fixture.attachment,
					},
		);
		await unchanged(fixture, async () => {
			expect(await fixture.issuer.observeTaskAcceptance(fixture.attachment, "receipt-1")).toBeUndefined();
		});
	},
);

it("refuses a plain object shaped like a verified proof", async () => {
	const fixture = await setup();
	await fixture.record();
	await unchanged(fixture, async () => {
		expect(await fixture.issuer.issueTaskAcceptance({ ...fixture.transition }, "receipt-1")).toBeUndefined();
	});
});

it.each([
	"dead",
	"disabled",
	"replaced",
	"generation",
	"session",
	"session-id",
	"workspace",
	"owner",
	"caller",
])("rejects an attachment that becomes %s during receipt lookup", async (change) => {
	const fixture = await setup();
	await fixture.record();
	const lookup = fixture.receipts.getByRef;
	vi.spyOn(fixture.receipts, "getByRef").mockImplementation(async (input) => {
		const receipt = await lookup(input);
		if (["dead", "disabled", "replaced"].includes(change)) fixture.isLive.mockReturnValue(false);
		if (change === "generation") Object.assign(fixture.attachment, { generation: 2 });
		if (change === "session") Object.assign(fixture.attachment, { session: { ...session } });
		if (change === "session-id") Object.assign(fixture.attachment.session, { sessionId: "other" });
		if (change === "workspace") Object.assign(fixture.attachment.session, { workspaceId: "other" });
		if (change === "owner") Object.assign(fixture.attachment, { ownerSourceHash: "f".repeat(64) });
		if (change === "caller") Object.assign(fixture.attachment, { callerSourceHash: "e".repeat(64) });
		return receipt;
	});
	await unchanged(fixture, async () => {
		expect(await fixture.issuer.observeTaskAcceptance(fixture.attachment, "receipt-1")).toBeUndefined();
	});
});

it("rejects a generation change while the host verifies the transition", async () => {
	const fixture = await setup();
	await fixture.record();
	fixture.observe.mockImplementation(async () => {
		Object.assign(fixture.attachment, { generation: 2 });
		return fixture.transition;
	});
	await unchanged(fixture, async () => {
		expect(await fixture.issuer.observeTaskAcceptance(fixture.attachment, "receipt-1")).toBeUndefined();
	});
});

it("deduplicates a replay and surfaces F1 conflicts without overwriting", async () => {
	const fixture = await setup();
	await fixture.record();
	const first = await fixture.issuer.observeTaskAcceptance(fixture.attachment, "receipt-1");
	const before = await readFile(fixture.path);
	expect(await fixture.issuer.observeTaskAcceptance(fixture.attachment, "receipt-1")).toEqual(first);
	expect(await readFile(fixture.path)).toEqual(before);
	fixture.observe.mockResolvedValue({ ...fixture.transition, taskId: "other-task" });
	await expect(fixture.issuer.observeTaskAcceptance(fixture.attachment, "receipt-1")).rejects.toMatchObject({
		code: "DUPLICATE_CONFLICT",
	});
	expect(await readFile(fixture.path)).toEqual(before);
	expect((await fixture.read()).facts).toEqual([first]);
});
