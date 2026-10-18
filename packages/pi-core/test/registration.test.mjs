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

test("drone-doctor resolves the installed Pi host and reports blocked dependencies", async () => {
	const { buildDoctorReport, buildExampleReport, parseExampleArgs } = await import("../dist/index.mjs");
	const doctor = buildDoctorReport({
		getAllTools: () => [
			{ name: "ask_user" },
			{ name: "set_status" },
			{ name: "todo" },
			{ name: "deliver_files" },
			{ name: "memory_save" },
			{ name: "task_plan" },
			{ name: "task_status" },
			{ name: "task_wait" },
			{ name: "task_reconcile" },
			{ name: "task_evidence_restore" },
		],
		getCommands: () => [{ name: "drone-doctor" }, { name: "drone-example" }],
	});
	assert.equal(doctor.schemaVersion, 1);
	assert.equal(doctor.command, "drone-doctor");
	assert.equal(doctor.status, "pass");
	assert.equal(doctor.host.version, "1.1.0");
	assert.equal(doctor.host.source, "resolved-package");

	const blockedDoctor = buildDoctorReport(
		{
			getAllTools: () => [{ name: "ask_user" }],
			getCommands: () => [{ name: "drone-doctor" }, { name: "drone-example" }],
		},
		{ hostVersion: "1.1.0" },
	);
	assert.equal(blockedDoctor.status, "blocked");
	assert.ok(blockedDoctor.checks.find((check) => check.id === "core-tools")?.missing.includes("task_plan"));
	const incompatibleDoctor = buildDoctorReport(
		{
			getAllTools: () => [],
			getCommands: () => [{ name: "drone-doctor" }, { name: "drone-example" }],
		},
		{ hostVersion: "2.0.0" },
	);
	assert.equal(incompatibleDoctor.status, "blocked");
	assert.equal(
		incompatibleDoctor.checks.find((check) => check.id === "pi-host-version")?.status,
		"incompatible",
	);

	const example = buildExampleReport({ getAllTools: () => [] });
	assert.equal(example.command, "drone-example");
	assert.equal(example.status, "blocked");
	assert.ok(example.missingTools.includes("research_search_sources"));
	assert.equal(parseExampleArgs("analysis --run assess RNA-seq inputs").example, "analysis");
	assert.equal(parseExampleArgs("analysis --run assess RNA-seq inputs").mode, "run");
	assert.equal(parseExampleArgs("analysis --run assess RNA-seq inputs").question, "assess RNA-seq inputs");

	const allTools = [
		"knowledge_status",
		"knowledge_search",
		"research_search_sources",
		"research_read_source",
		"research_answer_sources",
		"analysis_list_adapters",
		"analysis_assess_readiness",
		"evidence_validate_manifest",
		"evidence_validate_capsule",
		"evidence_verify_replay",
	].map((name) => ({ name }));
	const fakePi = { getAllTools: () => allTools };
	assert.equal(
		buildExampleReport(fakePi, "preview", undefined, { example: "knowledge" }).status,
		"unconfigured",
	);
	assert.equal(
		buildExampleReport(fakePi, "preview", "find sources", { example: "research" }).title,
		"Evidence-gated local research example",
	);
	assert.equal(
		buildExampleReport(fakePi, "preview", undefined, { example: "analysis" }).title,
		"Analysis readiness example",
	);
	assert.equal(
		buildExampleReport(fakePi, "preview", undefined, { example: "evidence" }).title,
		"Evidence validation example",
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
