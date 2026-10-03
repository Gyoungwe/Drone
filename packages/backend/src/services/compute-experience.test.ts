import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JobRecord } from "@drone/compute";
import { createExperienceStore } from "@drone/knowledge";
import { afterEach, describe, expect, it } from "vitest";
import type { ComputeEvent } from "./compute";
import { createComputeExperienceRecorder } from "./compute-experience";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function job(status: JobRecord["status"] = "succeeded"): JobRecord {
	return {
		jobId: "compute-1",
		hostAlias: "local",
		spec: {
			jobId: "compute-1",
			hostAlias: "local",
			workflow: { name: "nf-core/rnaseq", version: "3.18.0" },
		},
		status,
		createdAt: Date.parse("2026-10-03T00:00:00.000Z"),
		updatedAt: Date.parse("2026-10-03T00:01:00.000Z"),
		remoteId: "remote-1",
	};
}

describe("compute experience bridge", () => {
	it("adapts terminal observations through the knowledge store port", async () => {
		const root = await mkdtemp(join(tmpdir(), "drone-compute-experience-"));
		roots.push(root);
		const store = createExperienceStore({
			binding: { vaultId: "0123456789abcdef01234567" },
			project: "project-a",
			hostId: "local",
			directory: root,
		});
		const recorder = createComputeExperienceRecorder({ store, topicId: "topic-a" });
		const event: ComputeEvent = {
			id: "observation-1",
			jobId: "compute-1",
			type: "status",
			status: "succeeded",
			at: Date.parse("2026-10-03T00:01:00.000Z"),
		};

		await recorder.record(event, job());

		const document = await store.read();
		expect(document.records).toHaveLength(1);
		expect(document.records[0]).toMatchObject({
			jobId: "compute-1",
			featureKey: "nf-core:rnaseq",
			workflow: "nf-core/rnaseq",
			workflowRevision: "3.18.0",
			topicId: "topic-a",
			status: "observed",
			outcome: "success",
		});
	});

	it("records verified artifact references from collection events", async () => {
		const root = await mkdtemp(join(tmpdir(), "drone-compute-experience-"));
		roots.push(root);
		const store = createExperienceStore({
			binding: { vaultId: "0123456789abcdef01234567" },
			project: "project-a",
			hostId: "local",
			directory: root,
		});
		const recorder = createComputeExperienceRecorder({ store });
		await recorder.record(
			{
				id: "observation-2",
				jobId: "compute-1",
				type: "collected",
				status: "succeeded",
				at: Date.parse("2026-10-03T00:01:00.000Z"),
				artifacts: [{ path: "results/report.json", bytes: 12, sha256: "a".repeat(64) }],
			},
			job(),
		);

		const [record] = (await store.read()).records;
		expect(record?.artifactRefs).toEqual([
			{ path: "results/report.json", bytes: 12, sha256: "a".repeat(64) },
		]);
		expect(record?.provenance.observationId).toBe("observation-2");
	});
});
