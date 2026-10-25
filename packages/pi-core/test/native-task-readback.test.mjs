import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createStandaloneRuntime } from "@drone/tasks/runtime-bridge";
import { registerPiCore } from "../dist/index.mjs";

delete process.env.DRONE_TASK_WORKBENCH;

async function host(t, { choice = "同意本次请求", ui = true, options = {}, desktopRuntime = false } = {}) {
	const cwd = await realpath(await mkdtemp(join(tmpdir(), "pi-core-readback-")));
	t.after(() => rm(cwd, { recursive: true, force: true }));
	const emitter = new EventEmitter();
	const hooks = new Map();
	const tools = new Map();
	const entries = [];
	let prompts = 0;
	const pi = {
		events: {
			on(name, handler) {
				emitter.on(name, handler);
				return () => emitter.off(name, handler);
			},
			emit(name, data) {
				emitter.emit(name, data);
			},
		},
		on(name, handler) {
			hooks.set(name, [...(hooks.get(name) || []), handler]);
		},
		registerTool(tool) {
			tools.set(tool.name, tool);
		},
		registerCommand() {},
		getCommands: () => [],
		getAllTools: () => [...tools.values()],
		appendEntry(customType, data) {
			entries.push({ customType, data });
		},
		sendMessage() {},
	};
	const desktopHostRuntime = createStandaloneRuntime();
	t.after(() => desktopHostRuntime.dispose());
	if (desktopRuntime)
		pi.events.on("drone:runtime/request/v1", () =>
			pi.events.emit("drone:runtime/v1", { version: 1, runtime: desktopHostRuntime }),
		);
	registerPiCore(pi, options);
	const ctx = {
		cwd,
		sessionManager: { getSessionId: () => "native-session", getBranch: () => entries },
		...(ui
			? {
					ui: {
						select: async () => {
							prompts++;
							return choice;
						},
					},
				}
			: {}),
	};
	const emit = async (name, context = ctx) => {
		for (const callback of hooks.get(name) || []) await callback({}, context);
	};
	const call = async (name, input = {}, context = ctx) => {
		const result = await tools.get(name).execute("probe", input, undefined, undefined, context);
		return JSON.parse(result.content[0].text);
	};
	const plan = async (path = "summary.md", writeDirectories = ["."]) =>
		call("task_plan", {
			goal: "Read back the authorized research summary",
			summary: "Create and verify one local summary.",
			writeDirectories,
			milestones: [{ id: "summary", title: "Summary", acceptance: { kind: "file", path } }],
		});
	await emit("session_start");
	return { cwd, ctx, pi, emit, call, plan, prompts: () => prompts, emitter };
}
const activeTask = (view) => view.tasks.find((task) => task.id === view.activeTaskId);

test("native task consent permits artifact readback, including a completed task", async (t) => {
	const current = await host(t);
	assert.equal((await current.plan()).authorized, true);
	await writeFile(join(current.cwd, "summary.md"), "Source-linked summary.\n");
	for (let i = 0; i < 2; i++) {
		const task = activeTask(await current.call("task_reconcile"));
		assert.equal(task.state, "completed");
		assert.equal(task.milestones[0].state, "completed");
		assert.equal(task.milestones[0].evidence.sha256.length, 64);
	}
	assert.equal(current.prompts(), 1);
});

for (const scenario of [
	{ name: "no UI", ui: false },
	{ name: "declined consent", choice: "暂不授权" },
]) {
	test(`native readback denies ${scenario.name}`, async (t) => {
		const current = await host(t, scenario);
		assert.equal((await current.plan()).authorized, false);
		await writeFile(join(current.cwd, "summary.md"), "Existing file does not authorize a read.\n");
		assert.notEqual(activeTask(await current.call("task_reconcile")).state, "completed");
	});
}

test("native readback keeps private paths and symlink escapes blocked", async (t) => {
	for (const kind of ["private", "symlink", "outside-approved-root"]) {
		const current = await host(t);
		await mkdir(join(current.cwd, "output"));
		await mkdir(join(current.cwd, ".private"));
		await writeFile(join(current.cwd, ".private", "summary.md"), "Private material\n");
		await writeFile(join(current.cwd, "summary.md"), "Outside approved output\n");
		await symlink(join(current.cwd, "summary.md"), join(current.cwd, "output", "summary.md"));
		const path =
			kind === "private" ? ".private/summary.md" : kind === "symlink" ? "output/summary.md" : "summary.md";
		assert.equal((await current.plan(path, kind === "private" ? ["."] : ["output"])).authorized, true);
		assert.notEqual(activeTask(await current.call("task_reconcile")).state, "completed", kind);
	}
});

