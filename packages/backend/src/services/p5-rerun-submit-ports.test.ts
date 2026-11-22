import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ComputeRerunInput } from "@gyoungwe/plugin-api/p5-inquiry";
import type { Scope } from "@gyoungwe/plugin-api/p5-receipts";
import { expect, it, vi } from "vitest";
import { createP5ReceiptStore } from "../plugins/p5-receipt-store";
import { createP5RerunSubmitHandler, type P5RerunSource } from "../plugins/p5-rerun-submit";
import { PluginCapabilityBroker } from "../plugins/runtime-capabilities";
import { StorageRegistry } from "../storage/registry";
import { type ComputeExecutor, ComputeService } from "./compute";
import {
	createP5RerunBindingStore,
	createP5RerunSubmitPorts,
	p5RerunInputHash,
} from "./p5-rerun-submit-ports";

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
const otherScope: Scope = { ...scope, sessionId: "session-2" };

async function setup() {
	const directory = await mkdtemp(join(tmpdir(), "drone-p5-rerun-ports-"));
	const agentDir = join(directory, "agent");
	const registry = new StorageRegistry();
	let submissions = 0;
	const executor: ComputeExecutor = {
		submit: async () => {
			submissions += 1;
			return { status: "queued" };
		},
		status: async () => ({ status: "running" }),
	};
	const compute = new ComputeService({ storage: registry, agentDir, executor });
	await compute.upsertHost({ alias: "local", host: "127.0.0.1", username: "runner" });
	const receiptPath = join(agentDir, "p5-receipts.json");
	const open = () => createP5ReceiptStore({ path: receiptPath, registry: new StorageRegistry() });
	const bindings = createP5RerunBindingStore({
		path: join(agentDir, "p5-rerun-bindings.json"),
		registry,
	});
	const source: P5RerunSource = {
		runId: "run-1",
		sourceRunReceiptRef: "original-1",
		workspaceId: "workspace-1",
		artifactId: "artifact-1",
		verifiedSha256: request.expectedSha256,
		profile: "profile-1",
	};
	const sourceOf = vi.fn(async (): Promise<P5RerunSource | undefined> => source);
	const ports = createP5RerunSubmitPorts({
		compute,
		bindings,
		store: open(),
		sourceOf,
		jobOf: () => ({
			hostAlias: "local",
			workflow: { version: 1, modules: [], steps: [] },
		}),
		scopeOf: () => scope,
		now: () => "2026-11-22T00:00:00Z",
	});
	return {
		...ports,
		store: open(),
		bindings,
		compute,
		source,
		sourceOf,
		submissionCount: () => submissions,
		open,
	};
}

type Ports = Awaited<ReturnType<typeof setup>>;

function caller(ports: Ports, input: unknown = request, approved = true) {
	const broker = new PluginCapabilityBroker({
		resources: [],
		handlers: {
			"compute.rerun.submit": createP5RerunSubmitHandler({
				store: ports.store,
				now: ports.now,
				scope: ports.scope,
				resolve: ports.resolve,
				findSubmission: ports.findSubmission,
				submit: ports.submit,
			}),
		},
	});
	return broker.run(
		{
			pluginId: "caller",
			applicationId: "application",
			callerIdentity: {},
			bootstrap: false,
			scope: {
				kind: "session",
				workspaceId: "workspace-1",
				workspaceDirectory: "/synthetic",
				sessionId: "session-1",
			},
			signal: new AbortController().signal,
		},
		"write",
		() => undefined,
		async () => approved,
		() => broker.port.call("compute.rerun.submit", input),
	);
}

it("submits a verified source once and reuses the same job for a duplicate request", async () => {
	const ports = await setup();
	const first = (await caller(ports)) as {
		status: string;
		value?: { status: string; jobId: string };
	};
	if (first.status !== "ok") throw new Error("Expected a submitted rerun");
	expect(first.value?.status).toBe("accepted");
	expect(first.value?.jobId).toBeTruthy();
	expect(ports.submissionCount()).toBe(1);
	const second = await caller(ports);
	expect(second).toEqual(first);
	expect(ports.submissionCount()).toBe(1);
	await ports.compute.dispose();
});

it("binds the scope, request and job durably so a lost reply is found by lookup", async () => {
	const ports = await setup();
	await caller(ports);
	const binding = await ports.bindings.find({
		request,
		scope,
		inputSha256: p5RerunInputHash(request),
	});
	expect(binding?.jobId).toBeTruthy();
	expect(binding?.scope).toEqual(scope);
	expect(binding?.expectedSha256).toBe(request.expectedSha256);
	await ports.compute.dispose();
});

it("never lets another scope find the binding", async () => {
	const ports = await setup();
	await caller(ports);
	const found = await ports.findSubmission(request, otherScope);
	expect(found).toBeUndefined();
	await ports.compute.dispose();
});

