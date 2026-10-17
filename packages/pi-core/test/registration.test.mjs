import assert from "node:assert/strict";
import test from "node:test";

process.env.DRONE_TASK_WORKBENCH = "off";
const { registerPiCore, createNativePiHostPort } = await import("../dist/index.mjs");

test("registerPiCore exposes the portable tools and task runtime", () => {
	const tools = [];
	const pi = {
		on() {},
		registerTool(tool) {
			tools.push(tool);
		},
		registerCommand() {},
		appendEntry() {},
		sendMessage() {},
		events: { on() {}, emit() {} },
	};
	const result = registerPiCore(pi);
	assert.deepEqual(result.tools.slice(-5), [
		"ask_user",
		"set_status",
		"todo",
		"deliver_files",
		"memory_save",
	]);
	for (const name of ["ask_user", "set_status", "todo", "deliver_files", "memory_save", "task_status"])
		assert.ok(
			tools.some((tool) => tool.name === name),
			`missing ${name}`,
		);
});

test("native host adapter uses ctx.ui authorization and advertises native Pi", async () => {
	const host = createNativePiHostPort({
		signal: new AbortController().signal,
		ui: { confirm: async () => true },
	});
	assert.equal(host.host, "native-pi");
	assert.equal((await host.requestAuthorization({ action: "write" })).granted, true);
	assert.equal(host.capabilities().capabilities.includes("requestAuthorization"), true);
});
