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

async function submitJob(status: "running" | "succeeded" | "queued", poll: ComputeExecutor["status"]) {
	const agentDir = await mkdtemp(join(tmpdir(), "drone-compute-reconcile-"));
	const service = createService(agentDir, {
		submit: async () => ({ status, remoteId: "runner-job-1", pid: 123 }),
		status: poll,
	});
	await service.upsertHost({ alias: "local", host: "127.0.0.1", username: "runner" });
	const job = await service.submit({
		jobId: JOB_ID,
		hostAlias: "local",
		workflow: { version: 1, modules: [], steps: [] },
	});
	return { agentDir, service, job };
}

describe("ComputeService reconcile", () => {
	it("persists a succeeded job and records a status event", async () => {
		const { agentDir, service } = await submitJob("running", async () => ({ status: "succeeded" }));
		await service.reconcile(JOB_ID);
		await service.dispose();

		const reopened = createService(agentDir);
		expect(await reopened.getJob(JOB_ID)).toHaveProperty("status", "succeeded");
		expect(await reopened.listEvents(JOB_ID)).toContainEqual(
			expect.objectContaining({ jobId: JOB_ID, type: "status", status: "succeeded" }),
		);
	});

	it("persists an unknown job and the error when executor status throws", async () => {
		const error = new Error("connection lost during status query");
		const { agentDir, service } = await submitJob("running", async () => {
			throw error;
		});
		await service.reconcile(JOB_ID);
		await service.dispose();

		const reopened = createService(agentDir);
		expect(await reopened.getJob(JOB_ID)).toMatchObject({ status: "unknown", error: String(error) });
	});

	it("leaves a succeeded job unchanged without polling the executor", async () => {
		const poll = vi.fn<ComputeExecutor["status"]>(async () => ({ status: "running" }));
		const { agentDir, service, job } = await submitJob("succeeded", poll);
		expect(await service.reconcile(JOB_ID)).toEqual([job]);
		expect(poll).not.toHaveBeenCalled();
		await service.dispose();

		const reopened = createService(agentDir);
		expect(await reopened.getJob(JOB_ID)).toEqual(job);
	});

	it("keeps a queued job queued after a stale submitting response", async () => {
		const poll = vi.fn<ComputeExecutor["status"]>(async () => ({ status: "submitting" }));
		const { agentDir, service } = await submitJob("queued", poll);
		await service.reconcile(JOB_ID);
		expect(poll).toHaveBeenCalledOnce();
		await service.dispose();

		const reopened = createService(agentDir);
		expect(await reopened.getJob(JOB_ID)).toHaveProperty("status", "queued");
	});
});
