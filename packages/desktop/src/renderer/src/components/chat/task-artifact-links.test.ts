import type { WorkbenchTask } from "@drone/shared";
import { expect, it } from "vitest";
import { taskArtifactLinks } from "./TaskArtifactLinks";

const base = { milestones: [], operations: [] } as unknown as WorkbenchTask;
it("proposed paths do not invent delivered files", () => {
	expect(
		taskArtifactLinks({
			...base,
			milestones: [{ state: "pending", acceptance: { kind: "file", path: "planned.md" } }],
		} as WorkbenchTask),
	).toEqual([]);
});
it("deduplicates observed files and keeps a later changed-version warning", () => {
	const task = {
		...base,
		milestones: [{ state: "completed", evidence: { kind: "file-observed", path: "C:/report.md" } }],
		operations: [{ state: "changed", artifact: { path: "c:/report.md" } }],
	} as WorkbenchTask;
	expect(taskArtifactLinks(task)).toEqual([
		{ path: "c:/report.md", href: "file:///c:/report.md", state: "changed" },
	]);
});
it("a crash-time write intent is not an observed artifact", () => {
	expect(
		taskArtifactLinks({
			...base,
			operations: [{ state: "unknown", artifact: { path: "planned.md", intentOnly: true } }],
		} as unknown as WorkbenchTask),
	).toEqual([]);
});
