import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HostProfile, JobRecord, JobSpec } from "@drone/compute";
import type { DroneRuntime } from "@drone/shared";
import { expect, it, onTestFinished, vi } from "vitest";
import { createDroneRuntime } from "../runtime";
import { StorageRegistry } from "../storage/registry";
import {
	type ComputeCollectOptions,
	type ComputeCollectResult,
	type ComputeExecutor,
	type ComputeJobInput,
	ComputeService,
	type ComputeSubmitResult,
} from "./compute";

const jobSpec: ComputeJobInput & { jobId: string } = {
	jobId: "job-1",
	hostAlias: "local",
	workflow: { version: 1, modules: [], steps: [] },
};

function createService(agentDir: string, executor?: ComputeExecutor, runtime?: DroneRuntime): ComputeService {
	const service = new ComputeService({ agentDir, executor, runtime, storage: new StorageRegistry() });
	onTestFinished(() => service.dispose());
	return service;
}

function deferred<T>() {
	let resolve: (value: T) => void = vi.fn();
	let reject: (reason: Error) => void = vi.fn();
	const promise = new Promise<T>((complete, fail) => {
		resolve = complete;
		reject = fail;
	});
	return { promise, resolve, reject };
}

async function setup(runtime?: DroneRuntime) {
	const agentDir = await mkdtemp(join(tmpdir(), "drone-compute-inflight-"));
	const submitStarted = deferred<AbortSignal | undefined>();
	const collectStarted = deferred<AbortSignal | undefined>();
	const submitResult = deferred<ComputeSubmitResult>();
	const collectResult = deferred<ComputeCollectResult>();
	const submit = vi.fn((_spec: JobSpec, _host: HostProfile, signal?: AbortSignal) => {
		submitStarted.resolve(signal);
		return submitResult.promise;
	});
	const collect = vi.fn(
		(_job: JobRecord, _host: HostProfile, _options?: ComputeCollectOptions, signal?: AbortSignal) => {
			collectStarted.resolve(signal);
			return collectResult.promise;
		},
	);
	const service = createService(
		agentDir,
		{ submit, collect, status: async () => ({ status: "succeeded" }) },
		runtime,
	);
	await service.upsertHost({ alias: "local", host: "127.0.0.1", username: "runner" });
	return { agentDir, service, submit, collect, submitStarted, collectStarted, submitResult, collectResult };
}

async function holdJobLock(runtime: DroneRuntime) {
	const release = await runtime.scheduler.acquire(`compute:${jobSpec.jobId}`);
	onTestFinished(release);
	const queued = deferred<void>();
	const run = runtime.scheduler.run.bind(runtime.scheduler);
	vi.spyOn(runtime.scheduler, "run").mockImplementationOnce((key, task) => {
		const operation = run(key, task);
		queued.resolve();
		return operation;
	});
	return { release, queued: queued.promise };
}

it("aborts a pending submit and drains its unknown outcome before disposing", async () => {
	const { agentDir, service, submitStarted, submitResult } = await setup();
	const listener = vi.fn();
	service.onEvent(listener);
	const submitting = service.submit(jobSpec);
	const executorSignal = await submitStarted.promise;
	const initiallyAborted = executorSignal?.aborted;
	const disposed = vi.fn();
	const disposing = service.dispose().then(disposed);
	await Promise.resolve();
	const resolvedEarly = disposed.mock.calls.length > 0;
	const abortedDuringDispose = executorSignal?.aborted;
	const error = new Error("submit aborted before receiving runner result");
	submitResult.reject(error);
	await disposing;
	const reopened = createService(agentDir);
	const persisted = await reopened.getJob(jobSpec.jobId);

	expect(initiallyAborted).toBe(false);
	expect(abortedDuringDispose).toBe(true);
	expect(resolvedEarly).toBe(false);
	expect(persisted).toMatchObject({ status: "unknown", error: String(error) });
	expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: "error", status: "unknown" }));
	await expect(submitting).resolves.toEqual(persisted);
});

it("passes caller cancellation to a pending collect without recording collection", async () => {
	const { agentDir, service, submitResult, collectStarted, collectResult } = await setup();
	submitResult.resolve({ status: "succeeded" });
	await service.submit(jobSpec);
	const caller = new AbortController();
	const collecting = service.collect(jobSpec.jobId, { targetDir: join(agentDir, "output") }, caller.signal);
	const executorSignal = await collectStarted.promise;
	const error = new Error("caller stopped collection");
	const rejection = expect(collecting).rejects.toBe(error);
	caller.abort(error);
	collectResult.reject(error);

	await rejection;
	expect(executorSignal?.aborted).toBe(true);
	expect(executorSignal?.reason).toBe(caller.signal.reason);
	expect(await service.listEvents(jobSpec.jobId)).not.toContainEqual(
		expect.objectContaining({ type: "collected" }),
	);
});

it("rejects an already aborted submit before calling the executor", async () => {
	const { service, submit, submitResult } = await setup();
	submitResult.resolve({ status: "succeeded" });
	const signal = AbortSignal.abort();

	await expect(service.submit(jobSpec, signal)).rejects.toBe(signal.reason);
	expect(submit).not.toHaveBeenCalled();
});

