import assert from "node:assert/strict";
import test from "node:test";
import { createStandaloneRuntime, withRuntime } from "../runtime-bridge.mjs";
import {
	acceptanceVerifier,
	bindAcceptanceVerifierEvents,
	registerAcceptanceVerifier,
	resetAcceptanceVerifiers,
} from "./acceptance.mjs";

function eventBus() {
	const listeners = new Map();
	const emitted = [];
	return {
		emitted,
		on(name, listener) {
			listeners.set(name, [...(listeners.get(name) || []), listener]);
		},
		emit(name, payload) {
			emitted.push({ name, payload });
			for (const listener of listeners.get(name) || []) listener(payload);
		},
	};
}

test("acceptance registrations replay through versioned events into the host runtime", async () => {
	const events = eventBus();
	const pi = { events };
	bindAcceptanceVerifierEvents(pi);
	registerAcceptanceVerifier("bridge_kind", { fields: ["sampleId"] });
	events.emit("drone:acceptance-verifier/request/v1", { version: 1 });
	const registration = events.emitted.find((entry) => entry.name === "drone:acceptance-verifier/v1");
	assert.deepEqual(registration?.payload, {
		version: 1,
		kind: "bridge_kind",
		definition: {
			fields: ["sampleId"],
			evidenceKind: "bridge_kind-verified",
			operationVerifier: "bridge_kind-record-not-scientific-proof",
			label: registration?.payload?.definition?.label,
		},
	});
	assert.equal(typeof registration?.payload?.definition?.label, "function");

	const runtime = createStandaloneRuntime();
	events.emit("drone:runtime/v1", { version: 1, runtime });
	assert.deepEqual(await withRuntime(runtime, () => acceptanceVerifier("bridge_kind")?.fields), ["sampleId"]);
	await runtime.dispose();
	resetAcceptanceVerifiers();
});
