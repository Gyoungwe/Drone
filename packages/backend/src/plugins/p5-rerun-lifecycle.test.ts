import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Scope } from "@gyoungwe/plugin-api/p5-receipts";
import { expect, it, vi } from "vitest";
import { StorageRegistry } from "../storage/registry";
import { createP5ReceiptStore } from "./p5-receipt-store";
import {
	type P5RerunRun,
	type P5RerunLifecyclePorts as Ports,
	p5RerunLifecycleHandlers,
} from "./p5-rerun-lifecycle";
import { PluginCapabilityBroker } from "./runtime-capabilities";

const sha = "a".repeat(64);
const scope: Scope = { workspaceId: "w", sessionId: "s", callerSourceHash: sha, providerSourceHash: sha };
const request = { requestId: "rerun-1" };
const source = {
	runId: "run-1",
	sourceRunReceiptRef: "original-1",
	workspaceId: scope.workspaceId,
	artifactId: "artifact-1",
	verifiedSha256: sha,
	profile: "profile-1",
};
const artifact = { id: "o", path: "o", bytes: 2, sha256: sha, parentIds: [], purpose: "evidence" as const };
const context = {
	pluginId: "caller",
	applicationId: "application",
	callerIdentity: {},
	bootstrap: false,
	scope: {
		kind: "session" as const,
		workspaceId: scope.workspaceId,
		sessionId: scope.sessionId,
		workspaceDirectory: "/synthetic",
	},
	signal: new AbortController().signal,
};
async function setup() {
	const path = join(await mkdtemp(join(tmpdir(), "drone-p5-lifecycle-")), "receipts.json");
	const open = () => createP5ReceiptStore({ path, registry: new StorageRegistry() });
	// Q1 finishes its submission receipt independently of the durable job's remote state.
	await open().accept(request, {
		receiptRef: "submit-1",
		operation: "compute.rerun.submit",
		inputSha256: sha,
		scope,
		category: "compute-preflight",
		decision: "approved",
		status: "accepted",
		at: "2026-11-18T00:00:00Z",
		parentReceiptRef: "original-1",
		resultSha256: null,
		readback: [],
	});
	const run: P5RerunRun = { jobId: "j", inputSha256: sha, source, status: "accepted", artifacts: [] };
	const runs = new Map([[request.requestId, run]]);
	const ports = {
		store: open(),
		scope: () => scope,
		now: () => "2026-11-18T00:00:00Z",
		findRun: vi.fn<Ports["findRun"]>(async () => runs.get(request.requestId)),
		submit: vi.fn(),
		status: vi.fn<Ports["status"]>(async () => ({ status: "succeeded", artifacts: [artifact] })),
		collect: vi.fn<Ports["collect"]>(async () => ({
			sourceSha256: source.verifiedSha256,
			readback: [{ path: artifact.path, bytes: 2, sha256: artifact.sha256 }],
		})),
		cancel: vi.fn<Ports["cancel"]>(async () => {
			runs.set(request.requestId, { ...run, status: "cancelled" });
			return "cancelled";
		}),
	};
	const call = (name: string, input: unknown = request, caller = scope, approved = true) => {
		const broker = new PluginCapabilityBroker({
			resources: [],
			handlers: p5RerunLifecycleHandlers({ ...ports, scope: () => caller }),
		});
		return broker.run(
			context,
			"write",
			() => undefined,
			async () => approved,
			() => broker.port.call(`compute.rerun.${name}`, input),
		);
	};
	return { ports, call, path, open, runs, run };
}
it("recovers transport and lost-job uncertainty after reopen without writes or resubmission", async () => {
	const f = await setup();
	const before = await readFile(f.path);
	f.ports.status.mockRejectedValueOnce(new Error("synthetic private timeout"));
	expect(await f.call("status")).toHaveProperty("value.status", "outcome-unknown");
	f.ports.store = f.open();
	expect(await f.call("status")).toHaveProperty("value.status", "succeeded");
	f.ports.findRun.mockRejectedValueOnce(new Error("synthetic lookup timeout"));
	expect(await f.call("status")).toHaveProperty("value.status", "outcome-unknown");
	f.runs.clear();
	for (const operation of ["status", "collect", "cancel"])
		expect(await f.call(operation)).toMatchObject({
			value: { status: "outcome-unknown", jobId: null, artifacts: [] },
		});
	expect(f.ports.submit).not.toHaveBeenCalled();
	expect(await readFile(f.path)).toEqual(before);
});
it.each(["workspaceId", "sessionId", "callerSourceHash", "providerSourceHash"] as const)(
	"hides another %s like an unknown ref",
	async (field) => {
		const f = await setup();
		const before = await readFile(f.path);
		for (const operation of ["status", "collect", "cancel"]) {
			const missing = await f.call(operation, { requestId: "missing" });
			expect(missing).toEqual({ status: "failed", code: "DENIED", receiptRef: null });
			expect(await f.call(operation, request, { ...scope, [field]: "e".repeat(64) })).toEqual(missing);
		}
		expect(f.ports.findRun).not.toHaveBeenCalled();
		expect(f.ports.submit).not.toHaveBeenCalled();
		expect(await readFile(f.path)).toEqual(before);
	},
);
it.each(["verified", "source", "output"])(
	"collects with %s readback and records the actual outcome",
	async (kind) => {
		const f = await setup();
		f.ports.collect.mockResolvedValue({
			sourceSha256: kind === "source" ? "e".repeat(64) : source.verifiedSha256,
			readback: [
				{ path: artifact.path, bytes: 2, sha256: kind === "output" ? "e".repeat(64) : artifact.sha256 },
			],
		});
		const outcome = await f.call("collect");
		if (kind === "verified") expect(outcome).toHaveProperty("value.artifacts", [artifact]);
		else expect(outcome).toMatchObject({ status: "failed", code: "READBACK_FAILED" });
		expect(JSON.parse(await readFile(f.path, "utf8"))[1]).toMatchObject({
			operation: "compute.rerun.collect",
			status: kind === "verified" ? "succeeded" : "failed",
			parentReceiptRef: "submit-1",
			scope,
		});
		expect(f.ports.submit).not.toHaveBeenCalled();
	},
);
it("denies effects and conflicting job bindings without modifying receipts", async () => {
	const f = await setup();
	const before = await readFile(f.path);
	for (const operation of ["collect", "cancel"])
		expect(await f.call(operation, request, scope, false)).toHaveProperty("code", "DENIED");
	f.runs.set(request.requestId, { ...f.run, inputSha256: "e".repeat(64) });
	expect(await f.call("collect")).toHaveProperty("code", "STATE_CONFLICT");
	expect(f.ports.collect).not.toHaveBeenCalled();
	expect(f.ports.cancel).not.toHaveBeenCalled();
	expect(await readFile(f.path)).toEqual(before);
});
it("cancels idempotently and keeps terminal states despite late completion", async () => {
	const f = await setup();
	f.ports.status.mockResolvedValue({ status: "running", artifacts: [] });
	expect(await f.call("cancel")).toHaveProperty("value.status", "cancelled");
	const before = await readFile(f.path);
	f.ports.status.mockResolvedValue({ status: "succeeded", artifacts: [artifact] });
	for (const operation of ["cancel", "status", "collect"])
		expect(await f.call(operation)).toHaveProperty("value.status", "cancelled");
	for (const status of ["succeeded", "failed"] as const) {
		f.runs.set(request.requestId, { ...f.run, status });
		expect(await f.call("cancel")).toHaveProperty("value.status", status);
	}
	expect(f.ports.cancel).toHaveBeenCalledTimes(1);
	expect(f.ports.collect).not.toHaveBeenCalled();
	expect(await readFile(f.path)).toEqual(before);
});
