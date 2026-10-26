import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";

/** Official Pi registration owned by one real host session, sharing the application's domain owner. */
export interface PluginNativeSession {
	readonly extension: ExtensionFactory;
	/** Unknown tools require write approval. A read declaration cannot obtain a write capability. */
	readonly toolEffects?: Readonly<Record<string, "read" | "write">>;
	/** Session start is read-only; other hooks default to write unless declared here. */
	readonly eventEffects?: Readonly<Record<string, "read" | "write">>;
	/** Projection executes where the plugin's live proof objects were created; JSON is not a proof. */
	readonly projection?: {
		event(event: unknown): unknown | Promise<unknown>;
		snapshot(messages: unknown[], persisted: unknown[]): unknown[] | Promise<unknown[]>;
	};
	dispose(): Promise<void>;
}

/** Import this subpath only in native adapters that also depend on the official Pi SDK. */
export type PluginNativeRuntimeInstance = import("./runtime.js").PluginRuntimeInstance<PluginNativeSession>;
export type PluginNativeRuntimeFactory = import("./runtime.js").PluginRuntimeFactory<PluginNativeSession>;
