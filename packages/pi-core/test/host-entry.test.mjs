import assert from "node:assert/strict";
import test from "node:test";
import * as host from "../dist/host.mjs";

test("versioned host entry exposes the portable tool contracts", () => {
	for (const name of [
		"makeStatusTool",
		"makeTodoTool",
		"normalizeTodos",
		"formatTodoList",
		"makeMemorySaveTool",
		"deliverFilesParams",
		"makeDeliverFilesTool",
	]) {
		assert.equal(typeof host[name], name === "deliverFilesParams" ? "object" : "function", name);
	}
});
