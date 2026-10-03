import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HostProfile, JobSpec } from "@drone/compute";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DefaultComputeExecutor } from "./default-executor";

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
		const executor = new DefaultComputeExecutor();
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
		expect(result.status).toBe("cancelled");
	});
});
