import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { StorageRegistry } from "../storage/registry";
import { ComputeDataDesignService } from "./compute-data-design";

const file = { path: "inputs/counts.tsv", bytes: 12, sha256: "a".repeat(64) };

describe("compute data-design service", () => {
	it("persists immutable dataset versions and public fetch records", async () => {
		const root = await mkdtemp(join(tmpdir(), "drone-compute-data-design-"));
		const storage = new StorageRegistry();
		const service = new ComputeDataDesignService({ storage, agentDir: root });
		const dataset = await service.registerDatasetVersion({ datasetId: "study", files: [file] });
		const fetchRecord = {
			id: "fetch-1",
			uri: "https://data.example.org/study.tsv",
			source: "example",
			termsAccepted: true,
			fetchedAt: "2026-10-03T00:00:00Z",
			bytes: 12,
			sha256: "a".repeat(64),
		} as const;
		await service.registerPublicDataFetchRecord(fetchRecord);

		expect(await service.getDatasetVersion("study", dataset.versionId)).toEqual(dataset);
		expect(await service.getPublicDataFetchRecord(fetchRecord.id)).toEqual(fetchRecord);
		expect((await service.listDatasetVersions("study")).map((item) => item.versionId)).toEqual([
			dataset.versionId,
		]);
		expect((await service.listPublicDataFetchRecords()).map((item) => item.id)).toEqual([fetchRecord.id]);
		expect(storage.get("agent-compute-data-design")).toMatchObject({ owner: "compute/data-design" });

		const reopened = new ComputeDataDesignService({ storage: new StorageRegistry(), agentDir: root });
		expect(await reopened.getDatasetVersion("study", dataset.versionId)).toEqual(dataset);
		expect(await reopened.getPublicDataFetchRecord(fetchRecord.id)).toEqual(fetchRecord);
	});

	it("rejects conflicting re-registration of an immutable record", async () => {
		const root = await mkdtemp(join(tmpdir(), "drone-compute-data-design-"));
		const service = new ComputeDataDesignService({ agentDir: root });
		const dataset = await service.registerDatasetVersion({ datasetId: "study", files: [file] });
		await expect(
			service.registerDatasetVersion({
				datasetId: dataset.datasetId,
				files: [file],
				createdAt: "2026-10-04T00:00:00Z",
			}),
		).rejects.toThrow("already exists with different contents");
		await expect(
			service.registerPublicDataFetchRecord({
				id: "fetch-1",
				uri: "https://data.example.org/study.tsv",
				source: "example",
				termsAccepted: true,
				fetchedAt: "2026-10-03T00:00:00Z",
				bytes: 12,
				sha256: "a".repeat(64),
			}),
		).resolves.toMatchObject({ id: "fetch-1" });
		await expect(
			service.registerPublicDataFetchRecord({
				id: "fetch-1",
				uri: "https://data.example.org/other.tsv",
				source: "example",
				termsAccepted: true,
				fetchedAt: "2026-10-03T00:00:00Z",
				bytes: 12,
				sha256: "a".repeat(64),
			}),
		).rejects.toThrow("already exists with different contents");
	});
});
