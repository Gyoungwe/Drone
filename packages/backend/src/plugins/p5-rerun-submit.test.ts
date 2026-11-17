import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ComputeRerunInput } from "@gyoungwe/plugin-api/p5-inquiry";
import type { Scope } from "@gyoungwe/plugin-api/p5-receipts";
import { expect, it, vi } from "vitest";
import { StorageRegistry } from "../storage/registry";
import { createP5ReceiptStore } from "./p5-receipt-store";
import { createP5RerunSubmitHandler, type P5RerunSubmitPorts } from "./p5-rerun-submit";
import { PluginCapabilityBroker } from "./runtime-capabilities";

const request: ComputeRerunInput = {
	requestId: "rerun-1",
	sourceRunReceiptRef: "original-1",
	artifactId: "artifact-1",
	expectedSha256: "a".repeat(64),
	profile: "profile-1",
	preflightRef: "preflight-1",
	budget: { maxTokens: 0, maxCost: null, timeoutMs: 1000, maxOutputBytes: 1000 },
};
const scope: Scope = {
	workspaceId: "workspace-1",
	sessionId: "session-1",
	callerSourceHash: "b".repeat(64),
	providerSourceHash: "c".repeat(64),
};

async function setup() {
	const directory = await mkdtemp(join(tmpdir(), "drone-p5-rerun-"));
	const path = join(directory, "receipts.json");
	const open = () => createP5ReceiptStore({ path, registry: new StorageRegistry() });
	const jobs = new Map<string, { jobId: string; inputSha256: string }>();
	const source = {
		runId: "run-1",
		sourceRunReceiptRef: "original-1",
		workspaceId: "workspace-1",
		artifactId: "artifact-1",
		verifiedSha256: request.expectedSha256,
		profile: "profile-1",
	};
	const resolve = vi.fn<P5RerunSubmitPorts["resolve"]>(async () => source);
	const submit = vi.fn<P5RerunSubmitPorts["submit"]>(async (plan) => {
		expect(await open().get(request)).toMatchObject({
			status: "accepted",
			decision: "approved",
			category: "compute-preflight",
			inputSha256: plan.inputSha256,
			parentReceiptRef: request.sourceRunReceiptRef,
			scope,
		});
		jobs.set(plan.request.requestId, { jobId: "job-1", inputSha256: plan.inputSha256 });
		return "job-1";
	});
	const ports = {
		store: open(),
		now: () => "2026-11-18T00:00:00Z",
		scope: () => scope,
		resolve,
		submit,
		findSubmission: async (input) => jobs.get(input.requestId),
	} satisfies P5RerunSubmitPorts;
	return { call: caller(ports), ports, path, open, resolve, submit, source };
}

function caller(ports: P5RerunSubmitPorts) {
	return (
		input: unknown = request,
		approved: boolean | (() => boolean) = true,
		workspaceId = "workspace-1",
	) => {
		const broker = new PluginCapabilityBroker({
			resources: [],
			handlers: { "compute.rerun.submit": createP5RerunSubmitHandler(ports) },
		});
		return broker.run(
			{
				pluginId: "caller",
				applicationId: "application",
				callerIdentity: {},
				bootstrap: false,
				scope: { kind: "session", workspaceId, workspaceDirectory: "/synthetic", sessionId: "session-1" },
				signal: new AbortController().signal,
			},
			"write",
			() => undefined,
			async (_name, _input, _effect, _detail, _signal, approval) => {
				expect(approval).toBe("always");
				return typeof approved === "boolean" ? approved : approved();
			},
			() => broker.port.call("compute.rerun.submit", input),
		);
	};
}

it("durably accepts the exact request before submitting and recovers a lost reply after reopen", async () => {
	const f = await setup();
	const first = await f.call();
	expect(first).toMatchObject({ status: "ok", value: { jobId: "job-1", status: "accepted" } });
	const bytes = await readFile(f.path);
	f.ports.store = f.open();
	expect(await f.call(Object.fromEntries(Object.entries(request).reverse()))).toEqual(first);
	expect(f.submit).toHaveBeenCalledTimes(1);
	expect(await readFile(f.path)).toEqual(bytes);
	expect(f.submit.mock.calls[0]?.[0]).toMatchObject({ source: { runId: "run-1", profile: "profile-1" } });
});

