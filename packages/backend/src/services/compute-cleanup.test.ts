import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { StorageRegistry } from "../storage/registry";
import { type ComputeExecutor, ComputeService } from "./compute";
import type { ComputeCleanupEvidence } from "./compute-cleanup";

const JOB_ID = "job-1";

function createService(agentDir: string, executor?: ComputeExecutor): ComputeService {
	const service = new ComputeService({ agentDir, executor, storage: new StorageRegistry() });
	onTestFinished(() => service.dispose());
	return service;
}

type Cancel = NonNullable<ComputeExecutor["cancel"]>;

async function submitJob(
	cancel: Cancel | undefined,
	status: "running" | "succeeded" | "failed",
	remoteId?: string,
) {
	const agentDir = await mkdtemp(join(tmpdir(), "drone-compute-cleanup-"));
	const executor: ComputeExecutor = {
		submit: async () => ({ status, remoteId }),
		status: async () => ({ status }),
		cancel,
	};
	const service = createService(agentDir, executor);
	await service.upsertHost({ alias: "local", host: "127.0.0.1", username: "runner" });
	const job = await service.submit({
		jobId: JOB_ID,
		hostAlias: "local",
		workflow: { version: 1, modules: [], steps: [] },
	});
	return { agentDir, executor, service, job };
}

describe("ComputeService cancel for running jobs", () => {
	it("persists executor cleanup evidence and records a cancelled event", async () => {
		const remoteId = "runner-job-1";
		const cleanup: ComputeCleanupEvidence = {
			state: "confirmed",
			jobId: remoteId,
			method: "direct",
			observedAt: "2026-11-20T07:00:00Z",
		};
		const { agentDir, service, job } = await submitJob(
			async () => {
				expect(await createService(agentDir).getJob(JOB_ID)).toMatchObject({
					status: "cancelling",
					cancelRequestedAt: expect.any(Number),
				});
				return { status: "cancelled", cleanup, remoteId: "runner-job-renamed", pid: 123 };
			},
			"running",
			remoteId,
		);
		expect(job.status).toBe("running");
		const cancelled = await service.cancel(job.jobId);
		expect(cancelled).toEqual(expect.objectContaining({ status: "cancelled", cleanup }));
		await service.dispose();

		const reopened = createService(agentDir);
		const persisted = await reopened.getJob(job.jobId);
		expect(persisted).toMatchObject({
			status: "cancelled",
			cancelRequestedAt: expect.any(Number),
			remoteId: "runner-job-renamed",
		});
		expect(persisted).toHaveProperty("cleanup", cleanup);
		expect(persisted).not.toHaveProperty("pid");
		expect(await reopened.listEvents(job.jobId)).toContainEqual(
			expect.objectContaining({ jobId: job.jobId, type: "cancelled", status: "cancelled" }),
		);
	});

	it("keeps cancelling when the executor returns no result", async () => {
		const { agentDir, service, job } = await submitJob(async () => undefined, "running");
		await service.cancel(job.jobId);
		await service.dispose();

		const reopened = createService(agentDir);
		expect(await reopened.getJob(job.jobId)).toMatchObject({
			status: "cancelling",
			cancelRequestedAt: expect.any(Number),
			cleanup: { state: "unknown", jobId: job.jobId },
		});
	});

	it("keeps cancelling when the executor reports a stale running status", async () => {
		const cleanup = { state: "unknown", jobId: JOB_ID, method: "slurm" };
		const { agentDir, service, job } = await submitJob(
			async () => ({ status: "running", cleanup }),
			"running",
		);
		await service.cancel(job.jobId);
		await service.dispose();

		const reopened = createService(agentDir);
		expect(await reopened.getJob(job.jobId)).toMatchObject({ status: "cancelling", cleanup });
		expect(await reopened.listEvents(job.jobId)).toContainEqual(
			expect.objectContaining({ jobId: job.jobId, type: "cancelled", status: "cancelling" }),
		);
	});
});