it("denies before any submit when the source hash does not match", async () => {
	const ports = await setup();
	ports.sourceOf.mockResolvedValue({
		...ports.source,
		verifiedSha256: "e".repeat(64),
	});
	expect(await caller(ports)).toMatchObject({ status: "failed", code: "READBACK_FAILED" });
	expect(ports.submissionCount()).toBe(0);
	await ports.compute.dispose();
});

it("denies before any submit when the source is unknown", async () => {
	const ports = await setup();
	ports.sourceOf.mockResolvedValue(undefined);
	expect(await caller(ports)).toMatchObject({ status: "failed", code: "INVALID_INPUT" });
	expect(ports.submissionCount()).toBe(0);
	await ports.compute.dispose();
});

it("records the broker's denial without submitting", async () => {
	const ports = await setup();
	expect(await caller(ports, request, false)).toMatchObject({ status: "failed", code: "DENIED" });
	expect(ports.submissionCount()).toBe(0);
	await ports.compute.dispose();
});

it("does not submit again when the compute submission itself failed", async () => {
	const ports = await setup();
	const spy = vi.spyOn(ports.compute, "submit").mockRejectedValue(new Error("synthetic failure"));
	expect(await caller(ports)).toMatchObject({ status: "failed" });
	spy.mockRestore();
	expect(ports.submissionCount()).toBe(0);
	await ports.compute.dispose();
});

it("recovers a lost confirmation from the idempotency key without resubmitting", async () => {
	const ports = await setup();
	const confirm = vi.spyOn(ports.bindings, "confirm").mockRejectedValue(new Error("synthetic lost reply"));
	expect(await caller(ports)).toMatchObject({ status: "failed" });
	confirm.mockRestore();
	expect(ports.submissionCount()).toBe(1);
	// The binding never recorded the job id; the idempotency key still finds it.
	const binding = await ports.bindings.find({
		request,
		scope,
		inputSha256: p5RerunInputHash(request),
	});
	expect(binding?.jobId).toBeNull();
	const found = await ports.findSubmission(request, scope);
	expect(found?.jobId).toBeTruthy();
	await ports.compute.dispose();
});

it("finds the job through the durable binding even when the job list is empty", async () => {
	const ports = await setup();
	await caller(ports);
	const listJobs = vi.spyOn(ports.compute, "listJobs").mockResolvedValue([]);
	const found = await ports.findSubmission(request, scope);
	expect(found?.jobId).toBeTruthy();
	listJobs.mockRestore();
	await ports.compute.dispose();
});

it("never drops a confirmed job id when the intent is recorded again", async () => {
	const directory = await mkdtemp(join(tmpdir(), "drone-p5-rerun-rebind-"));
	const store = createP5RerunBindingStore({
		path: join(directory, "p5-rerun-bindings.json"),
		registry: new StorageRegistry(),
	});
	const key = { request, scope, inputSha256: p5RerunInputHash(request) };
	const binding = {
		requestId: request.requestId,
		scope,
		inputSha256: key.inputSha256,
		sourceRunReceiptRef: request.sourceRunReceiptRef,
		artifactId: request.artifactId,
		expectedSha256: request.expectedSha256,
		profile: request.profile,
		preflightRef: request.preflightRef,
		jobId: null,
		idempotencyKey: `p5-rerun:${key.inputSha256}`,
	};
	await store.bind(binding);
	await store.confirm(key, "job-1");
	await store.bind(binding);
	expect((await store.find(key))?.jobId).toBe("job-1");
});

it("keeps the binding ledger readable after a reopen and drops a tampered entry", async () => {
	const directory = await mkdtemp(join(tmpdir(), "drone-p5-rerun-ledger-"));
	const path = join(directory, "p5-rerun-bindings.json");
	const store = createP5RerunBindingStore({ path, registry: new StorageRegistry() });
	const key = { request, scope, inputSha256: p5RerunInputHash(request) };
	await store.bind({
		requestId: request.requestId,
		scope,
		inputSha256: key.inputSha256,
		sourceRunReceiptRef: request.sourceRunReceiptRef,
		artifactId: request.artifactId,
		expectedSha256: request.expectedSha256,
		profile: request.profile,
		preflightRef: request.preflightRef,
		jobId: null,
		idempotencyKey: `p5-rerun:${key.inputSha256}`,
	});
	const reopened = createP5RerunBindingStore({ path, registry: new StorageRegistry() });
	expect((await reopened.find(key))?.requestId).toBe(request.requestId);
	const stored = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>[];
	stored[0] = { ...stored[0], inputSha256: "f".repeat(64) };
	await writeFile(path, JSON.stringify(stored));
	const tampered = createP5RerunBindingStore({ path, registry: new StorageRegistry() });
	expect(await tampered.find(key)).toBeUndefined();
});
