import { describe, expect, it } from "vitest";
import { HostEventBridge } from "./host-event-bridge";
import { PluginCapabilityBroker } from "./runtime-capabilities";
import { createRuntimeFactoryContext } from "./runtime-factory-context";

const capabilities = new PluginCapabilityBroker({ resources: [], handlers: {} });

describe("createRuntimeFactoryContext", () => {
	it("omits hostEvents when no approved port was supplied", () => {
		const context = createRuntimeFactoryContext(
			"app",
			new AbortController(),
			{ resources: [], handlers: {} },
			capabilities,
			{ changed: () => undefined },
		);

		expect("hostEvents" in context).toBe(false);
	});

	it("passes the approved host event source through unchanged", () => {
		const source = new HostEventBridge().source(["inquiry.compute"], new AbortController().signal);
		const context = createRuntimeFactoryContext(
			"app",
			new AbortController(),
			{ resources: [], handlers: {}, hostEvents: source },
			capabilities,
			{ changed: () => undefined },
		);

		expect(context.hostEvents).toBe(source);
	});
});
