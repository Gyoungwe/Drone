import type { PluginRuntimeCapabilities } from "./runtime.js";

export interface PluginEndpointConfigurationInput {
	readonly slot: string;
}

export type PluginEndpointConfigurationResult =
	| {
			readonly state: "ready";
			readonly endpoint: string;
			readonly source: "default" | "env";
	  }
	| {
			readonly state: "invalid";
			readonly endpoint: null;
			readonly source: "env";
			readonly reason: "invalid_endpoint";
	  };

export async function readPluginEndpointConfiguration(
	capabilities: PluginRuntimeCapabilities,
	input: PluginEndpointConfigurationInput,
	signal?: AbortSignal,
): Promise<PluginEndpointConfigurationResult> {
	return (await capabilities.call("config.endpoint", input, signal)) as PluginEndpointConfigurationResult;
}
