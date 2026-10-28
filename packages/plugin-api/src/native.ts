import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { PluginRuntimeContext, PluginRuntimeSchema } from "./runtime.js";

/** Called only by the host for the current actual SDK event and its already-bound native attachment.
 * Event identity is private transport metadata, never an input-selected message or serialized proof.
 */
export interface PluginNativeOperation {
	readonly event: "message_start" | "tool_execution_end";
	readonly inputSchema: PluginRuntimeSchema;
	readonly resultSchema: PluginRuntimeSchema;
	readonly effect: "read" | "write";
	execute(input: unknown, event: unknown, context: PluginRuntimeContext): Promise<unknown>;
}

/** Official Pi registration owned by one real host session, sharing the application's domain owner. */
export interface PluginNativeSession {
	readonly extension: ExtensionFactory;
	/** Unknown tools require write approval. A read declaration cannot obtain a write capability. */
	readonly toolEffects?: Readonly<Record<string, "read" | "write">>;
	/** Explicit user commands use the same per-invocation capability policy; unknown effects require write approval. */
	readonly commandEffects?: Readonly<Record<string, "read" | "write">>;
	/** Session start is read-only; other hooks default to write unless declared here. */
	readonly eventEffects?: Readonly<Record<string, "read" | "write">>;
	/** Same-owner service callbacks for a host-proven native event; ordinary operations cannot invoke these. */
	readonly nativeOperations?: Readonly<Record<string, PluginNativeOperation>>;
	/** Projection executes where the plugin's live proof objects were created; JSON is not a proof. */
	readonly projection?: {
		/** Runs once after every official SDK hook and before public delivery or append. */
		finalize?(event: unknown, context: PluginRuntimeContext): unknown | Promise<unknown>;
		/** Unknown finalizers require write approval; pure projection itself grants no IO. */
		readonly finalizeEffect?: "read" | "write";
		event(event: unknown, signal?: AbortSignal): unknown | Promise<unknown>;
		snapshot(messages: unknown[], persisted: unknown[], signal?: AbortSignal): unknown[] | Promise<unknown[]>;
	};
	dispose(): Promise<void>;
}

/** Import this subpath only in native adapters that also depend on the official Pi SDK. */
export type PluginNativeRuntimeInstance = import("./runtime.js").PluginRuntimeInstance<PluginNativeSession>;
export type PluginNativeRuntimeFactory = import("./runtime.js").PluginRuntimeFactory<PluginNativeSession>;
