import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FactArtifact } from "@gyoungwe/plugin-api/p5-inquiry";
import { assert, expect, it, vi } from "vitest";
import { createP5FactStore, p5FactSummary } from "../plugins/p5-facts";
import { StorageRegistry } from "../storage/registry";
import { createP5ComputeFacts, type P5ComputeCollection } from "./p5-compute-facts";

const scope = { workspaceId: "workspace-1", sessionId: "session-1" };
const event = {
	id: "event-1",
	jobId: "run-1",
	type: "collected",
	at: 1794960000000,
	status: "succeeded",
} as const;
const artifact: FactArtifact = {
	id: "artifact-1",
	path: "runs/output.json",
	bytes: 12,
	sha256: "a".repeat(64),
	parentIds: ["input-1"],
	purpose: "evidence",
};
const readback = [{ path: artifact.path, bytes: artifact.bytes, sha256: artifact.sha256 }];

it("appends verified collection hashes with host scope and the host summary template", async () => {
	const append = vi.fn<ReturnType<typeof createP5FactStore>["append"]>(async (_, input) => ({
		...input,
		sequence: 1,
	}));
	const producer = createP5ComputeFacts({ scope, append });
	const supplied = { ...artifact, summary: "synthetic prose" };
	const fact = await producer.record(event, "receipt-1", { artifacts: [supplied], readback });
	expect(append).toHaveBeenCalledOnce();
	expect(append).toHaveBeenCalledWith(
		scope,
		expect.objectContaining({
			kind: "compute",
			entityId: "run-1",
			at: "2026-11-18T00:00:00.000Z",
			status: "succeeded",
			artifactRefs: [artifact],
			runReceiptRef: "receipt-1",
			decisionKind: null,
		}),
	);
	expect(fact?.artifactRefs[0]?.sha256).toBe(readback[0]?.sha256);
	assert(fact);
	expect(fact.summary).toBe(p5FactSummary(fact));
	expect(JSON.stringify(fact)).not.toContain(supplied.summary);
});

it.each<P5ComputeCollection["readback"]>([
	[],
	[{ path: artifact.path, bytes: artifact.bytes }],
	[{ path: artifact.path, bytes: artifact.bytes, sha256: null }],
	[{ path: artifact.path, bytes: artifact.bytes, sha256: "b".repeat(64) }],
	[{ path: "runs/other.json", bytes: artifact.bytes, sha256: artifact.sha256 }],
	[{ path: artifact.path, bytes: 13, sha256: artifact.sha256 }],
])("rejects unverified collection without appending: %j", async (...observed) => {
	const append = vi.fn<ReturnType<typeof createP5FactStore>["append"]>();
	const producer = createP5ComputeFacts({ scope, append });
	await expect(
		producer.record(event, "receipt-1", { artifacts: [artifact], readback: observed }),
	).rejects.toMatchObject({ code: "READBACK_FAILED" });
	expect(append).not.toHaveBeenCalled();
});

it("rejects a successful collection without readback without appending", async () => {
	const append = vi.fn<ReturnType<typeof createP5FactStore>["append"]>();
	await expect(createP5ComputeFacts({ scope, append }).record(event, null)).rejects.toMatchObject({
		code: "READBACK_FAILED",
	});
	expect(append).not.toHaveBeenCalled();
});

it.each([
	["draft", "created"],
	["authorized", "created"],
	["prepared", "created"],
	["submitting", "submitted"],
	["queued", "submitted"],
	["running", "running"],
	["collecting", "running"],
	["cancelling", "running"],
	["succeeded", "succeeded"],
	["failed", "failed"],
	["cancelled", "cancelled"],
	["blocked", "blocked"],
	["partial", "partial"],
	["needs-login", "blocked"],
	["needs_login", "blocked"],
	["unknown", "unknown"],
	["lost", "unknown"],
	["outcome-unknown", "unknown"],
	[undefined, "unknown"],
])("maps observed status %s to %s without artifact claims", async (status, expected) => {
	const append = vi.fn<ReturnType<typeof createP5FactStore>["append"]>(async (_, input) => ({
		...input,
		sequence: 1,
	}));
	const fact = await createP5ComputeFacts({ scope, append }).record(
		{ ...event, type: "status", status },
		null,
	);
	expect(fact).toMatchObject({ status: expected, artifactRefs: [] });
});

it("does not journal log traffic", async () => {
	const append = vi.fn<ReturnType<typeof createP5FactStore>["append"]>();
	const producer = createP5ComputeFacts({ scope, append });
	expect(await producer.record({ ...event, type: "logs" }, null)).toBeUndefined();
	expect(append).not.toHaveBeenCalled();
});

it("records uncertain collection outcomes as unknown without artifact claims", async () => {
	const append = vi.fn<ReturnType<typeof createP5FactStore>["append"]>(async (_, input) => ({
		...input,
		sequence: 1,
	}));
	const fact = await createP5ComputeFacts({ scope, append }).record({ ...event, status: "unknown" }, null, {
		artifacts: [artifact],
		readback,
	});
	expect(fact).toMatchObject({ status: "unknown", artifactRefs: [] });
});

it("keeps raw event artifacts and diagnostics out of uncertain facts", async () => {
	const append = vi.fn<ReturnType<typeof createP5FactStore>["append"]>(async (_, input) => ({
		...input,
		sequence: 1,
	}));
	const observed = {
		...event,
		type: "error" as const,
		status: "unknown",
		detail: "synthetic diagnostic",
		artifacts: [artifact],
	};
	const fact = await createP5ComputeFacts({ scope, append }).record(observed, null);
	expect(fact).toMatchObject({ status: "unknown", artifactRefs: [] });
	expect(JSON.stringify(fact)).not.toContain(observed.detail);
});

it("reopens real F1 facts, deduplicates replay, and surfaces changed event conflicts without appending", async ({
	onTestFinished,
}) => {
	const directory = await mkdtemp(join(tmpdir(), "drone-p5-compute-facts-"));
	onTestFinished(() => rm(directory, { recursive: true, force: true }));
	const options = { path: join(directory, "facts.json"), registry: new StorageRegistry() };
	const store = createP5FactStore(options);
	const producer = createP5ComputeFacts({ scope, append: store.append });
	const first = await producer.record(event, "receipt-1", { artifacts: [artifact], readback });
	const reopened = createP5FactStore(options);
	expect(
		await createP5ComputeFacts({ scope, append: reopened.append }).record(event, "receipt-1", {
			artifacts: [artifact],
			readback,
		}),
	).toEqual(first);
	const before = await reopened.read(scope, { after: null, limit: 64 });
	expect(before.facts).toEqual([first]);
	await expect(
		producer.record({ ...event, type: "status", status: "failed" }, "receipt-1"),
	).rejects.toMatchObject({ code: "DUPLICATE_CONFLICT" });
	expect(await reopened.read(scope, { after: null, limit: 64 })).toEqual(before);
	const otherScope = { ...scope, sessionId: "session-2" };
	const other = await createP5ComputeFacts({ scope: otherScope, append: reopened.append }).record(
		event,
		null,
		{ artifacts: [artifact], readback },
	);
	expect(other?.id).not.toBe(first?.id);
	expect(await reopened.read(scope, { after: null, limit: 64 })).toEqual(before);
});
