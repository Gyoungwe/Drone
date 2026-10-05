import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import { describe, expect, it } from "vitest";
import {
	type ArtifactRecord,
	FileInquiryStorage,
	type FindingRecord,
	InquiryService,
	MemoryInquiryStorage,
	planWorkspacePromotion,
	registerInquiryStorage,
	reproducibilityStatus,
	SqliteInquiryStorage,
	validateArtifactLineage,
	validateArtifactRecord,
	type WorkspaceRun,
	workspaceLayout,
} from "../src";

const digest = "a".repeat(64);
const artifact = (overrides: Partial<ArtifactRecord> = {}): ArtifactRecord => ({
	id: "artifact-1",
	schemaVersion: 1,
	projectId: "project-1",
	location: "local",
	path: "runs/task-1/run-1/output.tsv",
	bytes: 10,
	sha256: digest,
	source: { kind: "run", id: "run-1" },
	purpose: "deliverable",
	status: "valid",
	parentIds: [],
	runId: "run-1",
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z",
	...overrides,
});

describe("inquiry ledger records", () => {
	it("classifies the three reproducibility states without side effects", () => {
		expect(reproducibilityStatus("code-1", { workflow: "rnaseq" })).toBe("reproducible");
		expect(reproducibilityStatus("code-1", undefined)).toBe("partial");
		expect(reproducibilityStatus(undefined, { workflow: "rnaseq" })).toBe("partial");
		expect(reproducibilityStatus(undefined, undefined)).toBe("not-reproducible");
		expect(reproducibilityStatus("", {})).toBe("not-reproducible");
		expect(reproducibilityStatus("code-1", {})).toBe("partial");
	});

	it("returns bounded parent provenance and truncates deep lineage", async () => {
		const storage = new MemoryInquiryStorage("project-1");
		const service = new InquiryService(storage);
		for (let index = 0; index <= 22; index += 1) {
			await service.recordArtifact(
				artifact({
					id: `artifact-${index}`,
					parentIds: index === 0 ? [] : [`artifact-${index - 1}`],
					path: `runs/task-1/run-1/output-${index}.tsv`,
				}),
			);
		}
		const provenance = await service.artifactProvenance("artifact-22");
		expect(provenance?.parentChain).toHaveLength(20);
		expect(provenance?.parentChain[0]?.id).toBe("artifact-21");
		expect(provenance?.parentChain.at(-1)?.id).toBe("artifact-2");
		expect(provenance?.parentChainTruncated).toBe(true);
	});

	it("reruns reproducible artifacts and supersedes a changed result", async () => {
		const storage = new MemoryInquiryStorage("project-1");
		const service = new InquiryService(storage);
		await service.recordArtifact(
			artifact({ id: "source", runProvenance: { workflow: "rnaseq" }, sessionId: "s1", turn: 2 }),
		);
		await service.recordAttempt({
			id: "attempt-1",
			schemaVersion: 1,
			projectId: "project-1",
			hypothesisIds: [],
			codeFingerprint: "code-1",
			parameters: { hostId: "local" },
			artifactIds: ["source"],
			outcome: "succeeded",
			enteredReport: false,
			startedAt: "2026-01-01T00:00:00.000Z",
		});
		service.setRerunHandler(async (provenance) => ({
			...provenance.artifact,
			id: "rerun-1",
			sha256: "b".repeat(64),
			parentIds: [provenance.artifact.id],
			createdAt: "2026-01-02T00:00:00.000Z",
			updatedAt: "2026-01-02T00:00:00.000Z",
		}));
		const result = await service.rerunArtifact("source");
		expect(result).toMatchObject({ status: "superseded", artifactId: "rerun-1" });
		expect((await storage.artifacts.get("source"))?.status).toBe("superseded");
		expect((await storage.artifacts.get("rerun-1"))?.sha256).toBe("b".repeat(64));
	});

	it("marks a matching rerun as reproduced without superseding the original", async () => {
		const storage = new MemoryInquiryStorage("project-1");
		const service = new InquiryService(storage);
		await service.recordArtifact(artifact({ id: "same", runProvenance: { workflow: "rnaseq" } }));
		await service.recordAttempt({
			id: "attempt-same",
			schemaVersion: 1,
			projectId: "project-1",
			hypothesisIds: [],
			codeFingerprint: "code-1",
			parameters: {},
			artifactIds: ["same"],
			outcome: "succeeded",
			enteredReport: false,
			startedAt: "2026-01-01T00:00:00.000Z",
		});
		service.setRerunHandler(async (provenance) => ({ ...provenance.artifact, id: "same-rerun" }));
		expect(await service.rerunArtifact("same")).toMatchObject({
			status: "reproduced",
			artifactId: "same-rerun",
		});
		expect((await storage.artifacts.get("same"))?.status).toBe("valid");
	});
	it("gets source session and turn from an associated attempt when absent on the artifact", async () => {
		const service = new InquiryService(new MemoryInquiryStorage("project-1"));
		await service.recordArtifact(artifact());
		await service.recordAttempt({
			id: "attempt-source",
			schemaVersion: 1,
			projectId: "project-1",
			hypothesisIds: [],
			parameters: {},
			artifactIds: ["artifact-1"],
			sessionId: "source-session",
			turn: 3,
			outcome: "succeeded",
			enteredReport: false,
			startedAt: "2026-01-01T00:00:00.000Z",
		});
		expect(await service.artifactProvenance("artifact-1")).toMatchObject({
			sourceSessionId: "source-session",
			sourceTurn: 3,
		});
	});
	it("rejects traversal, invalid checksums and incomplete lineage", () => {
		expect(validateArtifactRecord(artifact({ path: "../secret", sha256: "bad" }))).toEqual([
			"path must be a safe project-relative path",
			"sha256 must be a 64-character hexadecimal digest",
		]);
		expect(validateArtifactLineage(artifact({ parentIds: ["missing"] }), [])).toContain(
			"missing parent artifact: missing",
		);
	});

	it("enforces artifact references and produces a read-only cleanup dry-run", async () => {
		const storage = new MemoryInquiryStorage("project-1");
		const service = new InquiryService(storage);
		await service.recordArtifact(artifact());
		const finding: FindingRecord = {
			id: "finding-1",
			schemaVersion: 1,
			projectId: "project-1",
			statement: "The output was generated",
			values: [],
			conditions: [],
			artifactIds: ["artifact-1"],
			label: "confirmatory",
			robustness: { attemptCount: 1, consistentCount: 1, grade: "robust" },
			hypothesisIds: [],
			reviewStatus: "unreviewed",
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
		};
		await service.recordFinding(finding);
		await service.recordArtifact(
			artifact({
				id: "draft-1",
				path: "runs/task-1/run-1/tmp.txt",
				purpose: "draft",
				updatedAt: "2025-01-01T00:00:00.000Z",
			}),
		);
		const dryRun = await service.cleanupDryRun({ staleBefore: "2026-01-01T00:00:00.000Z" });
		expect(dryRun.destructive).toBe(false);
		expect(dryRun.candidates.map((candidate) => candidate.artifact.id)).toEqual(["draft-1"]);
	});

	it("persists a stable, atomically replaced document", async () => {
		const root = await mkdtemp(join(tmpdir(), "drone-inquiry-"));
		try {
			const path = join(root, "ledger.json");
			const storage = new FileInquiryStorage("project-1", path);
			await storage.artifacts.put(artifact({ id: "z" }));
			await storage.artifacts.put(artifact({ id: "a" }));
			const reopened = new FileInquiryStorage("project-1", path);
			expect((await reopened.snapshot()).artifacts.map((item) => item.id)).toEqual(["a", "z"]);
			expect(await readFile(path, "utf8")).toContain('"schemaVersion": 1');
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("persists all four ledgers in a SQLite database and reopens safely", async () => {
		const root = await mkdtemp(join(tmpdir(), "drone-inquiry-sqlite-"));
		try {
			const path = join(root, "ledger.sqlite");
			const storage = new SqliteInquiryStorage("project-1", path);
			await Promise.all([
				storage.artifacts.put(artifact({ id: "z" })),
				storage.artifacts.put(artifact({ id: "a" })),
			]);
			expect((await storage.snapshot()).artifacts.map((item) => item.id)).toEqual(["a", "z"]);
			await storage.close();
			const reopened = new SqliteInquiryStorage("project-1", path);
			expect((await reopened.artifacts.list()).map((item) => item.id)).toEqual(["a", "z"]);
			await expect(reopened.artifacts.put(artifact({ id: "bad", sha256: "invalid" }))).rejects.toThrow(
				"sha256",
			);
			await reopened.close();
			expect(() => new SqliteInquiryStorage("another-project", path)).toThrow("another project");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

describe("workspace promotion", () => {
	it("plans move-only promotion and deterministic index paths", () => {
		const layout = workspaceLayout("/tmp/project");
		const run: WorkspaceRun = {
			id: "run-1",
			taskId: "task-1",
			root: "/tmp/project/runs/task-1/run-1",
			state: "frozen",
			createdAt: "2026-01-01T00:00:00.000Z",
		};
		const plan = planWorkspacePromotion({ layout, run, artifacts: [artifact()] });
		expect(plan.moves[0]?.from).toBe(resolvePath("/tmp/project", "runs/task-1/run-1/output.tsv"));
		expect(plan.moves[0]?.to).toBe(resolvePath("/tmp/project", "results/task-1/run-1/output.tsv"));
		expect(plan.indexEntries[0]?.resultPath).toBe("results/task-1/run-1/output.tsv");
	});
});

it("registers both inquiry storage paths through a host-shaped registry", () => {
	const entries: unknown[] = [];
	registerInquiryStorage({ register: (entry) => entries.push(entry) }, "/tmp/project/.drone");
	expect(entries).toHaveLength(2);
	expect(entries).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ id: "inquiry-root" }),
			expect.objectContaining({ id: "inquiry-ledger" }),
		]),
	);
});
