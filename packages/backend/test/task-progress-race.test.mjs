import { expect, it, vi } from "vitest";
import { createTaskProgression } from "../../../.pi/lib/tasks/progress-action.mjs";

it.each(["generation", "task", "binding", "abort"])(
	"%s changing during readback cancels the old continuation",
	async (change) => {
		let generation = 0,
			binding = null;
		const controller = new AbortController();
		let task = {
			id: "old",
			state: "partial",
			executionConsent: {},
			milestones: [
				{
					id: "file",
					title: "报告",
					state: "pending",
					dependsOn: [],
					acceptance: { kind: "file", path: "report.md" },
				},
			],
			actions: [],
			operations: [],
		};
		const j = {
			scope: () => "scope",
			view: () => ({ revision: 1, tasks: [task] }),
			snapshot: () => task,
			authorization: () => ({}),
			command: vi.fn(),
			reconcile: vi.fn(async () => {
				if (change === "generation") generation++;
				if (change === "task") task = { ...task, id: "other" };
				if (change === "binding") binding = "other";
				if (change === "abort") controller.abort();
			}),
		};
		const next = vi.fn(),
			send = vi.fn();
		const run = createTaskProgression(j, {
			getGeneration: () => generation,
			checkBinding: async () => binding,
			continueAuthorized: next,
			send,
		});
		await run(
			{ taskId: "old", revision: 1 },
			{
				cwd: "/fixture",
				signal: controller.signal,
				isIdle: () => true,
				ui: { select: async () => "接着做完剩下的" },
			},
		);
		expect(j.reconcile).toHaveBeenCalledOnce();
		expect(next).not.toHaveBeenCalled();
		expect(send).not.toHaveBeenCalled();
	},
);
