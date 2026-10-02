import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	createExperienceStore,
	EXPERIENCE_LIMITS,
	recordTerminalJobExperience,
	searchExperiences,
} from "../src/experience-store";

const binding = { vaultId: "0123456789abcdef01234567" };
const roots: string[] = [];
const input = (overrides: Record<string, unknown> = {}): any => ({
	jobId: "job-1",
	featureKey: "nextflow-align",
	summary: "Align reads with the configured workflow and inspect the bounded output manifest.",
	observation: {
		id: "obs-1",
		outcome: "success" as const,
		exitCode: 0,
	},
	provenance: {
		runId: "run-1",
		receiptId: "receipt-1",
		manifestSha256: "a".repeat(64),
	},
	...overrides,
});

async function root() {
	const value = await mkdtemp(join(tmpdir(), "drone-experience-store-"));
	roots.push(value);
	return value;
}

afterEach(async () => {
	await Promise.all(roots.splice(0).map((value) => rm(value, { recursive: true, force: true })));
});

describe("experience store", () => {
	it("writes atomically in the vault/project/host scope and reopens with a revision", async () => {
		const directory = await root();
		const store = createExperienceStore({ binding, project: "project-a", hostId: "host-a", directory });
		const result = await store.record(input(), 0);
		expect(result.classification).toBe("new");
		expect(result.revision).toBe(1);
		expect(result.record).toMatchObject({
			vaultId: binding.vaultId,
			project: "project-a",
			hostId: "host-a",
			status: "observed",
			navigationOnly: true,
			evidenceEligible: false,
			instructionEligible: false,
		});
		const reopened = createExperienceStore({ binding, project: "project-a", hostId: "host-a", directory });
		await expect(reopened.read()).resolves.toMatchObject({
			revision: 1,
			records: [expect.objectContaining({ id: result.record.id })],
		});
		const file = await stat(store.path);
		expect(file.isFile()).toBe(true);
		expect(JSON.parse(await readFile(store.path, "utf8")).records[0].command).toBeUndefined();
		await expect(
			store.record(input({ observation: { id: "obs-2", outcome: "success" } }), 0),
		).rejects.toThrow("revision changed");
		await expect(
			store.record(input({ observation: { id: "obs-1", outcome: "success" } }), 1),
		).resolves.toMatchObject({
			classification: "duplicate",
		});
		await expect(
			store.record(input({ jobId: "job-2", observation: { id: "obs-2", outcome: "success" } }), 1),
		).resolves.toMatchObject({
			classification: "updated",
			record: { status: "verified", observationCount: 2 },
		});
		await expect(store.search("nextflow", { includeObserved: true })).resolves.toMatchObject({
			records: [expect.objectContaining({ record: expect.objectContaining({ status: "verified" }) })],
		});
	});

	it("isolates project and host records and requires bound provenance", async () => {
		const directory = await root();
		const a = createExperienceStore({ binding, project: "project-a", hostId: "host-a", directory });
		await expect(a.record(input({ provenance: {} }), 0)).rejects.toThrow("provenance");
		await a.record(input(), 0);
		const otherProject = createExperienceStore({
			binding,
			project: "project-b",
			hostId: "host-a",
			directory,
		});
		const otherHost = createExperienceStore({ binding, project: "project-a", hostId: "host-b", directory });
		expect((await otherProject.read()).records).toEqual([]);
		expect((await otherHost.read()).records).toEqual([]);
		expect((await a.read()).records).toHaveLength(1);
	});

	it("never persists raw command/output/credentials and keeps only bounded navigation data", async () => {
		const directory = await root();
		const store = createExperienceStore({ binding, project: "project-a", hostId: "host-a", directory });
		await store.record(
			input({
				summary:
					"Authorization: Bearer very-secret; api_key=quoted-secret; https://alice:pw@example.org/run?token=x",
				command: "echo private-command-password",
				output: "private output",
				credentials: "private credential",
			}),
			0,
		);
		const serialized = await readFile(store.path, "utf8");
		expect(serialized).not.toContain("private-command-password");
		expect(serialized).not.toContain("private output");
		expect(serialized).not.toContain("private credential");
		expect(serialized).not.toContain("very-secret");
		expect(serialized).not.toContain("quoted-secret");
		expect(serialized).not.toContain("alice:pw");
		const found = await store.search("authorization", { includeObserved: true, limit: 1 });
		expect(found.navigationOnly).toBe(true);
		expect(found.evidenceEligible).toBe(false);
		expect(found.instructionEligible).toBe(false);
	});

	it("adapts terminal host observations through the stable port without persisting runner payloads", async () => {
		const directory = await root();
		const store = createExperienceStore({ binding, project: "project-a", hostId: "host-a", directory });
		const result = await recordTerminalJobExperience(
			store,
			{
				jobId: "nextflow-1",
				featureKey: "align-step",
				summary: "The align step completed and produced a bounded manifest.",
				outcome: "success",
				exitCode: 0,
				observationId: "host-observation-1",
				provenance: { runId: "run-1", receiptId: "receipt-1", manifestSha256: "b".repeat(64) },
			},
			0,
		);
		expect(result.record).toMatchObject({
			featureKey: "align-step",
			jobId: "nextflow-1",
			status: "observed",
		});
		const persisted = await readFile(store.path, "utf8");
		expect(persisted).not.toContain("command");
		expect(persisted).not.toContain("output");
	});

	it("marks a repeated feature verified or accepts an explicit successful repair", async () => {
		const directory = await root();
		const store = createExperienceStore({ binding, project: "project-a", hostId: "host-a", directory });
		const first = await store.record(input({ featureKey: "failed-feature" }), 0);
		expect(first.record.status).toBe("observed");
		const repaired = await store.record(
			input({
				featureKey: "repaired-feature",
				observation: { id: "repair-1", outcome: "success", repairSucceeded: true },
			}),
			1,
		);
		expect(repaired.record.status).toBe("verified");
		const repeated = await store.record(
			input({
				jobId: "job-2",
				featureKey: "failed-feature",
				observation: { id: "obs-2", outcome: "failure", exitCode: 1 },
			}),
			2,
		);
		expect(repeated.record.status).toBe("verified");
	});

	it("persists bounded terminal metadata and keeps model summaries navigation-only", async () => {
		const directory = await root();
		const store = createExperienceStore({ binding, project: "project-a", hostId: "host-a", directory });
		const result = await store.record(
			input({
				failureSignature: "align-exit-1",
				failedStep: "align",
				exitCode: 17,
				repair: { succeeded: true, summary: "Retry succeeded", observationId: "repair-obs" },
				workflowSpecDiff: [{ path: "params.threads", before: 4, after: 8 }],
				resourceUse: { cpuSeconds: 12.5, peakMemoryMb: 512, secretToken: 999 },
				qcMetrics: [
					{
						name: "mappingRate",
						unit: "%",
						distribution: { min: 90, mean: 96, median: 97, p95: 99, max: 100 },
					},
				],
				modelSummary: "Model suggests reviewing the bounded manifest.",
				command: "private-command",
				output: "private-output",
			}),
			0,
		);
		expect(result.record).toMatchObject({
			status: "verified",
			failureSignature: "align-exit-1",
			exitCode: 17,
			failedStep: "align",
			repair: { succeeded: true },
			workflowSpecDiff: [{ path: "params.threads", before: 4, after: 8 }],
			resourceUse: { cpuSeconds: 12.5, peakMemoryMb: 512 },
			qcMetrics: [
				expect.objectContaining({ name: "mappingRate", distribution: expect.objectContaining({ p95: 99 }) }),
			],
			modelSummary: "Model suggests reviewing the bounded manifest.",
			modelGenerated: true,
			navigationOnly: true,
			evidenceEligible: false,
			instructionEligible: false,
		});
		const serialized = await readFile(store.path, "utf8");
		expect(serialized).not.toContain("secretToken");
		expect(serialized).not.toContain("private-command");
		expect(serialized).not.toContain("private-output");
	});

	it("does not verify a feature from two observations belonging to one job", async () => {
		const directory = await root();
		const store = createExperienceStore({ binding, project: "project-a", hostId: "host-a", directory });
		await store.record(
			input({ featureKey: "same-job", observation: { id: "same-1", outcome: "failure" } }),
			0,
		);
		const second = await store.record(
			input({ featureKey: "same-job", observation: { id: "same-2", outcome: "failure" } }),
			1,
		);
		expect(second.record.status).toBe("observed");
		expect(second.record.jobCount).toBe(1);
	});

	it("returns stable bounded search results and convenience search uses the same scope", async () => {
		const directory = await root();
		const store = createExperienceStore({ binding, project: "project-a", hostId: "host-a", directory });
		for (let index = 0; index < EXPERIENCE_LIMITS.maxRecords + 4; index++) {
			await store.record(
				input({
					featureKey: `feature-${index}`,
					observation: { id: `obs-${index}`, outcome: "success" },
					summary: `Workflow result ${index} for alignment`,
				}),
				index,
			);
		}
		const found = await store.search("alignment", { includeObserved: true, limit: 999 });
		expect(found.records.length).toBeLessThanOrEqual(EXPERIENCE_LIMITS.maxSearchResults);
		expect((await store.read()).records.length).toBe(EXPERIENCE_LIMITS.maxRecords);
		const convenience = await searchExperiences({
			binding,
			project: "project-a",
			hostId: "host-a",
			directory,
			query: "alignment",
			includeObserved: true,
		});
		expect(convenience.records.map((item) => item.record.id)).toEqual(
			found.records.map((item) => item.record.id),
		);
	});
});
