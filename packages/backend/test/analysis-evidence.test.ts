import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { JsonStore } from "../src/json-store";
import { AnalysisEvidenceService, checkpointId, type FrozenFile } from "../src/services/analysis-evidence";
import { AnalysisOrchestrationService, emptyAnalysisLedger } from "../src/services/analysis-orchestration";
import { StorageRegistry } from "../src/storage/registry";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

async function setup() {
	const root = await mkdtemp(join(tmpdir(), "drone-evidence-"));
	const runs = new AnalysisOrchestrationService({
		store: new JsonStore({
			path: join(root, "runs.json"),
			storageId: "evidence-runs",
			defaultValue: emptyAnalysisLedger,
		}),
	});
	await runs.create({
		id: "run-1",
		question: "Freeze this result",
		assay: "assembly",
		mode: "exploratory",
		adapter: { id: "assembly", version: "1.0.0" },
	});
	await runs.recordDesign("run-1");
	const storage = new StorageRegistry();
	const evidence = new AnalysisEvidenceService({ root: join(root, "evidence"), analysis: runs, storage });
	const source = join(root, "source");
	await mkdir(source);
	const files = [
		["input.txt", "reads", "input"],
		["script.py", "print('ok')", "code"],
		["result.txt", "done", "output"],
	] as const;
	const frozen: FrozenFile[] = files.map(([path, content, kind], index) => ({
		kind,
		artifact: {
			artifactId: `artifact-${index}`,
			versionId: `version-${index}`,
			path,
			sha256: sha256(content),
			bytes: Buffer.byteLength(content),
			role: kind === "output" ? "output" : "input",
			parentVersionIds: [],
			producedByJobId: "job-1",
		},
	}));
	for (const [path, content] of files) await writeFile(join(source, path), content);
	return { root, runs, evidence, source, frozen };
}

