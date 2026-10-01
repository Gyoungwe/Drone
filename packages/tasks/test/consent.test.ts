import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { contractHash, hasTaskConsent, resolveWriteRoots } from "../src/consent";

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("task consent", () => {
	it("invalidates consent when the immutable contract changes", () => {
		const task = {
			id: "task-1",
			goal: "write a report",
			writeRoots: ["project"],
			milestones: [{ id: "report", title: "Report", acceptance: { kind: "file", path: "report.md" } }],
			planApproved: true,
		};
		const approved = {
			...task,
			executionConsent: {
				version: 1,
				contractHash: contractHash(task),
				maxCalls: 10,
				maxAutoResumes: 3,
				approvedAt: "now",
			},
		};
		expect(hasTaskConsent(approved, 10)).toBe(true);
		expect(hasTaskConsent({ ...approved, goal: "different" }, 10)).toBe(false);
	});
	it("only resolves existing project directories below the home directory", async () => {
		const root = await mkdtemp(join(tmpdir(), "drone-tasks-consent-"));
		roots.push(root);
		await mkdir(join(root, "project"));
		expect(await resolveWriteRoots(root, ["project", "project"])).toEqual([
			await realpath(join(root, "project")),
		]);
		await expect(resolveWriteRoots(root, ["missing"])).rejects.toThrow();
	});
});
