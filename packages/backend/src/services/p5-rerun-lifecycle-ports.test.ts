import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Scope } from "@gyoungwe/plugin-api/p5-receipts";
import { expect, it, vi } from "vitest";
import { createP5ReceiptStore } from "../plugins/p5-receipt-store";
import {
	type P5RerunLifecyclePorts,
	type P5RerunRun,
	p5RerunLifecycleHandlers,
} from "../plugins/p5-rerun-lifecycle";
import { PluginCapabilityBroker } from "../plugins/runtime-capabilities";
import { StorageRegistry } from "../storage/registry";
import { type ComputeExecutor, ComputeService } from "./compute";
import { createP5RerunLifecyclePorts } from "./p5-rerun-lifecycle-ports";

const sha = "a".repeat(64);
const outputSha256 = "54034ac5c6e9ea95734ec2b729fd6d62abf64af34a9f9ce5d466cb788191a73d";
const sourceSha256 = "8482cb75bd3c9abc864397324f7ba6cdbdb4920fe384ef7ee34b6ab4996ae8b2";
const scope: Scope = { workspaceId: "w", sessionId: "s", callerSourceHash: sha, providerSourceHash: sha };
const request = { requestId: "rerun-1" };
const source = {
	runId: "run-1",
	sourceRunReceiptRef: "original-1",
	workspaceId: scope.workspaceId,
	artifactId: "artifact-1",
	verifiedSha256: sourceSha256,
	profile: "profile-1",
};
const artifact = {
	id: "o",
	path: "o",
	bytes: 4,
	sha256: outputSha256,
	parentIds: [],
	purpose: "evidence" as const,
};
const sourceBody = Buffer.from("source bytes\n");
const outputBody = Buffer.from("out\n");

/**
 * The executor's remote state drives the job's live status; a cancel makes it
 * terminal, so a cancel test needs a job that is still running.
 */
function createExecutor(outputRoot: string, jobStatus?: string, collectBody?: Buffer) {
	let cancels = 0;
	let remoteStatus = jobStatus ?? "succeeded";
	const executor: ComputeExecutor = {
		submit: async () => ({ status: "queued" }),
		status: async () => ({ status: remoteStatus as "succeeded" }),
		cancel: async () => {
			cancels += 1;
			remoteStatus = "cancelled";
			return { status: "cancelled" };
		},
		collect: async (_job, _host, collectOptions) => {
			const body = collectBody ?? outputBody;
			await writeFile(join(collectOptions?.targetDir ?? outputRoot, artifact.path), body);
			// The manifest must declare the bytes the runner actually wrote.
			return {
				manifest: {
					version: 1 as const,
					entries: [
						{
							path: artifact.path,
							size: body.byteLength,
							sha256: createHash("sha256").update(body).digest("hex"),
						},
					],
				},
			};
		},
	};
	return { executor, cancelCount: () => cancels };
}

/**
 * Call a lifecycle handler through the broker, so approval and scope come from
 * the same path the plugin uses.
 */
function callLifecycle(
	ports: P5RerunLifecyclePorts,
	name: string,
	input: unknown,
	caller: Scope,
	approved: boolean,
) {
	const broker = new PluginCapabilityBroker({
		resources: [],
		handlers: p5RerunLifecycleHandlers({ ...ports, scope: () => caller }),
	});
	return broker.run(
		{
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
		},
		"write",
		() => undefined,
		async () => approved,
		() => broker.port.call(`compute.rerun.${name}`, input),
	);
}

async function setup(options?: { jobStatus?: string; collectBody?: Buffer }) {
	const directory = await mkdtemp(join(tmpdir(), "drone-p5-lifecycle-ports-"));
	const agentDir = join(directory, "agent");
	const outputRoot = join(directory, "output");
	const registry = new StorageRegistry();
	const { executor, cancelCount } = createExecutor(outputRoot, options?.jobStatus, options?.collectBody);
	const service = new ComputeService({ storage: registry, agentDir, executor });
	await service.upsertHost({ alias: "local", host: "127.0.0.1", username: "runner" });
	// A real submitted job: the ports must operate on a job the service knows.
	const submitted = await service.submit({
		hostAlias: "local",
		workflow: { version: 1, modules: [], steps: [] },
	});
	const receiptPath = join(agentDir, "p5-receipts.json");
	const store = createP5ReceiptStore({ path: receiptPath, registry });
	await store.accept(request, {
		receiptRef: "submit-1",
		operation: "compute.rerun.submit",
		inputSha256: sha,
		scope,
		category: "compute-preflight",
		decision: "approved",
		status: "accepted",
		at: "2026-11-22T00:00:00Z",
		parentReceiptRef: "original-1",
		resultSha256: null,
		readback: [],
	});
	const sourcePath = join(directory, "source.bin");
	await writeFile(sourcePath, sourceBody);
	const run = {
		...({} as P5RerunRun),

		jobId: submitted.jobId,
		inputSha256: sha,
		source,
		status: "accepted" as P5RerunRun["status"],
		artifacts: [artifact],
	};
	const runOf = vi.fn(async () => run);
	const submit = { store, scope: () => scope, now: () => "2026-11-22T00:00:00Z" };
	const ports = createP5RerunLifecyclePorts({
		compute: service,
		submit,
		outputRoot,
		runOf,
		sourcePathOf: () => sourcePath,
	});
	const call = (name: string, input: unknown = request, caller = scope, approved = true) =>
		callLifecycle(ports, name, input, caller, approved);
	return { ports, call, runOf, service, cancelCount, run };
}

