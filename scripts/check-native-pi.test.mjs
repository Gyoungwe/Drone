import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
	applyFixture,
	DEFAULT_FIXTURE,
	formatReport,
	scanNativePiRegistrations,
	validateNativePiFixture,
} from "./check-native-pi.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = JSON.parse(fs.readFileSync(DEFAULT_FIXTURE, "utf8"));

test("native Pi scan maps direct, task-helper, and factory registrations", () => {
	const records = scanNativePiRegistrations(rootDir);
	assert.ok(records.some((record) => record.name === "task_plan" && record.registration === "task-helper"));
	assert.ok(
		records.some(
			(record) =>
				record.name === "channel_subscribe" &&
				record.registration === "dynamic-registerTool" &&
				record.source.endsWith("channel-watch/tools.ts") &&
				record.registrationSource?.endsWith("channel-watch/extension.ts"),
		),
	);
	assert.ok(records.some((record) => record.name === "research_zotero_update"));
});

test("checked-in fixture covers every discovered registration", () => {
	const records = scanNativePiRegistrations(rootDir);
	assert.deepEqual(validateNativePiFixture(records, fixture), []);
	const mapped = applyFixture(records, fixture);
	assert.equal(mapped.length, records.length);
	assert.ok(mapped.every((entry) => entry.nativePiAvailable === true));
	assert.ok(
		Object.values(fixture.tools).some((mapping) => mapping.delegated === true),
		"plugin-owned registrations must be marked as delegated",
	);
	assert.deepEqual([...new Set(mapped.map((entry) => entry.targetPackage))].sort(), [
		"pi-core",
		"pi-knowledge",
		"pi-research",
		"pi-tasks",
	]);
});

test("fixture validation catches missing and stale mappings", () => {
	const records = scanNativePiRegistrations(rootDir);
	const broken = structuredClone(fixture);
	delete broken.tools.task_plan;
	broken.tools.research_loop.source = "packages/extensions/src/moved.ts";
	broken.tools.stale = {
		source: "packages/extensions/src/stale.ts",
		registration: "registerTool",
		nativePiAvailable: true,
		targetPackage: "pi-research",
	};
	const errors = validateNativePiFixture(records, broken);
	assert.ok(errors.some((error) => error.includes("missing fixture mapping for task_plan")));
	assert.ok(errors.some((error) => error.includes("delegated fixture source is missing for research_loop")));
	assert.ok(errors.some((error) => error.includes("fixture mapping has no source registration: stale")));
});

test("report exposes migration fields for humans and automation", () => {
	const report = formatReport(
		applyFixture(scanNativePiRegistrations(rootDir), fixture).filter((entry) =>
			["task_plan", "channel_subscribe"].includes(entry.toolName),
		),
	);
	assert.match(report, /tool\tlocation\tnative Pi\ttarget package/);
	assert.match(report, /task_plan\tpackages\/tasks\/src\/runtime\/register\.ts:/);
	assert.match(report, /channel_subscribe\tpackages\/backend\/src\/tools\/channel-watch\/tools\.ts:/);
	assert.match(report, /pi-tasks/);
	assert.match(report, /pi-core/);
});
