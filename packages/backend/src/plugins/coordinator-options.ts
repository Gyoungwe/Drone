import type { AskQuestionRoute } from "../session/ask-gate";
import type { PluginRuntimeOwner } from "./coordinator";
import type { SelectedNativeSource } from "./native-delivery";
import type { HostNativeRuntimeFactory } from "./p5-owner-facade";
import type { PluginRuntimeSource } from "./plugin-source";
import type {
	PluginRuntimeCapabilitiesOptions,
	PluginRuntimeCapabilitiesProvider,
} from "./runtime-capabilities";
import type { PluginSessionCallerContext } from "./session-caller";
import type { TaskGrantStore } from "./task-grants";

export interface PluginRuntimeBridgeOptions {
	classifySelectedPath?(path: string): SelectedNativeSource;
	questionTransport?(owner: PluginRuntimeOwner): AskQuestionRoute;
	source(name: string): PluginRuntimeSource | undefined;
	sources?(): readonly {
		readonly name: string;
		readonly source: PluginRuntimeSource;
		readonly state: "enabled" | "unavailable" | "disabled";
	}[];
	requiredSources?(): readonly {
		readonly source: PluginRuntimeSource;
		readonly state: "enabled" | "unavailable" | "disabled";
	}[];
	enabled(name: string): boolean;
	factory(source: PluginRuntimeSource): HostNativeRuntimeFactory;
	capabilities?(
		source: PluginRuntimeSource,
		owner: PluginRuntimeOwner,
	): PluginRuntimeCapabilitiesOptions | PluginRuntimeCapabilitiesProvider;
	approve(
		owner: PluginRuntimeOwner,
		source: PluginRuntimeSource,
		operation?: string,
		detail?: string,
		signal?: AbortSignal,
	): Promise<boolean>;
	getSessionContext(sessionId: string): PluginSessionCallerContext | undefined;
	/** Host task grants; a current grant for this plugin source covers its ordinary writes. */
	taskGrants?: TaskGrantStore;
}
