import type { PluginRuntimeScope } from "@gyoungwe/plugin-api/runtime";
import { canonicalProjectId } from "../project-id";
import type { SessionRegistry } from "../session/registry";
import type { PluginRuntimeCaller } from "./runtime";

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
