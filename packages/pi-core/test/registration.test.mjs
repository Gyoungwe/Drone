import assert from "node:assert/strict";
import test from "node:test";

process.env.DRONE_TASK_WORKBENCH = "off";
const { registerPiCore, createNativePiHostPort } = await import("../dist/index.mjs");

test("registerPiCore exposes the portable tools and task runtime", () => {
	const tools = [];
	const commands = new Map();
	const pi = {
		on() {},
		registerTool(tool) {
			tools.push(tool);
		},
		registerCommand(name, definition) {
			commands.set(name, definition);
		},
		getAllTools() {
			return tools.map((tool) => ({ name: tool.name }));
		},
		getCommands() {
			return [...commands.keys()].map((name) => ({ name }));
		},
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
	assert.ok(commands.has("drone-doctor"));
	assert.ok(commands.has("drone-example"));
});

test("drone-doctor and drone-example return stable blocked/needs-data reports", async () => {
	const { buildDoctorReport, buildExampleReport } = await import("../dist/index.mjs");
	const doctor = buildDoctorReport(
		{
			getAllTools: () => [{ name: "ask_user" }],
			getCommands: () => [{ name: "drone-doctor" }, { name: "drone-example" }],
		},
		{ hostVersion: "1.1.0" },
	);
	assert.equal(doctor.schemaVersion, 1);
	assert.equal(doctor.command, "drone-doctor");
	assert.equal(doctor.status, "blocked");
	assert.ok(doctor.checks.find((check) => check.id === "core-tools")?.missing.includes("task_plan"));
	const example = buildExampleReport({ getAllTools: () => [] });
	assert.equal(example.command, "drone-example");
	assert.equal(example.status, "blocked");
	assert.ok(example.missingTools.includes("research_search_sources"));
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
