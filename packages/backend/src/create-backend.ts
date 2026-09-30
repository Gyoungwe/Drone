import { PiBackend, type PiBackendOptions } from "./pi-backend";

/**
 * Transitional composition root for the v2 migration.
 *
 * The existing PiBackend remains the compatibility façade while callers move
 * to explicit service groups. Keeping construction here gives desktop, LAN
 * and future CLI hosts one place to assemble the runtime and makes the final
 * façade removal an internal change.
 */
export interface BackendServices {
	/** Session lifecycle and compatibility methods during A3 migration. */
	sessions: PiBackend;
	/** Domain-owned services exposed without reaching into the façade. */
	knowledge: PiBackend["knowledge"];
	settings: PiBackend["settings"];
	login: PiBackend["login"];
	mcp: PiBackend["mcp"];
	dispose(): void;
}

export function createBackend(options: PiBackendOptions = {}): BackendServices {
	const sessions = new PiBackend(options);
	return {
		sessions,
		knowledge: sessions.knowledge,
		settings: sessions.settings,
		login: sessions.login,
		mcp: sessions.mcp,
		dispose: () => sessions.dispose(),
	};
}
