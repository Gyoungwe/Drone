import { describe, expect, it, vi } from "vitest";
import {
	createHarnessGuardState,
	makeHarnessGuardExtension,
	observeHarnessFailure,
} from "../src/session-engine/harness/guards";

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

	it("records redirect and block actions without tool arguments", async () => {
		const handlers = new Map<string, (...args: any[]) => any>();
		const records: Array<Record<string, unknown>> = [];
		const pi = {
			on(name: string, handler: (...args: any[]) => any) {
				handlers.set(name, handler);
			},
			appendEntry: () => undefined,
		};
		const context = {
			sessionManager: {
				getSessionId: () => "session-1",
				getBranch: () => [],
			},
		};
		const extension = makeHarnessGuardExtension({
			recordUnit: (sessionId, unit, action) => records.push({ sessionId, unit, action }),
		});
		(await (extension as any).factory(pi)) as unknown;
		const failure = {
			isError: true,
			toolName: "bash",
			input: { command: "private-tool-argument" },
			content: "exit 1",
		};
		for (let i = 0; i < 3; i++) await handlers.get("tool_result")?.(failure, context);
		await handlers.get("context")?.({ messages: [] }, context);
		for (let i = 0; i < 3; i++) await handlers.get("tool_result")?.(failure, context);
		await handlers.get("context")?.({ messages: [] }, context);
		await handlers.get("tool_call")?.({ toolName: "bash", input: failure.input }, context);
		await handlers.get("tool_call")?.({ toolName: "bash", input: failure.input }, context);
		expect(records).toEqual([
			{ sessionId: "session-1", unit: "guard", action: "redirect" },
			{ sessionId: "session-1", unit: "guard", action: "block" },
			{ sessionId: "session-1", unit: "guard", action: "blocked-call" },
			{ sessionId: "session-1", unit: "guard", action: "blocked-call" },
		]);
		expect(JSON.stringify(records)).not.toContain("private-tool-argument");
	});

	it("drops old-session failures after replacement instead of persisting through stale ctx", async () => {
		const handlers = new Map<string, (...args: any[]) => any>();
		const appendEntry = vi.fn();
		const pi = {
			on(name: string, handler: (...args: any[]) => any) {
				handlers.set(name, handler);
			},
			appendEntry,
		};
		const extension = makeHarnessGuardExtension();
		(await (extension as any).factory(pi)) as unknown;
		const oldContext = { sessionManager: { getSessionId: () => "old", getBranch: () => [] } };
		await handlers.get("session_start")?.({}, oldContext);
		await handlers.get("session_shutdown")?.({}, oldContext);
		await handlers.get("tool_result")?.({ isError: true, toolName: "bash", content: "exit 1" }, oldContext);
		expect(appendEntry).not.toHaveBeenCalled();
	});
});
