import { Type } from "typebox";
import { endpointPolicyError, type PluginEndpointAccess } from "./endpoint-policy";
import type { PluginCapabilityHandler } from "./runtime-capabilities";

/** Registered only by the composition boundary for an eligible source. */
export function endpointConfigCapabilityHandlers(
	readPolicy: () => PluginEndpointAccess,
): Record<"config.endpoint", PluginCapabilityHandler> {
	return {
		"config.endpoint": {
			effect: "read",
			inputSchema: Type.Object(
				{ slot: Type.String({ minLength: 1, maxLength: 64 }) },
				{ additionalProperties: false },
			),
			resultSchema: Type.Union([
				Type.Object(
					{
						state: Type.Literal("ready"),
						endpoint: Type.String({ maxLength: 4096, pattern: "^https?://" }),
						source: Type.Union([Type.Literal("default"), Type.Literal("env")]),
					},
					{ additionalProperties: false },
				),
				Type.Object(
					{
						state: Type.Literal("invalid"),
						endpoint: Type.Null(),
						source: Type.Literal("env"),
						reason: Type.Literal("invalid_endpoint"),
					},
					{ additionalProperties: false },
				),
			]),
			execute: async (raw) => {
				const { slot } = raw as { slot: string };
				const { configuration } = readPolicy().policy;
				// The policy names the slot it governs; a slot it does not name is not addressable.
				if (!configuration || configuration.slot !== slot) throw endpointPolicyError("EPLUGINENDPOINTSLOT");
				// The slot is host bookkeeping; the plugin API's result has never carried it.
				const { slot: _governed, ...result } = configuration;
				return result;
			},
		},
	};
}