describe("ComputeService cancel with invalid or unavailable evidence", () => {
	it.each([
		{ state: "confirmed", jobId: "other-job" },
		{ state: "invalid", jobId: JOB_ID },
	])("rejects cleanup evidence with state $state and job ID $jobId", async (cleanup) => {
		const { agentDir, service, job } = await submitJob(
			async () => ({ status: "cancelling", cleanup }),
			"running",
		);
		await service.cancel(job.jobId);
		await service.dispose();

		const reopened = createService(agentDir);
		expect(await reopened.getJob(job.jobId)).toHaveProperty("cleanup", {
			state: "unknown",
			jobId: job.jobId,
		});
	});

	it("persists an unknown job and the error when executor cancellation throws", async () => {
		const error = new Error("connection lost during cancel");
		const { agentDir, service, job } = await submitJob(async () => {
			throw error;
		}, "running");
		const unknown = {
			status: "unknown",
			error: String(error),
			cleanup: { state: "unknown", jobId: job.jobId, error: String(error) },
		};
		expect(await service.cancel(job.jobId)).toMatchObject(unknown);
		await service.dispose();

		const reopened = createService(agentDir);
		expect(await reopened.getJob(job.jobId)).toMatchObject(unknown);
	});
});

describe("ComputeService cancel for terminal jobs", () => {
	it("queries cleanup without replacing the succeeded execution outcome", async () => {
		const cleanup = { state: "failed", jobId: JOB_ID };
		const { agentDir, service, job } = await submitJob(async () => {
			expect(await createService(agentDir).getJob(JOB_ID)).toMatchObject({
				status: "succeeded",
				cancelRequestedAt: expect.any(Number),
			});
			return { status: "cancelled", cleanup };
		}, "succeeded");
		await service.cancel(job.jobId);
		await service.dispose();

		const reopened = createService(agentDir);
		expect(await reopened.getJob(job.jobId)).toMatchObject({
			status: "succeeded",
			cleanup,
			cancelRequestedAt: expect.any(Number),
		});
		const events = await reopened.listEvents(job.jobId);
		expect(events).toContainEqual(expect.objectContaining({ type: "cleanup", status: "succeeded" }));
		expect(events).not.toContainEqual(expect.objectContaining({ type: "cancelled" }));
	});

	it("does not query cleanup again for a succeeded job with confirmed evidence", async () => {
		const cleanup = { state: "confirmed", jobId: JOB_ID };
		const cancel = vi.fn<Cancel>(async () => ({ status: "cancelled", cleanup }));
		const { agentDir, executor, service, job } = await submitJob(cancel, "succeeded");
		const cleaned = await service.cancel(job.jobId);
		await service.dispose();

		const reopened = createService(agentDir, executor);
		const persisted = await reopened.getJob(job.jobId);
		expect(persisted).toMatchObject({ status: "succeeded", cleanup });
		expect(persisted).toEqual(cleaned);
		cancel.mockClear();
		expect(await reopened.cancel(job.jobId)).toEqual(cleaned);
		expect(cancel).not.toHaveBeenCalled();
		expect(await createService(agentDir).getJob(job.jobId)).toEqual(cleaned);
	});
});

describe("ComputeService cancel when terminal cleanup cannot complete", () => {
	it("keeps a failed execution outcome when the cleanup query throws", async () => {
		const error = new Error("connection lost during cleanup query");
		const { agentDir, service, job } = await submitJob(async () => {
			throw error;
		}, "failed");
		await service.cancel(job.jobId);
		await service.dispose();

		const reopened = createService(agentDir);
		const persisted = await reopened.getJob(job.jobId);
		expect(persisted).toMatchObject({
			status: "failed",
			cancelRequestedAt: expect.any(Number),
			cleanup: { state: "unknown", jobId: job.jobId, error: String(error) },
		});
		expect(persisted).not.toHaveProperty("error");
		const events = await reopened.listEvents(job.jobId);
		expect(events).toContainEqual(expect.objectContaining({ type: "cleanup", status: "failed" }));
		expect(events).not.toContainEqual(expect.objectContaining({ type: "cancelled" }));
	});

	it("leaves a succeeded job unchanged when the executor cannot cancel", async () => {
		const { agentDir, service, job } = await submitJob(undefined, "succeeded");
		expect(job.status).toBe("succeeded");
		expect(await service.cancel(job.jobId)).toEqual(job);
		await service.dispose();

		expect(await createService(agentDir).getJob(job.jobId)).toEqual(job);
	});
});
