import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ArtifactManifest, HostProfile, JobSpec } from "@drone/compute";
import { describe, expect, it } from "vitest";
import { createDroneRuntime } from "../runtime";
import { StorageRegistry } from "../storage/registry";
import { type ComputeExecutor, ComputeService, validateArtifactManifest } from "./compute";

function spec(idempotencyKey = "once", jobId = "job-1"): JobSpec {
	return {
		jobId,
		idempotencyKey,
		hostAlias: "local",
		workflow: { version: 1, modules: [], steps: [] },
	};
}

function host(): HostProfile {
	return { alias: "local", host: "127.0.0.1", username: "runner" };
}

describe("ComputeService", () => {
	it("persists host metadata without credential fields", async () => {
		const root = await mkdtemp(join(tmpdir(), "drone-compute-"));
		const storage = new StorageRegistry();
		const service = new ComputeService({ storage, agentDir: root });
		await service.upsertHost({ ...host(), password: "must-not-persist" } as HostProfile & {
			password: string;
		});
		const reopened = new ComputeService({ storage: new StorageRegistry(), agentDir: root });
		expect(await reopened.listHosts()).toEqual([host()]);
		await service.dispose();
		await reopened.dispose();
	});

	it("does not replay a submission after an unknown side effect", async () => {
		const root = await mkdtemp(join(tmpdir(), "drone-compute-"));
		let submissions = 0;
		let observed = false;
		let remoteStatus: "running" | "succeeded" | "unknown" = "unknown";
		const executor: ComputeExecutor = {
			submit: async () => {
				submissions += 1;
				throw new Error("connection lost after submit");
			},
			status: async () => ({ status: observed ? remoteStatus : "unknown" }),
		};
		const service = new ComputeService({
			storage: new StorageRegistry(),
			agentDir: root,
			executor,
			runtime: createDroneRuntime(),
		});
		await service.upsertHost(host());
		const first = await service.submit(spec());
		expect(first.status).toBe("unknown");
		observed = true;
		const second = await service.submit({ ...spec(), jobId: first.jobId });
		expect(second.jobId).toBe(first.jobId);
		expect(submissions).toBe(1);
		remoteStatus = "succeeded";
		expect((await service.status(first.jobId)).status).toBe("succeeded");
		remoteStatus = "running";
		expect((await service.status(first.jobId)).status).toBe("succeeded");
		const events = await service.listEvents(first.jobId);
		expect(events.some((event) => event.type === "error")).toBe(true);
		const journal = await readFile(join(root, "compute", "events", `${first.jobId}.jsonl`), "utf8");
		expect(
			journal
				.trim()
				.split("\n")
				.every((line) => line.startsWith("{")),
		).toBe(true);
		await service.dispose();
	});

	it("verifies collected artifact checksums and rejects traversal", async () => {
		const root = await mkdtemp(join(tmpdir(), "drone-compute-"));
		const output = join(root, "output");
		const payload = Buffer.from("report\n");
		const checksum = "0e2c8a6c1f0f6e9f6f86f2e4a1f8c933c5d2b48f6f652e7c2be67c1f6d2f6d36";
		const manifest: ArtifactManifest = {
			version: 1,
			entries: [{ path: "report.txt", size: payload.byteLength, sha256: checksum }],
			totalBytes: payload.byteLength,
		};
		const executor: ComputeExecutor = {
			submit: async () => ({ status: "succeeded" }),
			status: async () => ({ status: "succeeded" }),
			collect: async (_job, _host, options) => {
				await writeFile(join(options?.targetDir ?? output, "report.txt"), payload);
				return { manifest };
			},
		};
		const service = new ComputeService({ storage: new StorageRegistry(), agentDir: root, executor });
		await service.upsertHost(host());
		const job = await service.submit(spec("collect"));
		// The checksum above is deliberately invalid; the host must reject it before exposing the output.
		await expect(service.collect(job.jobId, { targetDir: output })).rejects.toThrow("checksum mismatch");
		expect(() =>
			validateArtifactManifest(
				{ version: 1, entries: [{ path: "../escape", size: 0, sha256: checksum }], totalBytes: 0 },
				output,
			),
		).toThrow("unsafe path");
		await service.dispose();
	});
});
