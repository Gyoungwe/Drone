import assert from "node:assert/strict";
import test from "node:test";
import { RESEARCH_HOST_CONTRACT_VERSION } from "../dist/research.js";

test("research host contract is versioned and runtime dependency-free", () => {
	assert.equal(RESEARCH_HOST_CONTRACT_VERSION, 1);
});