it("reports the actual job status and never downgrades a terminal state", async () => {
	const f = await setup({ jobStatus: "running" });
	expect(await f.call("status")).toHaveProperty("value.status", "running");
	await f.service.dispose();
});

it("preserves a terminal run state in the status port itself", async () => {
	const f = await setup({ jobStatus: "succeeded" });
	f.run.status = "cancelled";
	// The plugin short-circuits a terminal run before it reaches the port, so
	// the port's own guard has to be exercised directly.
	const state = await f.ports.status(f.run, {
		scope: { kind: "session", workspaceId: "w", workspaceDirectory: "/tmp", sessionId: "s" },
		signal: new AbortController().signal,
	} as never);
	expect(state.status).toBe("cancelled");
	await f.service.dispose();
});

it("never cancels a terminal run in the cancel port itself", async () => {
	const f = await setup({ jobStatus: "succeeded" });
	f.run.status = "succeeded";
	expect(
		await f.ports.cancel(f.run, {
			scope: { kind: "session", workspaceId: "w", workspaceDirectory: "/tmp", sessionId: "s" },
			signal: new AbortController().signal,
		} as never),
	).toBe("succeeded");
	expect(f.cancelCount()).toBe(0);
	await f.service.dispose();
});

it("keeps a cancelled run cancelled even when the job reports success", async () => {
	const f = await setup({ jobStatus: "succeeded" });
	f.run.status = "cancelled";
	expect(await f.call("status")).toHaveProperty("value.status", "cancelled");
	await f.service.dispose();
});

it("keeps a terminal run terminal even when the compute job no longer exists", async () => {
	const f = await setup({ jobStatus: "succeeded" });
	f.run.status = "cancelled";
	const status = vi.spyOn(f.service, "status").mockRejectedValue(new Error("missing job"));
	expect(await f.call("status")).toHaveProperty("value.status", "cancelled");
	status.mockRestore();
	await f.service.dispose();
});

it("never cancels a run that already reached a terminal state", async () => {
	const f = await setup({ jobStatus: "succeeded" });
	f.run.status = "succeeded";
	expect(await f.call("cancel")).toHaveProperty("value.status", "succeeded");
	expect(f.cancelCount()).toBe(0);
	await f.service.dispose();
});

it("reconciles the job before collecting so a finished job can be collected", async () => {
	const f = await setup({ jobStatus: "succeeded" });
	// The stored job status is still queued until the service reconciles it,
	// so a direct collect must reconcile before it can collect.
	const stored = await f.service.getJob(f.run.jobId);
	expect(stored?.status).toBe("queued");
	const collected = await f.ports.collect(f.run, {
		scope: { kind: "session", workspaceId: "w", workspaceDirectory: "/tmp", sessionId: "s" },
		signal: new AbortController().signal,
	} as never);
	expect(collected.sourceSha256).toBe(sourceSha256);
	await f.service.dispose();
});

it("collects with the actual bytes and succeeds when they match the run", async () => {
	const f = await setup();
	const outcome = (await f.call("collect")) as {
		status: string;
		value?: { status: string };
	};
	if (outcome.status !== "ok") throw new Error("Expected a collect outcome");
	expect(outcome.value?.status).toBe("succeeded");
	await f.service.dispose();
});

it("fails the collect when the collected bytes differ from the run's artifacts", async () => {
	const f = await setup({ collectBody: Buffer.from("different\n") });
	expect(await f.call("collect")).toMatchObject({ status: "failed", code: "READBACK_FAILED" });
	await f.service.dispose();
});

it("cancels the compute job and reports the cancellation", async () => {
	const f = await setup({ jobStatus: "running" });
	expect(await f.call("cancel")).toHaveProperty("value.status", "cancelled");
	expect(f.cancelCount()).toBe(1);
	await f.service.dispose();
});

it("never looks up a run outside the receipt's scope", async () => {
	const f = await setup();
	const missing = await f.call("status", { requestId: "missing" });
	expect(missing).toEqual({ status: "failed", code: "DENIED", receiptRef: null });
	expect(f.runOf).not.toHaveBeenCalled();
	await f.service.dispose();
});

it("reports an unknown outcome when the compute job has disappeared", async () => {
	const f = await setup();
	f.run.status = "accepted";
	const getJob = vi.spyOn(f.service, "status").mockRejectedValue(new Error("missing job"));
	expect(await f.call("status")).toHaveProperty("value.status", "outcome-unknown");
	getJob.mockRestore();
	await f.service.dispose();
});
