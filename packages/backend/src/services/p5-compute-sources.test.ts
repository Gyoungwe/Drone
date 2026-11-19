import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ComputeRerunInput } from "@gyoungwe/plugin-api/p5-inquiry";
import type { Receipt, Scope } from "@gyoungwe/plugin-api/p5-receipts";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StorageRegistry } from "../storage/registry";
import { createP5ComputeSourceStore, type P5ComputeSourceBinding } from "./p5-compute-sources";

const warnings = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock("../log", () => ({ createLogger: () => warnings }));
const scope: Scope = {
	workspaceId: "workspace-1",
	sessionId: "session-1",
	callerSourceHash: "a".repeat(64),
	providerSourceHash: "b".repeat(64),
};
const binding: P5ComputeSourceBinding = {
	scope,
	sourceRunReceiptRef: "receipt-1",
	runId: "run-1",
	jobId: "job-1",
	profile: "local",
	artifact: {
		id: "artifact-1",
		path: "source.bin",
		bytes: 8,
		sha256: createHash("sha256").update("reviewed").digest("hex"),
	},
	collectionRoot: "/collected",
	planSha256: "c".repeat(64),
};
const request: ComputeRerunInput = {
	requestId: "request-1",
	sourceRunReceiptRef: binding.sourceRunReceiptRef,
	artifactId: binding.artifact.id,
	expectedSha256: binding.artifact.sha256,
	profile: binding.profile,
	preflightRef: "plan-1",
	budget: { maxTokens: 100, maxCost: 1, timeoutMs: 1000, maxOutputBytes: 100 },
};
const receipt: Receipt = {
	receiptRef: binding.sourceRunReceiptRef,
	requestId: "source-request",
	operation: "execution.batch.run",
	inputSha256: binding.planSha256,
	scope,
	category: "compute-preflight",
	decision: "approved",
	status: "succeeded",
	at: "2026-11-19T00:00:00Z",
	resultSha256: "d".repeat(64),
	readback: [{ path: binding.artifact.path, bytes: 8, sha256: binding.artifact.sha256 }],
	parentReceiptRef: null,
};
const fixture = { directory: "", path: "", root: "", receipt: receipt as Receipt | undefined };
const getByRef = vi.fn(async () => fixture.receipt);
const readback = vi.fn<Parameters<typeof createP5ComputeSourceStore>[0]["readback"]>(async () => ({
	collectionRoot: fixture.root,
	bytes: await readFile(join(fixture.directory, "source.bin")),
}));
const open = () =>
	createP5ComputeSourceStore({ path: fixture.path, registry: new StorageRegistry(), getByRef, readback });
beforeEach(async () => {
	vi.clearAllMocks();
	fixture.directory = await mkdtemp(join(tmpdir(), "drone-p5-sources-"));
	fixture.path = join(fixture.directory, "sources.json");
	fixture.root = binding.collectionRoot;
	fixture.receipt = structuredClone(receipt);
	await writeFile(join(fixture.directory, "source.bin"), "reviewed");
});
afterEach(async () => {
	await rm(fixture.directory, { recursive: true, force: true });
});
it("persists metadata and resolves exact scope through a fresh instance and fresh byte readback", async () => {
	expect(await open().resolveSource(request, scope)).toBeUndefined();
	await open().issue(binding);
	expect(await open().resolveSource(request, scope)).toEqual({
		runId: binding.runId,
		sourceRunReceiptRef: binding.sourceRunReceiptRef,
		workspaceId: scope.workspaceId,
		artifactId: binding.artifact.id,
		verifiedSha256: binding.artifact.sha256,
		profile: binding.profile,
	});
	expect(getByRef).toHaveBeenCalledWith({ receiptRef: binding.sourceRunReceiptRef });
	expect(readback).toHaveBeenCalledTimes(2);
	expect(JSON.parse(await readFile(fixture.path, "utf8"))).toEqual([binding]);
});
it.each(Object.keys(scope) as (keyof Scope)[])("rejects a changed scope field: %s", async (field) => {
	await open().issue(binding);
	expect(await open().resolveSource(request, { ...scope, [field]: "foreign" })).toBeUndefined();
});
it.each([
	undefined,
	{ ...receipt, decision: "not-required" as const },
	{ ...receipt, decision: "denied" as const, status: "failed" as const },
	{ ...receipt, status: "accepted" as const },
	{ ...receipt, status: "failed" as const },
	{ ...receipt, scope: { ...scope, sessionId: "foreign" } },
	{ ...receipt, receiptRef: "foreign" },
	{ ...receipt, readback: [] },
])("requires a matching approved successful durable receipt: %j", async (changed) => {
	await open().issue(binding);
	fixture.receipt = changed;
	expect(await open().resolveSource(request, scope)).toBeUndefined();
	await expect(open().issue(binding)).rejects.toThrow();
});
it.each(["tampered", "longer artifact"])("rejects changed artifact bytes: %s", async (bytes) => {
	await open().issue(binding);
	await writeFile(join(fixture.directory, "source.bin"), bytes);
	expect(await open().resolveSource(request, scope)).toBeUndefined();
	await expect(open().issue(binding)).rejects.toThrow();
});
it("rejects changed or unavailable roots", async () => {
	await open().issue(binding);
	fixture.root = "/replacement";
	expect(await open().resolveSource(request, scope)).toBeUndefined();
	await expect(open().issue(binding)).rejects.toThrow();
	readback.mockResolvedValueOnce(undefined);
	expect(await open().resolveSource(request, scope)).toBeUndefined();
});
it.each(["sourceRunReceiptRef", "artifactId", "profile", "expectedSha256"] as const)(
	"rejects changed request identity: %s",
	async (field) => {
		await open().issue(binding);
		expect(await open().resolveSource({ ...request, [field]: "foreign" }, scope)).toBeUndefined();
	},
);
it.each([
	"{broken",
	"{}",
	JSON.stringify([{ ...binding, body: "unexpected" }]),
	JSON.stringify([binding, binding]),
])("reports corruption without resolving or replacing it: %s", async (corrupt) => {
	await writeFile(fixture.path, corrupt);
	expect(await open().resolveSource(request, scope)).toBeUndefined();
	expect(warnings.warn).toHaveBeenCalled();
	await expect(open().issue(binding)).rejects.toThrow();
	expect(await readFile(fixture.path, "utf8")).toBe(corrupt);
});
