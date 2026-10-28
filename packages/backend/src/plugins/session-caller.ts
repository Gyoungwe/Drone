import type { PluginRuntimeScope } from "@gyoungwe/plugin-api/runtime";
import { canonicalProjectId } from "../project-id";
import type { SessionRegistry } from "../session/registry";
import type { PluginRuntimeCaller } from "./runtime";
import type { PluginCapabilityContext } from "./runtime-capabilities";

/** Main-process facts; never serialized into a renderer-selected identity. */
export interface PluginSessionCallerContext extends PluginRuntimeCaller {
	readonly scope: Extract<PluginRuntimeScope, { kind: "session" }>;
	readonly readOnly: boolean;
	readonly projectTrusted: boolean;
}

export function getPluginSessionCaller(
	registry: SessionRegistry,
	sessionId: string,
): PluginSessionCallerContext | undefined {
	const entry = registry.get(sessionId);
	if (!entry) return undefined;
	const signal = registry.signalFor(entry);
	if (signal.aborted) return undefined;
	return {
		identity: entry,
		sessionIdentity: entry,
		scope: {
			kind: "session",
			workspaceId: canonicalProjectId(entry.cwd),
			workspaceDirectory: entry.cwd,
			sessionId: entry.session.sessionId,
		},
		signal,
		readOnly: entry.readOnly === true,
		projectTrusted: entry.session.settingsManager.isProjectTrusted(),
	};
}

/** Resolve only the host's exact live entry, never a plugin-selected target. */
export function requirePluginSession(registry: SessionRegistry, context: PluginCapabilityContext) {
	context.signal.throwIfAborted();
	if (context.scope.kind !== "session") throw new Error("Plugin capability requires a selected live session");
	const entry = registry.get(context.scope.sessionId);
	if (!entry || entry !== context.sessionIdentity || registry.signalFor(entry).aborted)
		throw new Error("Plugin capability caller is stale or belongs to another session");
	return entry;
}
