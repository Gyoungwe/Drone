import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type JobRecord, RunnerClient } from "@drone/compute";
import { afterEach, expect, it, vi } from "vitest";
import { DefaultComputeExecutor } from "./default-executor";

const host = { alias: "local", host: "local" };
const job: JobRecord = {
	jobId: "host-job",
	remoteId: "remote-job",
	hostAlias: host.alias,
	spec: { jobId: "host-job", hostAlias: host.alias, workflow: { name: "test/workflow", version: "1.0.0" } },
	status: "running",
	createdAt: 0,
	updatedAt: 0,
};
const confirmed = {
	state: "confirmed",
	jobId: "remote-job",
	method: "slurm",
	observedAt: "2026-11-19T00:00:00Z",
};

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});

async function readMockStatus(record: Record<string, unknown>) {
	vi.spyOn(RunnerClient.prototype, "execute").mockImplementation(async (command, payload, jobId) => {
		if (command === "status" && payload === undefined && jobId === job.remoteId) return record;
		throw new Error(`Unexpected runner request: ${command} ${jobId}`);
	});
	const executor = new DefaultComputeExecutor();
	try {
		return await executor.status(job, host);
	} finally {
		await executor.dispose();
	}
}

it("returns confirmed cleanup alongside the existing status fields", async () => {
	const fields = { remoteId: "wire-id", pid: 42, cleanup: confirmed };
	const result = await readMockStatus({ state: "failed", message: "failure", ...fields });
	expect(result).toEqual({ status: "failed", error: "failure", ...fields });
});

it.each([
	["another job", { ...confirmed, jobId: "other-job" }, "slurm"],
	["a missing observation time", { state: "confirmed", jobId: "remote-job", method: "direct" }, "direct"],
	["a bad state", { ...confirmed, state: "cancelled" }, "slurm"],
	["a bad method", { ...confirmed, method: "ssh" }, "direct"],
	["a null record", null, "direct"],
])("returns unknown cleanup for %s", async (_label, cleanup, method) => {
	const result = await readMockStatus({ state: "cancelled", cleanup });
	expect(result.cleanup).toEqual({ state: "unknown", jobId: "remote-job", method });
});

it.each(["running", "cancelled"])("omits cleanup when a %s record has none", async (state) => {
	const result = await readMockStatus({ state });
	expect(result.status).toBe(state);
	expect(result).not.toHaveProperty("cleanup");
});

const cancelFixture = `
const { readdir } = require("node:fs/promises");
async function run() {
	for (;;) {
		const files = await readdir("..");
		if (files.includes("cancel-requested.json")) return 1;
		if (files.includes("release")) return 0;
	}
}
run().then((code) => { process.exitCode = code; });
`;

async function waitForTerminal(runDir: string) {
	for (;;) {
		const record = JSON.parse(await readFile(join(runDir, "status.json"), "utf8"));
		if (["succeeded", "failed", "cancelled"].includes(record.state)) return;
	}
}

it("reads the cleanup recorded by the real local runner after cancel", async () => {
	const root = await mkdtemp(join(tmpdir(), "drone-status-evidence-"));
	const registry = join(root, "registry.json");
	await writeFile(registry, JSON.stringify({ "test/workflow": [process.execPath, "-e", cancelFixture] }));
	vi.stubEnv("DRONE_RUNNER_WORKFLOW_REGISTRY", registry);
	vi.stubEnv("DRONE_REMOTE_ROOT", root);
	vi.stubEnv("DRONE_RUNNER_SCHEDULER", "direct");
	const executor = new DefaultComputeExecutor();
	try {
		const submitted = await executor.submit(job.spec, host);
		const submittedJob = { ...job, remoteId: submitted.remoteId };
		const runDir = join(root, "runs", job.jobId);
		try {
			const cancelled = await executor.cancel(submittedJob, host);
			await waitForTerminal(runDir);
			const status = await executor.status(submittedJob, host);
			console.info("Local direct cancel result:", JSON.stringify(cancelled));
			console.info("Local direct status result:", JSON.stringify(status));
			expect(cancelled.cleanup).toMatchObject({
				jobId: job.jobId,
				method: "direct",
				observedAt: expect.any(String),
			});
			expect(status.status).toBe("cancelled");
			expect(status.cleanup).toEqual(cancelled.cleanup);
		} finally {
			await writeFile(join(runDir, "release"), "release");
			await waitForTerminal(runDir);
		}
	} finally {
		await executor.dispose();
	}
});
