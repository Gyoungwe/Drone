import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HostProfile, JobSpec } from "@drone/compute";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DefaultComputeExecutor } from "./default-executor";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const host: HostProfile = { alias: "local", host: "local", transport: "builtin-ssh" };
const spec: JobSpec = {
	jobId: "fixture-job",
	idempotencyKey: "fixture-once",
	hostAlias: "local",
	remoteWorkDir: join(tmpdir(), "drone-fixture-job"),
	workflow: { name: "test/workflow", version: "1.0.0" },
};

let previousRegistry: string | undefined;
let previousRemoteRoot: string | undefined;

beforeEach(async () => {
	previousRegistry = process.env.DRONE_RUNNER_WORKFLOW_REGISTRY;
	previousRemoteRoot = process.env.DRONE_REMOTE_ROOT;
	const root = await mkdtemp(join(tmpdir(), "drone-runner-test-"));
	const script = join(root, "workflow.py");
	const registry = join(root, "registry.json");
	await writeFile(
		script,
		"from pathlib import Path\nPath('multiqc_report.html').write_text('<html>fixture</html>\\n')\nPath('counts.tsv').write_text('gene\\tcount\\nfixture\\t1\\n')\n",
	);
	await writeFile(registry, JSON.stringify({ "test/workflow": ["python3", script] }));
	process.env.DRONE_RUNNER_WORKFLOW_REGISTRY = registry;
	process.env.DRONE_REMOTE_ROOT = join(root, "remote");
});

afterEach(() => {
	if (previousRegistry === undefined) delete process.env.DRONE_RUNNER_WORKFLOW_REGISTRY;
	else process.env.DRONE_RUNNER_WORKFLOW_REGISTRY = previousRegistry;
	if (previousRemoteRoot === undefined) delete process.env.DRONE_REMOTE_ROOT;
	else process.env.DRONE_REMOTE_ROOT = previousRemoteRoot;
});

async function createCancelFixture() {
	const registryBeforeFixture = process.env.DRONE_RUNNER_WORKFLOW_REGISTRY;
	const remoteRootBeforeFixture = process.env.DRONE_REMOTE_ROOT;
	const root = await mkdtemp(join(tmpdir(), "drone-cancel-fixture-"));
	const release = join(root, "release");
	const script = join(root, "workflow.py");
	await writeFile(
		script,
		`from pathlib import Path\nfrom threading import Event\nwhile not Path(${JSON.stringify(release)}).exists():\n    Event().wait(0.01)\n`,
	);
	const registry = join(root, "registry.json");
	await writeFile(registry, JSON.stringify({ "test/workflow": ["python3", script] }));
	process.env.DRONE_RUNNER_WORKFLOW_REGISTRY = registry;
	const remoteRoot = join(root, "remote");
	process.env.DRONE_REMOTE_ROOT = remoteRoot;
	return {
		release,
		remoteRoot,
		restore() {
			if (registryBeforeFixture === undefined) delete process.env.DRONE_RUNNER_WORKFLOW_REGISTRY;
			else process.env.DRONE_RUNNER_WORKFLOW_REGISTRY = registryBeforeFixture;
			if (remoteRootBeforeFixture === undefined) delete process.env.DRONE_REMOTE_ROOT;
			else process.env.DRONE_REMOTE_ROOT = remoteRootBeforeFixture;
		},
	};
}

async function waitForTerminal(remoteRoot: string, jobId: string) {
	const statusPath = join(remoteRoot, "runs", jobId, "status.json");
	for (;;) {
		try {
			const value = JSON.parse(await readFile(statusPath, "utf8"));
			if (["succeeded", "failed", "cancelled"].includes(value.state)) return;
		} catch (error) {
			// The runner may still be publishing a missing or incomplete status file.
			if (!(error instanceof SyntaxError) && (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		await new Promise((resolve) => setImmediate(resolve));
	}
}

describe("DefaultComputeExecutor", () => {
	it("runs the complete local runner lifecycle and collects checksummed outputs", async () => {
		const executor = new DefaultComputeExecutor();
		const capability = await executor.probeHost(host);
		expect(capability.scheduler).toBe("direct");
		const submitted = await executor.submit(spec, host);
		expect(submitted.remoteId).toBe(spec.jobId);
		for (let attempt = 0; attempt < 100; attempt += 1) {
			const status = await executor.status(
				{ jobId: spec.jobId, hostAlias: spec.hostAlias, spec, status: "running", createdAt: 0, updatedAt: 0 },
				host,
			);
			if (status.status === "succeeded") break;
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
		const output = await mkdtemp(join(tmpdir(), "drone-compute-output-"));
		const collected = await executor.collect(
			{ jobId: spec.jobId, hostAlias: spec.hostAlias, spec, status: "succeeded", createdAt: 0, updatedAt: 0 },
			host,
			{ targetDir: output },
		);
		expect(collected.manifest.entries.map((entry) => entry.path).sort()).toEqual([
			"counts.tsv",
			"multiqc_report.html",
		]);
	});

	it("supports cancellation before the fixture finishes", async () => {
		const { release, remoteRoot, restore } = await createCancelFixture();
		const executor = new DefaultComputeExecutor();
		try {
			await executor.submit({ ...spec, jobId: "cancel-job" }, host);
			const result = await executor.cancel(
				{
					jobId: "cancel-job",
					hostAlias: spec.hostAlias,
					spec: { ...spec, jobId: "cancel-job" },
					status: "running",
					createdAt: 0,
					updatedAt: 0,
				},
				host,
			);
			const cleanup = result.cleanup as { state: string; jobId: string; method: string };
			expect(cleanup.jobId).toBe("cancel-job");
			expect(["confirmed", "unknown", "failed", "unsupported"]).toContain(cleanup.state);
			expect(cleanup.method).toBe("direct");
			expect(result.status).not.toBe("succeeded");
			if (cleanup.state === "confirmed") expect(result.status).toBe("cancelled");
			else if (result.status === "cancelled") {
				const directory = join(remoteRoot, "runs/cancel-job");
				const status = JSON.parse(await readFile(join(directory, "status.json"), "utf8"));
				const request = JSON.parse(await readFile(join(directory, "cancel-requested.json"), "utf8"));
				expect(status.exitCode).toEqual(expect.any(Number));
				expect(request.jobId).toBe("cancel-job");
			} else expect(["running", "unknown"]).toContain(result.status);
			console.info("Local direct cancel result:", JSON.stringify(result));
		} finally {
			try {
				// Release the fixture even when this host cannot confirm process cleanup.
				await writeFile(release, "release");
				await waitForTerminal(remoteRoot, "cancel-job");
			} finally {
				await executor.dispose();
				restore();
			}
		}
	});
});
