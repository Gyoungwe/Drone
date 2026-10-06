import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	observeExecutionReceipt,
	readMethodsFacts,
	recordRunProvenance,
	saveMethodsSection,
} from "../src/run-provenance";

let cwd: string;
let runDir: string;

beforeEach(async () => {
	cwd = await mkdtemp(join(tmpdir(), "drone-research-provenance-"));
	runDir = join(cwd, "results", "fixture", "run-fixture");
	await mkdir(runDir, { recursive: true });
	await writeFile(join(runDir, "metadata.json"), "{}");
});

afterEach(async () => {
	await rm(cwd, { recursive: true, force: true });
});

describe("run provenance", () => {
	it("records bounded file snapshots while keeping QC unverified", async () => {
		await writeFile(join(cwd, "input.fa"), ">a\nACGT\n");
		const result = await recordRunProvenance({
			cwd,
			runDir,
			files: [{ path: "input.fa", role: "input" }],
			declarations: { seed: 1, qc: "claimed-pass" },
		});
		expect(result.executionStatus).toBe("no-execution-observed");
		expect(result.qcVerified).toBe(false);
		expect(result.scientificallyVerified).toBe(false);
		expect(result.files[0]?.sha256).toBe(createHash("sha256").update(">a\nACGT\n").digest("hex"));
		expect(JSON.parse(await readFile(result.path, "utf8")).scientificallyVerified).toBe(false);
	});

	it("deduplicates host observations without persisting command text", async () => {
		const receipt = {
			cwd,
			runDir,
			toolCallId: "call-1",
			toolName: "bash",
			args: { command: "echo private-token-fixture" },
			details: { exitCode: 0 },
		};
		await Promise.all([observeExecutionReceipt(receipt), observeExecutionReceipt(receipt)]);
		const result = await recordRunProvenance({ cwd, runDir });
		expect(result.executionObservations).toHaveLength(1);
		expect(result.executionObservations[0]).toMatchObject({
			exitCode: 0,
			executionConfirmed: true,
			qcVerified: false,
		});
		expect(JSON.stringify(result)).not.toContain("private-token-fixture");
	});

	it("keeps failed tools unconfirmed and ignores non-shell receipts", async () => {
		expect(await observeExecutionReceipt({ cwd, runDir, toolCallId: "read-1", toolName: "read" })).toBeNull();
		await observeExecutionReceipt({
			cwd,
			runDir,
			toolCallId: "blocked-1",
			toolName: "powershell",
			isError: true,
		});
		const result = await recordRunProvenance({ cwd, runDir });
		expect(result.executionObservations).toHaveLength(1);
		expect(result.executionObservations[0]).toMatchObject({
			outcome: "failed-or-blocked",
			exitCode: null,
			executionConfirmed: false,
		});
	});

	it("uses the injected results root without loading Pi workspace modules", async () => {
		const customResultsRoot = join(cwd, "custom-results");
		const customRun = join(customResultsRoot, "fixture", "run-custom");
		await mkdir(customRun, { recursive: true });
		await writeFile(join(customRun, "metadata.json"), "{}");
		const loadWorkspaceConfig = async (project: string) => {
			expect(project).toBe(cwd);
			return { resultsRoot: customResultsRoot };
		};
		const result = await recordRunProvenance({ cwd, runDir: customRun, loadWorkspaceConfig });
		expect(result.runDir).toBe(await realpath(customRun));
		await expect(recordRunProvenance({ cwd, runDir: customRun })).rejects.toThrow("Expected existing run");
	});

	it("rejects credential files and files outside the project", async () => {
		await writeFile(join(cwd, "auth.json"), "{}");
		await expect(
			recordRunProvenance({ cwd, runDir, files: [{ path: "auth.json", role: "input" }] }),
		).rejects.toThrow("permitted");
		await expect(
			recordRunProvenance({ cwd, runDir, files: [{ path: process.execPath, role: "input" }] }),
		).rejects.toThrow("permitted");
	});
});

describe("methods facts", () => {
	it("collects recorded facts and names the gaps instead of inventing them", async () => {
		await writeFile(
			join(runDir, "metadata.json"),
			JSON.stringify({ query: "DE genes in liver", status: "completed", started_at: "2026-10-01T00:00:00Z" }),
		);
		let facts = await readMethodsFacts({ cwd, runDir });
		expect(facts.query).toBe("DE genes in liver");
		expect(facts.gaps.join(" ")).toMatch(/No reproducibility manifest/);

		await writeFile(join(cwd, "counts.tsv"), "gene\tcount\n");
		await recordRunProvenance({
			cwd,
			runDir,
			files: [{ path: "counts.tsv", role: "input" }],
			declarations: { software: { DESeq2: "1.44.0" }, alpha: 0.05 },
		});
		facts = await readMethodsFacts({ cwd, runDir });
		expect(facts.inputs).toEqual([{ path: "counts.tsv", sha256: expect.stringMatching(/^[0-9a-f]{64}$/) }]);
		expect(facts.declarations).toEqual({ software: { DESeq2: "1.44.0" }, alpha: 0.05 });
		expect(facts.gaps.join(" ")).toMatch(/No executed commands/);
		expect(facts.existingMethods).toBeNull();
	});

	it("saves an approved Methods section atomically inside the run only", async () => {
		const saved = await saveMethodsSection({
			cwd,
			runDir,
			text: "Reads were aligned with STAR.",
			approvedAt: "T",
		});
		expect(saved.path).toBe(join(await realpath(runDir), "METHODS.md"));
		const body = await readFile(saved.path, "utf8");
		expect(body).toContain("approved_at=T");
		expect(body).toContain("Reads were aligned with STAR.");
		expect((await readMethodsFacts({ cwd, runDir })).existingMethods).toContain("STAR");
		await expect(saveMethodsSection({ cwd, runDir, text: "  " })).rejects.toThrow(/empty/);
		await expect(saveMethodsSection({ cwd, runDir: cwd, text: "x" })).rejects.toThrow(
			/run inside results root/,
		);
	});
});
