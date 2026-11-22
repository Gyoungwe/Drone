import type { SessionServicePort } from "@drone/backend";
import {
	createP5HostComposition,
	type P5ActiveFactOwner,
	type P5AdoptionAuthority,
	type PluginSessionCallerContext,
} from "@drone/backend";
import { app } from "electron";

/**
 * Z2 — the desktop's P5 host composition.
 *
 * The backend composition (`services/p5-host-composition.ts`) knows what a
 * P5 port needs; this module knows what the *desktop host* has to answer
 * with.  It is the only place that turns the desktop's session registry into
 * the authority the fact delivery asks for on every batch.
 *
 * The authority question is "does the effective S still cover this owner?".
 * The desktop's answer is the session's own state: the session must still
 * exist, the project must still be trusted, and the session must not have
 * become read-only.  A session that closed, lost trust or turned read-only
 * stops the delivery — and because the delivery re-asks before every batch,
 * the answer is re-evaluated, not latched at attachment time.
 */

export interface DesktopP5CompositionOptions {
	readonly sessions: Pick<SessionServicePort, "getPluginCallerContext" | "getStorageRegistry">;
}

/**
 * The host's authority over a fact owner.
 *
 * The attachment's `signal` is the binding's own abort signal: the
 * coordinator aborts it when the binding stops, so an aborted attachment is
 * never authorized even if the session happens to still be open.
 */
export function createDesktopP5Authority(
	sessions: Pick<SessionServicePort, "getPluginCallerContext">,
): P5AdoptionAuthority {
	return {
		async authorize(attachment: P5ActiveFactOwner): Promise<boolean> {
			if (attachment.signal.aborted) return false;
			const context = sessions.getPluginCallerContext(attachment.sessionId);
			if (!context) return false;
			return isWritableSession(context);
		},
	};
}

/**
 * Whether a session may still receive host-owned writes.
 *
 * The three conditions are the host's own rules for a write-capable
 * session, read from the same place the coordinator reads them: the project
 * must be trusted, the session must not be read-only, and the caller context
 * must still be live.
 */
function isWritableSession(context: PluginSessionCallerContext): boolean {
	if (!context.projectTrusted) return false;
	if (context.readOnly) return false;
	return !context.signal.aborted;
}

/**
 * Builds the desktop's P5 composition and hands back the port the
 * coordinator binds a native fact owner through.
 */
export function createDesktopP5Composition(options: DesktopP5CompositionOptions) {
	return createP5HostComposition(
		{
			userDataDir: app.getPath("userData"),
			storageRegistry: options.sessions.getStorageRegistry(),
		},
		createDesktopP5Authority(options.sessions),
	);
}
