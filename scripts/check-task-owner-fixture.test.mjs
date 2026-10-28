import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createTaskFixture } from "./knowledge-ui-smoke/task-owner.mjs";

test("the UI task fixture uses installed native authorization, file readback and persistent recovery", async () => {
	const cwd = await realpath(await mkdtemp(join(tmpdir(), "drone-ui-task-owner-")));
	const entries = [],
		fixtures = [];
	try {
		const first = await createTaskFixture(cwd, {
			persist: (data) => entries.push({ customType: "drone-task-session-v1", data }),
		});
		fixtures.push(first);
		const journal = first.journal;
		await journal.plan({
			goal: "Deliver a synthetic file",
			summary: "Read it back",
			writeRoots: [cwd],
			milestones: [{ id: "file", title: "File", acceptance: { kind: "file", path: "result.txt" } }],
		});
		await journal.command({
			taskId: journal.snapshot().id,
			revision: journal.view().revision,
			action: "authorize-task",
		});
		const event = {
			toolName: "write",
			toolCallId: "write",
			input: { path: "result.txt", content: "synthetic file" },
			isError: false,
			content: [],
			details: {},
		};
		assert.equal(await journal.guard(event), null);
		await writeFile(join(cwd, "result.txt"), "synthetic file");
		await journal.observe(event, cwd);
		assert.match(journal.view().tasks[0].remainingSummary, /已验收 1\/1/);
		const taskId = journal.snapshot().id;
		await first.dispose();
		const restored = await createTaskFixture(cwd, { entries });
		fixtures.push(restored);
		await restored.journal.reconcile(cwd);
		assert.equal(restored.journal.snapshot().id, taskId);
		assert.match(restored.journal.view().tasks[0].remainingSummary, /已验收 1\/1/);
	} finally {
		await Promise.all(fixtures.map((fixture) => fixture.dispose()));
		await rm(cwd, { recursive: true, force: true });
	}
});