describe("analysis evidence checkpoints", () => {
	it("freezes immutable bytes and forks an isolated branch without approval inheritance", async () => {
		const { root, runs, evidence, source, frozen } = await setup();
		try {
			const checkpoint = await evidence.freeze({
				analysisId: "run-1",
				sourceRoot: source,
				files: frozen,
				environmentFingerprint: "env-1",
			});
			const before = await evidence.capsule(checkpoint.id);
			await writeFile(join(source, "result.txt"), "changed");
			const after = await evidence.capsule(checkpoint.id);
			expect(after).toEqual(before);
			const fork = await evidence.fork(checkpoint.id, "branch-1");
			expect(fork.context).toMatchObject({
				id: "branch-1",
				stage: "intake",
				status: "active",
				branchOf: { analysisId: "run-1", checkpointId: checkpoint.id },
			});
			expect(await readFile(join(fork.workspace, "result.txt"), "utf8")).toBe("done");
			expect((await runs.get("branch-1"))?.readiness).toBeNull();
			expect(await evidence.branch("branch-1")).toMatchObject({
				checkpointId: checkpoint.id,
				status: "ready",
			});
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("keeps checkpoint identity stable when lineage is added", () => {
		const analysis = {
			id: "run-1",
			provenance: {
				adapter: { id: "assembly", version: "1.0.0" },
				lineage: { schemaVersion: 1, eventId: "event:root", runAttemptId: "run:one" },
			},
		} as never;
		const body = {
			schemaVersion: 1 as const,
			analysis,
			files: [],
			createdAt: "2026-10-14T00:00:00.000Z",
		};
		const withoutLineage = {
			...body,
			analysis: { ...analysis, provenance: { ...analysis.provenance, lineage: undefined } },
		};
		expect(checkpointId(body)).toBe(checkpointId(withoutLineage));
	});

	it("exports and replays a capsule with exact output and environment checks", async () => {
		const { root, evidence, source, frozen } = await setup();
		try {
			const checkpoint = await evidence.freeze({
				analysisId: "run-1",
				sourceRoot: source,
				files: frozen,
				environmentFingerprint: "env-1",
			});
			const exported = await evidence.exportCapsule(checkpoint.id);
			expect(await readFile(exported.path, "utf8")).toContain("drone-evidence-capsule");
			expect(exported.audience).toBe("private");
			const publicExport = await evidence.exportCapsule(checkpoint.id, "public");
			const publicCapsule = JSON.parse(await readFile(publicExport.path, "utf8")) as {
				publication?: { audience: string; omittedPaths: string[] };
				blobs: Record<string, string>;
			};
			expect(publicCapsule.publication).toMatchObject({ audience: "public" });
			expect(publicCapsule.publication?.omittedPaths).toHaveLength(3);
			expect(Object.keys(publicCapsule.blobs)).toHaveLength(0);
			await expect(evidence.importCapsule(publicExport.path)).resolves.toMatchObject({ id: checkpoint.id });
			const receipt = await evidence.replay(checkpoint.id, {
				run: async ({ outputDir }) => {
					await mkdir(outputDir, { recursive: true });
					await writeFile(join(outputDir, "result.txt"), "done");
					return { environmentFingerprint: "env-1" };
				},
			});
			expect(receipt).toMatchObject({
				checkpointId: checkpoint.id,
				status: "reproduced",
				environmentMatched: true,
				outputChecks: [{ path: "result.txt", matched: true }],
			});
			expect(await evidence.replayReceipts(checkpoint.id)).toHaveLength(1);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
	it("publishes only explicitly public artifact bytes and rejects a forged omission list", async () => {
		const { root, evidence, source, frozen } = await setup();
		try {
			const publicFrozen = frozen.map((file, index) =>
				index === 2 ? { ...file, artifact: { ...file.artifact, accessLevel: "public" as const } } : file,
			);
			const checkpoint = await evidence.freeze({
				analysisId: "run-1",
				sourceRoot: source,
				files: publicFrozen,
				environmentFingerprint: "env-1",
			});
			const exported = await evidence.exportCapsule(checkpoint.id, "public");
			const capsule = JSON.parse(await readFile(exported.path, "utf8")) as {
				publication: { omittedPaths: string[] };
				blobs: Record<string, string>;
			};
			expect(capsule.publication.omittedPaths).toEqual(["input.txt", "script.py"]);
			expect(Object.keys(capsule.blobs)).toHaveLength(1);
			const forged = { ...capsule, publication: { ...capsule.publication, omittedPaths: [] } };
			const forgedPath = join(root, "forged.json");
			await writeFile(
				forgedPath,
				JSON.stringify({
					format: "drone-evidence-capsule",
					version: 1,
					checkpoint,
					blobs: capsule.blobs,
					publication: forged.publication,
				}),
			);
			await expect(evidence.importCapsule(forgedPath)).rejects.toThrow("omission list mismatch");
			const omittedBlob = join(root, "omitted-blob.json");
			await writeFile(
				omittedBlob,
				JSON.stringify({
					...capsule,
					blobs: { ...capsule.blobs, [frozen[0]!.artifact.sha256]: Buffer.from("reads").toString("base64") },
				}),
			);
			await expect(evidence.importCapsule(omittedBlob)).rejects.toThrow(/Unexpected capsule blobs/);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("refuses credential and private-state paths before freezing evidence", async () => {
		const { root, evidence, source } = await setup();
		try {
			await writeFile(join(source, ".env"), "API_KEY=private-fixture");
			const credential: FrozenFile = {
				kind: "input",
				artifact: {
					artifactId: "credential",
					versionId: "credential-v1",
					path: ".env",
					sha256: sha256("API_KEY=private-fixture"),
					bytes: Buffer.byteLength("API_KEY=private-fixture"),
					role: "input",
					accessLevel: "private",
					parentVersionIds: [],
				},
			};
			await expect(
				evidence.freeze({
					analysisId: "run-1",
					sourceRoot: source,
					files: [credential],
				}),
			).rejects.toThrow(/credentials or private state/);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("rejects source changes and failed environment or output replay", async () => {
		const { root, evidence, source, frozen } = await setup();
		try {
			await writeFile(join(source, "result.txt"), "tampered");
			await expect(
				evidence.freeze({
					analysisId: "run-1",
					sourceRoot: source,
					files: frozen,
					environmentFingerprint: "env-1",
				}),
			).rejects.toThrow("Artifact changed");
			await writeFile(join(source, "result.txt"), "done");
			const checkpoint = await evidence.freeze({
				analysisId: "run-1",
				sourceRoot: source,
				files: frozen,
				environmentFingerprint: "env-1",
			});
			const receipt = await evidence.replay(checkpoint.id, {
				run: async () => ({ environmentFingerprint: "env-2" }),
			});
			expect(receipt).toMatchObject({
				status: "failed",
				environmentMatched: false,
				outputChecks: [{ path: "result.txt", matched: false }],
			});
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
