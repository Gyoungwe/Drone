import { describe, expect, it, vi } from "vitest";
import { createTaskProgression, type TaskProgressionTask } from "../src/progress-action";

function fixture() {
	let task: TaskProgressionTask = {
		id: "task-1",
		state: "partial",
		executionConsent: undefined,
		milestones: [
			{ id: "report", title: "报告", state: "pending", acceptance: { kind: "file", path: "report.md" } },
		],
		actions: [],
		operations: [],
	};
	const journal = {
		scope: () => "scope",
		view: () => ({ revision: 1, tasks: [task] }),
		snapshot: () => task,
		command: vi.fn(),
		acceptFile: vi.fn(async () => {}),
		reconcile: vi.fn(async () => {}),
		authorization: () => task.executionConsent,
	};
	return { journal, getTask: () => task, setTask: (next: TaskProgressionTask) => (task = next) };
}

describe("task progression policy", () => {
	it("uses one explicit authorization and preserves it for continuation", async () => {
		const f = fixture();
		const authorize = vi.fn(async () => {
			f.setTask({ ...f.getTask(), executionConsent: { approved: true } });
			return true;
		});
		const continueAuthorized = vi.fn();
		const send = vi.fn();
		const run = createTaskProgression({
			taskJournal: f.journal,
			taskAuthorization: authorize,
			checkBinding: async () => null,
			continueAuthorized,
			send,
		});

		await run(
			{ taskId: "task-1", revision: 1 },
			{ cwd: "/fixture", isIdle: () => true, ui: { select: vi.fn() } },
		);

		expect(authorize).toHaveBeenCalledOnce();
		expect(continueAuthorized).toHaveBeenCalledOnce();
		expect(send).toHaveBeenCalledWith("你已确认，接着完成剩下的交付。");
		expect(f.getTask().executionConsent).toEqual({ approved: true });
	});

	it("rejects a changed task after the progression choice", async () => {
		const f = fixture();
		f.setTask({ ...f.getTask(), executionConsent: { approved: true } });
		const run = createTaskProgression({
			taskJournal: f.journal,
			taskAuthorization: async () => false,
			checkBinding: async () => null,
			continueAuthorized: vi.fn(),
			send: vi.fn(),
		});

		await expect(
			run(
				{ taskId: "task-1", revision: 1 },
				{
					cwd: "/fixture",
					isIdle: () => true,
					ui: {
						select: async () => {
							f.setTask({ ...f.getTask(), id: "task-2" });
							return "接着做完剩下的";
						},
					},
				},
			),
		).rejects.toThrow("变化");
		expect(f.journal.reconcile).not.toHaveBeenCalled();
	});
});