test("independent event buses and new sessions cannot borrow native task consent", async (t) => {
	const approved = await host(t);
	const unrelated = await host(t, { choice: "暂不授权" });
	await approved.plan();
	await unrelated.plan();
	await writeFile(join(approved.cwd, "summary.md"), "Approved\n");
	await writeFile(join(unrelated.cwd, "summary.md"), "Not approved\n");
	assert.equal(activeTask(await approved.call("task_reconcile")).state, "completed");
	assert.notEqual(activeTask(await unrelated.call("task_reconcile")).state, "completed");
	let claimed = false;
	approved.pi.events.emit("drone:task-read-check", {
		cwd: approved.cwd,
		path: join(approved.cwd, "summary.md"),
		sessionId: "another-session",
		claim: () => {
			claimed = true;
		},
		resolve: () => assert.fail("must not answer another session"),
	});
	assert.equal(claimed, false);
	await approved.emit("session_shutdown");
	approved.pi.events.emit("drone:task-read-check", {
		cwd: approved.cwd,
		path: join(approved.cwd, "summary.md"),
		sessionId: "native-session",
		claim: () => {
			claimed = true;
		},
		resolve: () => assert.fail("must not answer a disposed session"),
	});
	assert.equal(claimed, false);
});

test("Desktop ownership leaves read permissions to the Desktop adapter", async (t) => {
	const current = await host(t, {
		options: {
			host: {
				host: "drone-desktop",
				capabilities: () => ({ capabilities: ["requestAuthorization"] }),
				requestAuthorization: async () => ({ granted: false }),
			},
		},
	});
	assert.equal(current.emitter.listenerCount("drone:task-read-check"), 0);
	const discovered = await host(t);
	discovered.pi.events.emit("drone:runtime/v1", { version: 1, runtime: { scheduler: {} } });
	await discovered.plan();
	await writeFile(join(discovered.cwd, "summary.md"), "Desktop must decide.\n");
	assert.notEqual(activeTask(await discovered.call("task_reconcile")).state, "completed");
});

test("native readback refuses revoked UI and an in-flight session switch", async (t) => {
	const current = await host(t);
	await current.plan();
	await writeFile(join(current.cwd, "summary.md"), "Summary\n");
	current.ctx.hasUI = false;
	assert.notEqual(activeTask(await current.call("task_reconcile")).state, "completed");
	current.ctx.hasUI = true;
	const outcome = new Promise((resolve) =>
		current.pi.events.emit("drone:task-read-check", {
			cwd: current.cwd,
			path: join(current.cwd, "summary.md"),
			sessionId: "native-session",
			claim() {},
			resolve,
		}),
	);
	await current.emit("session_start", {
		...current.ctx,
		sessionManager: {
			getSessionId: () => "new-session",
			getBranch: () => [],
		},
	});
	assert.equal(await outcome, false);
});

test("cancelled task consent is not cached by native readback", async (t) => {
	const current = await host(t);
	await current.plan();
	await writeFile(join(current.cwd, "summary.md"), "Summary\n");
	assert.equal(activeTask(await current.call("task_reconcile")).state, "completed");
	let journal;
	const unsubscribe = current.pi.events.on("drone:task-runtime/v1", (payload) => {
		journal = payload.registry.journal;
	});
	current.pi.events.emit("drone:task-runtime/request/v1", { version: 1 });
	unsubscribe();
	journal.command({ action: "cancel", taskId: journal.snapshot().id, revision: journal.view().revision });
	const allowed = await new Promise((resolve) =>
		current.pi.events.emit("drone:task-read-check", {
			cwd: current.cwd,
			path: join(current.cwd, "summary.md"),
			sessionId: "native-session",
			claim() {},
			resolve,
		}),
	);
	assert.equal(allowed, false);
});

test("a pre-existing Desktop runtime is discovered before native readback", async (t) => {
	const current = await host(t, { desktopRuntime: true });
	await current.plan();
	await writeFile(join(current.cwd, "summary.md"), "Desktop authorization required.\n");
	assert.notEqual(activeTask(await current.call("task_reconcile")).state, "completed");
});
