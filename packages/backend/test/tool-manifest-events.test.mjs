import { describe, expect, it } from "vitest";
import {
	bindToolManifestEvents,
	globalToolManifest,
	TOOL_MANIFEST_EVENT,
	TOOL_MANIFEST_REQUEST_EVENT,
} from "../src/tools/manifest";
import { sourceArchive } from "./tool-manifest-fixture.mjs";

function eventBus() {
	const listeners = new Map();
	return {
		on(name, listener) {
			const current = listeners.get(name) || [];
			current.push(listener);
			listeners.set(name, current);
		},
		emit(name, payload) {
			for (const listener of listeners.get(name) || []) listener(payload);
		},
	};
}

function pi(events) {
	return { events, registerTool() {}, on() {} };
}

describe("tool manifest pi.events bridge", () => {
	it("publishes a versioned registration to the host collector", () => {
		const events = eventBus();
		const seen = [];
		events.on(TOOL_MANIFEST_EVENT, (payload) => seen.push(payload));
		bindToolManifestEvents(events);
		const name = "research_archive_source";
		sourceArchive(pi(events));

		expect(seen).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					version: 1,
					name,
					meta: expect.objectContaining({ capabilities: ["research"] }),
				}),
			]),
		);
		expect(globalToolManifest.meta(name)).toMatchObject({ capabilities: ["research"] });
	});

	it("replays declarations when the host collector is attached after extension load", () => {
		const events = eventBus();
		const name = "research_archive_source";
		sourceArchive(pi(events));

		const replayed = [];
		events.on(TOOL_MANIFEST_EVENT, (payload) => replayed.push(payload));
		bindToolManifestEvents(events);

		expect(replayed).toEqual(expect.arrayContaining([expect.objectContaining({ version: 1, name })]));
		expect(globalToolManifest.meta(name)).toMatchObject({ capabilities: ["research"] });
	});

	it("does not cross-talk between independent Pi event buses or accept old versions", () => {
		const first = eventBus();
		const second = eventBus();
		const secondEvents = [];
		second.on(TOOL_MANIFEST_EVENT, (payload) => secondEvents.push(payload));
		bindToolManifestEvents(first);
		bindToolManifestEvents(second);
		const name = "research_archive_source";
		sourceArchive(pi(first));
		second.emit(TOOL_MANIFEST_EVENT, { version: 2, name: `${name}_old`, meta: { readOnly: false } });

		expect(secondEvents).toEqual([{ version: 2, name: `${name}_old`, meta: { readOnly: false } }]);
		expect(globalToolManifest.meta(`${name}_old`)).toBeUndefined();
		expect(globalToolManifest.meta(name)).toMatchObject({ capabilities: ["research"] });
		expect(TOOL_MANIFEST_REQUEST_EVENT).toBe("drone:tool-manifest/request/v1");
	});
});
