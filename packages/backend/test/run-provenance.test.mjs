import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { startResearchRun } from "../../../.pi/lib/research-loop.mjs";
import { observeExecutionReceipt, recordRunProvenance } from "../../../.pi/lib/run-provenance.mjs";

let cwd, runDir;
beforeEach(async () => {
	vi.stubEnv("DRONE_KNOWLEDGE_DIR", undefined);
	vi.stubEnv("PI_RESEARCH_DESKTOP_CONFIG", undefined);
	cwd = await mkdtemp(join(tmpdir(), "run-provenance-"));
	runDir = (await startResearchRun({ cwd, resultSlug: "manifest", query: "test" })).run_dir;
});
afterEach(async () => {
	vi.unstubAllEnvs();
	await rm(cwd, { recursive: true, force: true });
});
it("records actual current bytes and keeps proposed analysis/QC distinct from execution", async () => {
	await writeFile(join(cwd, "input.fa"), ">a\nACGT\n");
	const result = await recordRunProvenance({
		cwd,
		runDir,
		files: [{ path: "input.fa", role: "input" }],
		declarations: { softwareVersions: { OrthoFinder: "unverified" }, seed: 1, qc: "claimed-pass" },
	});
	expect(result.executionStatus).toBe("no-execution-observed");
	expect(result.qcVerified).toBe(false);
	expect(result.declaredSoftwareVersionsVerified).toBe(false);
	expect(result.files[0].sha256).toBe(createHash("sha256").update(">a\nACGT\n").digest("hex"));
	expect(JSON.parse(await readFile(result.path, "utf8")).scientificallyVerified).toBe(false);
});
it("observes host command references once without persisting command secrets", async () => {
	const receipt = {
		cwd,
		runDir,
		toolCallId: "call",
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
it("blocked or failed tools are not reported as executed analyses", async () => {
	await observeExecutionReceipt({
		cwd,
		runDir,
		toolCallId: "blocked",
		toolName: "powershell",
		isError: true,
		details: {},
	});
	const result = await recordRunProvenance({ cwd, runDir });
	expect(result.executionObservations[0]).toMatchObject({
		outcome: "failed-or-blocked",
		exitCode: null,
		executionConfirmed: false,
	});
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
