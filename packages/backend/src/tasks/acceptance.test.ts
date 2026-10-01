import { describe, expect, it } from "vitest";
import { createDroneRuntime } from "../runtime";
import {
	ACCEPTANCE_VERIFIER_EVENT,
	ACCEPTANCE_VERIFIER_REQUEST_EVENT,
	bindAcceptanceVerifierEvents,
} from "./acceptance";

function eventBus() {
	const listeners = new Map<string, ((payload: unknown) => void)[]>();
	const emitted: { name: string; payload: unknown }[] = [];
	return {
		emitted,
		on(name: string, listener: (payload: unknown) => void) {
			listeners.set(name, [...(listeners.get(name) ?? []), listener]);
		},
		emit(name: string, payload?: unknown) {
			emitted.push({ name, payload });
			for (const listener of listeners.get(name) ?? []) listener(payload);
		},
	};
}

describe("acceptance verifier event bridge", () => {
	it("requests a replay and stores only version-one registrations in the runtime", async () => {
		const runtime = createDroneRuntime();
		const events = eventBus();
		bindAcceptanceVerifierEvents(events, runtime);

		expect(events.emitted[0]).toEqual({
			name: ACCEPTANCE_VERIFIER_REQUEST_EVENT,
			payload: { version: 1 },
		});
		events.emit(ACCEPTANCE_VERIFIER_EVENT, { version: 0, kind: "old", definition: {} });
		events.emit(ACCEPTANCE_VERIFIER_EVENT, {
			version: 1,
			kind: "wiki_review",
			definition: { evidenceKind: "wiki-applied" },
		});
		expect([...(runtime.tasks.acceptance?.verifiers?.entries() ?? [])]).toEqual([
			["wiki_review", { evidenceKind: "wiki-applied" }],
		]);
		await runtime.dispose();
	});
});
