import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveLegacyKnowledgeWorkerResource } from "./knowledge-compat-fixture";

describe("backend knowledge worker host", () => {
	it("resolves the generated worker from the selected workbench root", () => {
		expect(resolveLegacyKnowledgeWorkerResource().path).toMatch(
			/\.pi[\\/]extensions[\\/]knowledge-worker\.mjs$/,
		);
	});

	it("uses the packaged workbench root when the host provides one", () => {
		const root = mkdtempSync(join(tmpdir(), "drone-packaged-workbench-"));
		try {
			mkdirSync(join(root, "extensions"));
			const source = "// fixture\n";
			writeFileSync(join(root, "extensions", "knowledge-worker.mjs"), source);
			writeFileSync(
				join(root, "extensions", ".knowledge-worker-manifest.json"),
				JSON.stringify({ version: 1, outputSha256: createHash("sha256").update(source).digest("hex") }),
			);
			expect(resolveLegacyKnowledgeWorkerResource(root).path).toBe(
				join(root, "extensions", "knowledge-worker.mjs"),
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("fails closed when a host did not inject the worker resource", () => {
		expect(() => resolveLegacyKnowledgeWorkerResource("/tmp/drone-missing-workbench")).toThrow(
			/Knowledge worker resource is missing/,
		);
	});
});
