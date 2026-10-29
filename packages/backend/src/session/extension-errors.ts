import { sanitizeProviderError } from "@drone/shared";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { createLogger } from "../log";
import type { SessionTraces } from "./traces";

const log = createLogger("backend");

/** Observe optional hook failures without changing the SDK's non-fatal event semantics. */
export function createSessionExtensionDiagnostics(
	session: AgentSession,
	traces: Pick<SessionTraces, "recordCustom">,
) {
	const onError: NonNullable<Parameters<AgentSession["bindExtensions"]>[0]["onError"]> = (failure) => {
		const diagnostic = {
			extensionPath: sanitizeProviderError(failure.extensionPath),
			event: failure.event,
			error: sanitizeProviderError(failure.error),
		};
		log.error("extension hook failed", session.sessionId, diagnostic);
		traces.recordCustom(session.sessionId, "extension_error", diagnostic);
	};
	return {
		onError,
		dispose() {
			// Pi 1.1.0 stores listeners in a Set but dispose() does not detach its
			// error binding. Remove this same listener from the current runner,
			// including after reload. Delete when SDK disposal owns this cleanup.
			session.extensionRunner?.onError(onError)();
		},
	};
}
