import { withRuntime } from "@drone/tasks/runtime-bridge";
import { createTaskWorkbench } from "@drone/tasks/workbench";
import { taskHostLoader } from "@gyoungwe/pi-core/host";
import { expect, it } from "vitest";
import { createBackend } from "../src/create-backend";

it("installed task host normalizes production plans before the host writes a checkpoint", () => {
	const services = createBackend({ projectTrust: false, permissionGates: false, taskHostLoader });
	try {
		withRuntime(services.runtime, () => {
			const checkpoints = [];
			const journal = createTaskWorkbench({ persist: (value) => checkpoints.push(value) });
			journal.attach("installed-plan");
			journal.begin("deliver");
			journal.plan({
				milestones: [{ id: "first_step", title: "First", acceptance: { kind: "file", path: "result.txt" } }],
			});
			expect(journal.snapshot().milestones[0]).toMatchObject({
				id: "first_step",
				state: "pending",
				evidence: null,
			});
			const before = journal.view();
			const writes = checkpoints.length;
			expect(() =>
				journal.plan({
					milestones: [{ id: "bad id", title: "Bad", acceptance: { kind: "file", path: "other.txt" } }],
				}),
			).toThrow("invalid: use");
			expect(checkpoints).toHaveLength(writes);
			expect(journal.view()).toEqual(before);
		});
	} finally {
		services.dispose();
	}
});

it("a host without the optional task planner rejects planning without creating a task", () => {
	const services = createBackend({ projectTrust: false, permissionGates: false });
	try {
		withRuntime(services.runtime, () => {
			const checkpoints = [];
			const journal = createTaskWorkbench({ persist: (value) => checkpoints.push(value) });
			journal.attach("no-planner");
			journal.begin("deliver");
			const before = structuredClone(checkpoints);
			expect(() =>
				journal.plan({
					milestones: [{ id: "one", title: "One", acceptance: { kind: "file", path: "result.txt" } }],
				}),
			).toThrow("Task milestone planning plugin is unavailable");
			expect(journal.view().tasks).toEqual([]);
			expect(checkpoints).toEqual(before);
		});
	} finally {
		services.dispose();
	}
});
