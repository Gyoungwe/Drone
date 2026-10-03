import assert from "node:assert/strict";
import test from "node:test";
import { createStandaloneRuntime } from "./runtime-bridge.mjs";
import { registerTool, toolMeta } from "./tool-manifest.mjs";

function host() {
	const tools = [];
	return {
		tools,
		registerTool(definition) {
			tools.push(definition);
		},
	};
}

test("tool registration and execution stay inside each Pi host runtime", async () => {
	const first = host();
	const second = host();
	const name = "runtime_context_test";
	registerTool(first, {
		name,
		drone: { capabilities: ["research"] },
		async execute() {
			return toolMeta(name)?.capabilities;
		},
	});
	registerTool(second, {
		name,
		drone: { capabilities: ["knowledge"] },
		async execute() {
			return toolMeta(name)?.capabilities;
		},
	});

	assert.deepEqual(await first.tools[0].execute(), ["research"]);
	assert.deepEqual(await second.tools[0].execute(), ["knowledge"]);
});

test("late desktop runtime adoption keeps declarations registered before host setup", async () => {
	const listeners = new Map();
	const hostObject = {
		tools: [],
		events: {
			on(name, listener) {
				listeners.set(name, listener);
			},
			emit() {},
		},
		registerTool(definition) {
			this.tools.push(definition);
		},
	};
	const name = "runtime_late_adoption_test";
	registerTool(hostObject, {
		name,
		drone: { capabilities: ["research"] },
		async execute() {
			return toolMeta(name)?.capabilities;
		},
	});
	const runtime = createStandaloneRuntime();
	listeners.get("drone:runtime/v1")?.({ version: 1, runtime });
	assert.deepEqual(await hostObject.tools[0].execute(), ["research"]);
	await runtime.dispose();
});
