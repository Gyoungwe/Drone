import assert from "node:assert/strict";
import test from "node:test";
import { TASK_HOST_CONTRACT_VERSION } from "../dist/tasks.js";

test("task host contract is versioned and dependency-free", () => {
	assert.equal(TASK_HOST_CONTRACT_VERSION, 1);
});