it("rejects submit after disposal before calling the executor", async () => {
	const { service, submit, submitResult } = await setup();
	submitResult.resolve({ status: "succeeded" });
	await service.dispose();

	await expect(service.submit(jobSpec)).rejects.toThrow();
	expect(submit).not.toHaveBeenCalled();
});

it("resolves dispose when a pending collect rejects during drain", async () => {
	const { agentDir, service, submitResult, collectStarted, collectResult } = await setup();
	submitResult.resolve({ status: "succeeded" });
	await service.submit(jobSpec);
	const collecting = service.collect(jobSpec.jobId, { targetDir: join(agentDir, "output") });
	const executorSignal = await collectStarted.promise;
	const disposing = service.dispose();
	const error = new Error("collection interrupted during shutdown");
	const rejection = expect(collecting).rejects.toBe(error);
	collectResult.reject(error);

	await expect(disposing).resolves.toBeUndefined();
	await rejection;
	expect(executorSignal?.aborted).toBe(true);
});

it("reuses a job ID only for the same specification", async () => {
	const { service, submit, submitResult } = await setup();
	submitResult.resolve({ status: "succeeded" });
	const existing = await service.submit(jobSpec);

	await expect(service.submit({ ...jobSpec, outputs: ["report.txt"] })).rejects.toHaveProperty(
		"message",
		`Compute job already exists with a different specification: ${jobSpec.jobId}`,
	);
	await expect(service.submit(jobSpec)).resolves.toEqual(existing);
	expect(submit).toHaveBeenCalledTimes(1);
});

it("reuses an idempotency key across job IDs only for the same specification", async () => {
	const { service, submit, submitResult } = await setup();
	submitResult.resolve({ status: "succeeded" });
	const original = { ...jobSpec, idempotencyKey: "report-once" };
	const existing = await service.submit(original);
	const retry = { ...original, jobId: "job-2" };

	await expect(service.submit({ ...retry, outputs: ["report.txt"] })).rejects.toHaveProperty(
		"message",
		`Compute idempotency key already exists with a different specification: ${original.idempotencyKey}`,
	);
	await expect(service.submit(retry)).resolves.toEqual(existing);
	expect(submit).toHaveBeenCalledTimes(1);
});

it("does not call the executor when a queued submit is aborted", async () => {
	const runtime = createDroneRuntime();
	const { service, submit, submitResult } = await setup(runtime);
	submitResult.resolve({ status: "succeeded" });
	const { queued, release } = await holdJobLock(runtime);
	const caller = new AbortController();
	const error = new Error("caller stopped queued submission");
	const submitting = service.submit(jobSpec, caller.signal);

	await queued;
	caller.abort(error);
	release();

	const job = await submitting;
	expect(submit).not.toHaveBeenCalled();
	expect(job).toMatchObject({ status: "unknown", error: String(error) });
});

it("does not call the executor when a queued collect is aborted", async () => {
	const runtime = createDroneRuntime();
	const { agentDir, service, submitResult, collect, collectResult } = await setup(runtime);
	submitResult.resolve({ status: "succeeded" });
	collectResult.resolve({ manifest: { version: 1, entries: [], totalBytes: 0 } });
	await service.submit(jobSpec);
	const { queued, release } = await holdJobLock(runtime);
	const caller = new AbortController();
	const error = new Error("caller stopped queued collection");
	const collecting = service.collect(jobSpec.jobId, { targetDir: join(agentDir, "output") }, caller.signal);
	const rejection = expect(collecting).rejects.toBe(error);

	await queued;
	caller.abort(error);
	release();

	await rejection;
	expect(collect).not.toHaveBeenCalled();
});

it("does not record a verified collection returned after caller cancellation", async () => {
	const { agentDir, service, submitResult, collectStarted, collectResult } = await setup();
	submitResult.resolve({ status: "succeeded" });
	await service.submit(jobSpec);
	const targetDir = join(agentDir, "output");
	const caller = new AbortController();
	const error = new Error("caller stopped collection before the manifest arrived");
	const collecting = service.collect(jobSpec.jobId, { targetDir }, caller.signal);
	const rejection = expect(collecting).rejects.toBe(error);
	await collectStarted.promise;
	const path = "report.txt";
	const payload = Buffer.from("report\n");
	await writeFile(join(targetDir, path), payload);
	const sha256 = createHash("sha256").update(payload).digest("hex");

	caller.abort(error);
	collectResult.resolve({
		manifest: {
			version: 1,
			entries: [{ path, size: payload.byteLength, sha256 }],
			totalBytes: payload.byteLength,
		},
	});

	await rejection;
	expect(await service.listEvents(jobSpec.jobId)).not.toContainEqual(
		expect.objectContaining({ type: "collected" }),
	);
});

it("does not start polling when disposed during storage initialization", async () => {
	const agentDir = await mkdtemp(join(tmpdir(), "drone-compute-inflight-"));
	const service = new ComputeService({ agentDir, storage: new StorageRegistry() });
	vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
	onTestFinished(async () => {
		await service.dispose();
		vi.useRealTimers();
	});

	const initializing = service.init();
	await service.dispose();
	await initializing;

	expect(vi.getTimerCount()).toBe(0);
});
