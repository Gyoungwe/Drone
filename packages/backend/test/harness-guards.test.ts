import { describe, expect, it } from "vitest";
import { createHarnessGuardState, observeHarnessFailure } from "../src/session-engine/harness/guards";

describe("harness loop guard", () => {
	it("redirects once after three identical failures and blocks after a second streak", () => {
		const failure = { signature: "same", tool: "bash", reason: "exit 1" };
		let state = createHarnessGuardState();
		state = observeHarnessFailure(state, failure);
		state = observeHarnessFailure(state, failure);
		expect(state.pending).toBe(false);
		state = observeHarnessFailure(state, failure);
		expect(state.redirects).toBe(1);
		expect(state.blocked).toBe(false);
		state = { ...state, pending: false };
		for (let i = 0; i < 3; i++) state = observeHarnessFailure(state, failure);
		expect(state.redirects).toBe(2);
		expect(state.blocked).toBe(true);
	});
	it("resets a failure streak after a successful tool result", () => {
		const failure = { signature: "same", tool: "bash", reason: "exit 1" };
		let state = observeHarnessFailure(createHarnessGuardState(), failure);
		state = observeHarnessFailure(state, undefined);
		state = observeHarnessFailure(state, failure);
		expect(state.streak).toBe(1);
		expect(state.redirects).toBe(0);
	});
});
