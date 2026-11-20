import { expect, it } from "vitest";
import { measuredEnvelopeBytes } from "./p5-byte-capabilities";
import { PluginCapabilityBroker } from "./runtime-capabilities";

it("does not take envelope measurements from the public capability port", async () => {
	const broker = new PluginCapabilityBroker({
		resources: [],
		handlers: {
			measure: {
				inputSchema: { type: "object" },
				resultSchema: { type: "number" },
				effect: "read",
				execute: async (_input, context) => measuredEnvelopeBytes(context),
			},
		},
	});
	const result = broker.run(
		{
			pluginId: "example",
			applicationId: "app",
			scope: { kind: "application" },
			callerIdentity: undefined,
			signal: new AbortController().signal,
			bootstrap: false,
		},
		"read",
		() => undefined,
		async () => true,
		() => Reflect.apply(broker.port.call, broker.port, ["measure", { envelopeBytes: 1 }, undefined, 1]),
	);
	await expect(result).rejects.toThrow("Plugin capability envelope was not measured");
});
