import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { StorageRegistry } from "../storage/registry";
import { type ComputeExecutor, ComputeService } from "./compute";

const JOB_ID = "job-1";
const REMOTE_JOB_ID = "runner-job-1";

function createService(agentDir: string, executor?: ComputeExecutor): ComputeService {
	const service = new ComputeService({ agentDir, executor, storage: new StorageRegistry() });
	onTestFinished(() => service.dispose());
	return service;
}

async function submitJob(
	status: "running" | "succeeded" | "queued",
	poll: ComputeExecutor["status"],
	cancel?: ComputeExecutor["cancel"],
) {
	const agentDir = await mkdtemp(join(tmpdir(), "drone-compute-reconcile-"));
	const service = createService(agentDir, {
		submit: async () => ({ status, remoteId: REMOTE_JOB_ID, pid: 123 }),
		status: poll,
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

async function cancelRunningJob(poll: ComputeExecutor["status"], state: "unknown" | "failed" = "unknown") {
	const { agentDir, service } = await submitJob("running", poll, async () => ({
		status: "succeeded",
		cleanup: { state, jobId: REMOTE_JOB_ID },
	}));
	const job = await service.cancel(JOB_ID);
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

it("records confirmed terminal cleanup without changing the execution outcome", async () => {
	const cleanup = { state: "confirmed", jobId: REMOTE_JOB_ID };
	const { agentDir, service, job } = await cancelRunningJob(async () => ({
		status: "failed",
		remoteId: "other",
		pid: 456,
		error: "late runner error",
		cleanup,
	}));
	const eventsBefore = await service.listEvents(JOB_ID);
	await service.reconcile(JOB_ID);
	await service.dispose();

	const reopened = createService(agentDir);
	expect(await reopened.getJob(JOB_ID)).toEqual({
		...job,
		status: "succeeded",
		updatedAt: expect.any(Number),
		cleanup,
	});
	expect(await reopened.listEvents(JOB_ID)).toEqual([
		...eventsBefore,
		expect.objectContaining({ jobId: JOB_ID, type: "cleanup", status: "succeeded" }),
	]);
});

it("rejects foreign terminal cleanup without recording another event", async () => {
	const poll = vi.fn<ComputeExecutor["status"]>(async () => ({
		status: "succeeded",
		cleanup: { state: "confirmed", jobId: "other" },
	}));
	const { agentDir, service } = await cancelRunningJob(poll);
	const eventsBefore = await service.listEvents(JOB_ID);
	await service.reconcile(JOB_ID);
	expect(poll).toHaveBeenCalledOnce();
	await service.dispose();

	const reopened = createService(agentDir);
	expect(await reopened.getJob(JOB_ID)).toHaveProperty("cleanup", {
		state: "unknown",
		jobId: REMOTE_JOB_ID,
	});
	expect(await reopened.listEvents(JOB_ID)).toEqual(eventsBefore);
});

it("persists a terminal cleanup query error without recording an error event", async () => {
	const error = new Error("connection lost during cleanup query");
	const { agentDir, service, job } = await cancelRunningJob(async () => {
		throw error;
	});
	const eventsBefore = await service.listEvents(JOB_ID);
	await service.reconcile(JOB_ID);
	await service.dispose();

	const reopened = createService(agentDir);
	expect(await reopened.getJob(JOB_ID)).toEqual({
		...job,
		status: "succeeded",
		updatedAt: expect.any(Number),
		cleanup: { state: "unknown", jobId: REMOTE_JOB_ID, error: String(error) },
	});
	expect(await reopened.listEvents(JOB_ID)).toEqual(eventsBefore);
});

it("does not poll a terminal job whose cleanup failed", async () => {
	const poll = vi.fn<ComputeExecutor["status"]>(async () => ({ status: "succeeded" }));
	const { agentDir, service, job } = await cancelRunningJob(poll, "failed");
	expect(await service.reconcile(JOB_ID)).toEqual([job]);
	expect(poll).not.toHaveBeenCalled();
	await service.dispose();

	const reopened = createService(agentDir);
	expect(await reopened.getJob(JOB_ID)).toEqual(job);
	expect(await reopened.getJob(JOB_ID)).toHaveProperty("cleanup.state", "failed");
});

it("rejects foreign cleanup while polling a running job", async () => {
	const { agentDir, service } = await submitJob("running", async () => ({
		status: "running",
		cleanup: { state: "confirmed", jobId: "other" },
	}));
	await service.reconcile(JOB_ID);
	await service.dispose();

	const reopened = createService(agentDir);
	expect(await reopened.getJob(JOB_ID)).toMatchObject({
		status: "running",
		cleanup: { state: "unknown", jobId: REMOTE_JOB_ID },
	});
});

it("preserves prior cleanup when a poll omits cleanup", async () => {
	const cleanup = { state: "confirmed", jobId: REMOTE_JOB_ID };
	const poll = vi
		.fn<ComputeExecutor["status"]>(async () => ({ status: "running" }))
		.mockResolvedValueOnce({ status: "running", cleanup });
	const { agentDir, service } = await submitJob("running", poll);
	await service.reconcile(JOB_ID);
	await service.reconcile(JOB_ID);
	expect(poll).toHaveBeenCalledTimes(2);
	await service.dispose();

	const reopened = createService(agentDir);
	expect(await reopened.getJob(JOB_ID)).toMatchObject({ status: "running", cleanup });
});

it("persists unknown cleanup without emitting an event when the first terminal cleanup query throws", async () => {
	const error = new Error("connection lost during cleanup query");
	const poll = vi
		.fn<ComputeExecutor["status"]>()
		.mockResolvedValueOnce({ status: "succeeded" })
		.mockRejectedValueOnce(error);
	const { agentDir, service } = await submitJob("running", poll);
	await service.cancel(JOB_ID);
	await service.reconcile(JOB_ID);
	expect(await service.getJob(JOB_ID)).not.toHaveProperty("cleanup");
	await service.reconcile(JOB_ID);
	await service.dispose();

	const reopened = createService(agentDir);
	const job = await reopened.getJob(JOB_ID);
	expect(job).toHaveProperty("status", "succeeded");
	expect(job).toHaveProperty("cleanup", { state: "unknown", jobId: REMOTE_JOB_ID, error: String(error) });
	const events = await reopened.listEvents(JOB_ID);
	expect(events.filter((event) => event.type === "cleanup" || event.type === "error")).toEqual([]);
});
