import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { observeExecutionReceipt, recordRunProvenance } from "../src/run-provenance";

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
