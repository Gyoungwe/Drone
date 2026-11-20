import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { StorageRegistry } from "../storage/registry";
import { type ComputeExecutor, ComputeService } from "./compute";

const JOB_ID = "job-1";

function createService(agentDir: string, executor?: ComputeExecutor): ComputeService {
	const service = new ComputeService({ agentDir, executor, storage: new StorageRegistry() });
	onTestFinished(() => service.dispose());
	return service;
}

async function submitJob(cancel: NonNullable<ComputeExecutor["cancel"]>, status: "running" | "succeeded") {
	const agentDir = await mkdtemp(join(tmpdir(), "drone-compute-cleanup-"));
	const service = createService(agentDir, {
		submit: async () => ({ status }),
		status: async () => ({ status }),
		cancel,
	});
	await service.upsertHost({ alias: "local", host: "127.0.0.1", username: "runner" });
	const job = await service.submit({
		jobId: JOB_ID,
		hostAlias: "local",
		workflow: { version: 1, modules: [], steps: [] },
	});
	return { agentDir, service, job };
}

describe("ComputeService cancel", () => {
	it("persists executor cleanup evidence and records a cancelled event", async () => {
		const cleanup = { state: "confirmed", jobId: JOB_ID, method: "direct", observedAt: 1_700_000_000_000 };
		const { agentDir, service, job } = await submitJob(
			async () => ({ status: "cancelled", cleanup }),
			"running",
		);
		expect(job.status).toBe("running");
		const cancelled = await service.cancel(job.jobId);
		expect(cancelled).toEqual(expect.objectContaining({ status: "cancelled", cleanup }));
		await service.dispose();

		const reopened = createService(agentDir);
		expect(await reopened.getJob(job.jobId)).toEqual(
			expect.objectContaining({ status: "cancelled", cleanup }),
		);
		expect(await reopened.listEvents(job.jobId)).toContainEqual(
			expect.objectContaining({ jobId: job.jobId, type: "cancelled", status: "cancelled" }),
		);
	});

	it("persists an unknown job and the error when executor cancellation throws", async () => {
		const error = new Error("connection lost during cancel");
		const { agentDir, service, job } = await submitJob(async () => {
			throw error;
		}, "running");
		const unknown = { status: "unknown", error: String(error) };
		expect(await service.cancel(job.jobId)).toMatchObject(unknown);
		await service.dispose();

		const reopened = createService(agentDir);
		expect(await reopened.getJob(job.jobId)).toMatchObject(unknown);
	});

	it("returns a succeeded job unchanged without calling the executor", async () => {
		const cancel = vi.fn<NonNullable<ComputeExecutor["cancel"]>>(async () => ({ status: "cancelled" }));
		const { service, job } = await submitJob(cancel, "succeeded");
		expect(job.status).toBe("succeeded");
		expect(await service.cancel(job.jobId)).toEqual(job);
		expect(cancel).not.toHaveBeenCalled();
	});
});
