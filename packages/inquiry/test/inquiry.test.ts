import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	type ArtifactRecord,
	FileInquiryStorage,
	type FindingRecord,
	InquiryService,
	MemoryInquiryStorage,
	planWorkspacePromotion,
	registerInquiryStorage,
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
		expect(plan.moves[0]?.from).toBe(join("/tmp/project", "runs/task-1/run-1/output.tsv"));
		expect(plan.moves[0]?.to).toBe(join("/tmp/project", "results/task-1/run-1/output.tsv"));
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
