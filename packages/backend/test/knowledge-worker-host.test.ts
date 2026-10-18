import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveBackendKnowledgeWorkerPath } from "../src/knowledge/ui";

describe("backend knowledge worker host", () => {
	it("resolves the generated worker from the selected workbench root", () => {
		expect(resolveBackendKnowledgeWorkerPath()).toMatch(/\.pi[\\/]extensions[\\/]knowledge-worker\.mjs$/);
	});

	it("uses the packaged workbench root when the host provides one", () => {
		const root = mkdtempSync(join(tmpdir(), "drone-packaged-workbench-"));
		try {
			mkdirSync(join(root, "extensions"));
			writeFileSync(join(root, "extensions", "knowledge-worker.mjs"), "// fixture\n");
			expect(resolveBackendKnowledgeWorkerPath(root)).toBe(join(root, "extensions", "knowledge-worker.mjs"));
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("fails closed when a host did not inject the worker resource", () => {
		expect(() => resolveBackendKnowledgeWorkerPath("/tmp/drone-missing-workbench")).toThrow(
			/Knowledge worker resource is missing/,
		);
	});
});