it.each([
	{ artifactId: "artifact-2" },
	{ expectedSha256: "d".repeat(64) },
	{ profile: "profile-2" },
	{ sourceRunReceiptRef: "original-2" },
	{ preflightRef: "preflight-2" },
	{ budget: { ...request.budget, maxTokens: 1 } },
	{ budget: { ...request.budget, maxCost: 1 } },
	{ budget: { ...request.budget, timeoutMs: 2000 } },
	{ budget: { ...request.budget, maxOutputBytes: 2000 } },
])("rejects changed duplicate %j without a write or submit", async (change) => {
	const f = await setup();
	await f.call();
	const bytes = await readFile(f.path);
	const result = await f.call({ ...request, ...change });
	expect(result).toMatchObject({ status: "failed", code: "DUPLICATE_CONFLICT" });
	expect(f.submit).toHaveBeenCalledTimes(1);
	expect(await readFile(f.path)).toEqual(bytes);
});

it("does not submit if durable acceptance fails", async () => {
	const f = await setup();
	vi.spyOn(f.ports.store, "accept").mockRejectedValue(new Error("synthetic storage failure"));
	expect(await f.call()).toMatchObject({ status: "failed", code: "PERSISTENCE_PENDING" });
	expect(f.submit).not.toHaveBeenCalled();
	expect(await f.open().get(request)).toBeUndefined();
});

it("rejects the wrong workspace and records the broker's denial with zero submits", async () => {
	const f = await setup();
	expect(await f.call(request, true, "other")).toMatchObject({ status: "failed", code: "SCOPE_CHANGED" });
	expect(await f.call(request, false)).toMatchObject({ status: "failed", code: "DENIED" });
	expect(f.submit).not.toHaveBeenCalled();
	expect(await f.open().get(request)).toMatchObject({ decision: "denied", status: "failed" });
});

it.each([
	["source-workspace", { workspaceId: "other" }, "SCOPE_CHANGED"],
	["unverified", { verifiedSha256: null }, "READBACK_FAILED"],
	["sha", { verifiedSha256: "e".repeat(64) }, "READBACK_FAILED"],
	["unknown", null, "INVALID_INPUT"],
] as const)("rejects %s before submission", async (_kind, change, code) => {
	const f = await setup();
	f.resolve.mockResolvedValue(change === null ? undefined : { ...f.source, ...change });
	expect(await f.call()).toMatchObject({ status: "failed", code });
	expect(f.submit).not.toHaveBeenCalled();
	expect(await f.open().get(request)).toBeUndefined();
});

it("pins the reviewed request while approval is pending", async () => {
	const f = await setup();
	const input = { ...request, budget: { ...request.budget } };
	const approve = () => {
		expect(() => Object.assign(input, { artifactId: "other" })).toThrow(TypeError);
		expect(() => Object.assign(input.budget, { timeoutMs: 2000 })).toThrow(TypeError);
		return true;
	};
	expect(await f.call(input, approve)).toMatchObject({ status: "ok", value: { jobId: "job-1" } });
	expect(f.submit.mock.calls[0]?.[0].request).toEqual(request);
});

it("reconciles a submit whose successful response or terminal persistence was lost", async () => {
	const f = await setup();
	vi.spyOn(f.ports.store, "finish").mockRejectedValue(new Error("synthetic finish failure"));
	expect(await f.call()).toMatchObject({ status: "failed", code: "PERSISTENCE_PENDING" });
	f.ports.store = f.open();
	expect(await f.call()).toMatchObject({ status: "ok", value: { jobId: "job-1" } });
	expect(f.submit).toHaveBeenCalledTimes(1);
});

it("keeps an uncertain submission discoverable and never replays it", async () => {
	const f = await setup();
	f.submit.mockRejectedValue(new Error("synthetic private payload"));
	expect(await f.call()).toMatchObject({ status: "failed", code: "OUTCOME_UNKNOWN" });
	expect(await f.call()).toMatchObject({ status: "ok", value: { jobId: null, status: "outcome-unknown" } });
	expect(f.submit).toHaveBeenCalledTimes(1);
	expect(await readFile(f.path, "utf8")).not.toContain("synthetic private payload");
});

it("lets only one concurrent acceptance submit", async () => {
	const f = await setup();
	const results = await Promise.all([f.call(), f.call()]);
	expect(results).toEqual(expect.arrayContaining([expect.objectContaining({ status: "ok" })]));
	expect(f.submit).toHaveBeenCalledTimes(1);
});
