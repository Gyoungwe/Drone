import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stableJson } from "@drone/compute";
import { describe, expect, it, vi } from "vitest";
import { JsonStore } from "../src/json-store";
import { AnalysisEvidenceService, checkpointId, type FrozenFile } from "../src/services/analysis-evidence";
import {
	type AnalysisEvidencePluginHost,
	EVIDENCE_VERIFY_REPLAY_TOOL,
} from "../src/services/analysis-evidence-host";
import { AnalysisOrchestrationService, emptyAnalysisLedger } from "../src/services/analysis-orchestration";
import { StorageRegistry } from "../src/storage/registry";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

async function setup(evidenceHost?: AnalysisEvidencePluginHost) {
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
	const evidence = new AnalysisEvidenceService({
		root: join(root, "evidence"),
		analysis: runs,
		storage,
		...(evidenceHost ? { evidenceHost } : {}),
	});
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
			const privateBytes = `${stableJson({
				format: "drone-evidence-capsule",
				version: 1,
				checkpoint,
				blobs: {
					[sha256("reads")]: Buffer.from("reads").toString("base64"),
					[sha256("print('ok')")]: Buffer.from("print('ok')").toString("base64"),
					[sha256("done")]: Buffer.from("done").toString("base64"),
				},
			})}\n`;
			expect(await readFile(exported.path)).toEqual(Buffer.from(privateBytes));
			expect(exported.sha256).toBe(sha256(privateBytes));
			expect(exported.audience).toBe("private");
			const publicExport = await evidence.exportCapsule(checkpoint.id, "public");
			const publicCapsule = JSON.parse(await readFile(publicExport.path, "utf8")) as {
				format: string;
				audience: string;
				files: { sha256: string; included: boolean }[];
				blobs: Record<string, string>;
			};
			expect(publicCapsule).toMatchObject({ format: "drone-evidence-attestation", audience: "public" });
			expect(publicCapsule.files).toHaveLength(3);
			expect(publicCapsule.files.every((file) => !file.included)).toBe(true);
			expect(Object.keys(publicCapsule.blobs)).toHaveLength(0);
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
			expect(receipt.lineage?.runAttemptId).toMatch(/^run:/);
			expect(receipt.lineage?.causationId).toBeUndefined();
			expect(await evidence.replayReceipts(checkpoint.id)).toHaveLength(1);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("delegates replay verification to the declared evidence plugin and persists its receipt", async () => {
		const verifier = vi.fn(() => ({
			details: {
				status: "reproduced",
				detail: "Plugin verified replay metadata",
				environmentMatched: true,
				outputChecks: [{ path: "result.txt", matched: true }],
			},
		}));
		const evidenceHost: AnalysisEvidencePluginHost = {
			manifest: { tools: [EVIDENCE_VERIFY_REPLAY_TOOL] },
			tools: { [EVIDENCE_VERIFY_REPLAY_TOOL]: { execute: verifier } },
		};
		const { root, evidence, source, frozen } = await setup(evidenceHost);
		try {
			const checkpoint = await evidence.freeze({
				analysisId: "run-1",
				sourceRoot: source,
				files: frozen,
				environmentFingerprint: "env-1",
			});
			const receipt = await evidence.replay(checkpoint.id, {
				run: async ({ outputDir }) => {
					await mkdir(outputDir, { recursive: true });
					await writeFile(join(outputDir, "result.txt"), "done");
					return { environmentFingerprint: "env-1" };
				},
			});
			expect(receipt).toMatchObject({
				status: "reproduced",
				detail: "Plugin verified replay metadata",
				outputChecks: [{ path: "result.txt", matched: true }],
			});
			expect(verifier).toHaveBeenCalledWith(
				expect.objectContaining({
					checkpoint,
					environmentFingerprint: "env-1",
					outputs: [{ path: "result.txt", bytes: 4, sha256: sha256("done") }],
				}),
			);
			expect(await evidence.replayReceipts(checkpoint.id)).toEqual([receipt]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("fails closed when a declared replay verifier errors after execution", async () => {
		const evidenceHost: AnalysisEvidencePluginHost = {
			manifest: { tools: [EVIDENCE_VERIFY_REPLAY_TOOL] },
			tools: {
				[EVIDENCE_VERIFY_REPLAY_TOOL]: {
					execute: vi.fn(() => {
						throw new Error("verifier unavailable");
					}),
				},
			},
		};
		const { root, evidence, source, frozen } = await setup(evidenceHost);
		try {
			const checkpoint = await evidence.freeze({
				analysisId: "run-1",
				sourceRoot: source,
				files: frozen,
				environmentFingerprint: "env-1",
			});
			const receipt = await evidence.replay(checkpoint.id, {
				run: async ({ outputDir }) => {
					await mkdir(outputDir, { recursive: true });
					await writeFile(join(outputDir, "result.txt"), "done");
					return { environmentFingerprint: "env-1" };
				},
			});
			expect(receipt.status).toBe("failed");
			expect(receipt.detail).toContain("verifier unavailable");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
	it("imports legacy public capsules and rejects a forged omission list or omitted private blob", async () => {
		const { root, runs, evidence, source, frozen } = await setup();
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
			const capsule = {
				format: "drone-evidence-capsule",
				version: 1,
				checkpoint,
				publication: { audience: "public", omittedPaths: ["input.txt", "script.py"] },
				blobs: { [sha256("done")]: Buffer.from("done").toString("base64") },
			};
			const legacyPath = join(root, "legacy-public.json");
			await writeFile(legacyPath, JSON.stringify(capsule));
			const recipient = new AnalysisEvidenceService({
				root: join(root, "imported-evidence"),
				analysis: runs,
				storage: new StorageRegistry(),
			});
			await expect(recipient.importCapsule(legacyPath)).resolves.toEqual(checkpoint);
			expect(await readFile(join(root, "imported-evidence", "blobs", sha256("done")), "utf8")).toBe("done");
			const forged = { ...capsule, publication: { ...capsule.publication, omittedPaths: [] } };
			const forgedPath = join(root, "forged.json");
			await writeFile(forgedPath, JSON.stringify(forged));
			await expect(evidence.importCapsule(forgedPath)).rejects.toThrow("omission list mismatch");
			const omittedBlob = join(root, "omitted-blob.json");
			await writeFile(
				omittedBlob,
				JSON.stringify({
					...capsule,
					blobs: { ...capsule.blobs, [sha256("reads")]: Buffer.from("reads").toString("base64") },
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
