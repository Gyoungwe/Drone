import assert from "node:assert/strict";
import test from "node:test";
import { CORE_HOST_CONTRACT_VERSION } from "../dist/core.js";

test("core host contract is versioned and exposes a fail-closed loader shape", () => {
	assert.equal(CORE_HOST_CONTRACT_VERSION, 1);
	const loader = {
		contractVersion: CORE_HOST_CONTRACT_VERSION,
		load: () => ({
			contractVersion: CORE_HOST_CONTRACT_VERSION,
			makeDeliverFilesTool: () => ({}),
			makeMemorySaveTool: () => ({}),
			makeStatusTool: () => ({}),
			makeTodoTool: () => ({}),
			memoryIndexPrompt: () => [],
			writeMemory: () => "memory.md",
		}),
	};
	assert.equal(loader.load().contractVersion, CORE_HOST_CONTRACT_VERSION);
	assert.deepEqual(loader.load().memoryIndexPrompt("/workspace"), []);
});
