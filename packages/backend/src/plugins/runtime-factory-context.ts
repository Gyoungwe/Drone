import type { PluginRuntimeFactoryContext } from "@gyoungwe/plugin-api/runtime";
import type { PluginCapabilityBroker, PluginRuntimeCapabilitiesOptions } from "./runtime-capabilities";

export function createRuntimeFactoryContext(
	applicationId: string,
	abort: AbortController,
	ports: PluginRuntimeCapabilitiesOptions,
	capabilities: PluginCapabilityBroker,
	events: PluginRuntimeFactoryContext["events"],
): PluginRuntimeFactoryContext {
	return {
		applicationId,
		signal: abort.signal,
		resources: ports.resources,
		...(ports.hostEvents ? { hostEvents: ports.hostEvents } : {}),
		...(ports.resourcesLifecycle ? { resourcesLifecycle: ports.resourcesLifecycle } : {}),
		capabilities: capabilities.port,
		events,
	};
}
