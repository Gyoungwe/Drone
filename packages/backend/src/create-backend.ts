import type { DroneRuntime } from "@drone/shared";
import type { KnowledgeUiService } from "./knowledge/ui";
import type { McpService } from "./mcp/service";
import { PiBackend, type PiBackendOptions } from "./pi-backend";
import { createDroneRuntime } from "./runtime";
import type { PackageService } from "./services/packages";
import type { LoginService } from "./settings/login";
import type { ModelSettingsService } from "./settings/models";
import type { SettingsService } from "./settings/settings";

/**
 * Transitional composition root for the v2 migration.
 *
 * The existing PiBackend remains the compatibility façade while callers move
 * to explicit service groups. Keeping construction here gives desktop, LAN
 * and future CLI hosts one place to assemble the runtime and makes the final
 * façade removal an internal change.
 */
export interface BackendServices {
	/** Per-host runtime container; extension bridges must not use process globals. */
	runtime: DroneRuntime;
	/** Session lifecycle and compatibility methods during A3 migration. */
	sessions: PiBackend;
	/** Domain-owned knowledge service; consumers do not need the compatibility façade. */
	knowledge: KnowledgeUiService;
	/** Community package catalog and package-manager operations. */
	packages: PackageService;
	/** Provider and credential settings service. */
	settings: SettingsService;
	/** User-level model visibility and subagent preferences. */
	models: ModelSettingsService;
	/** Interactive provider login service. */
	login: LoginService;
	/** MCP configuration and status service. */
	mcp: McpService;
	dispose(): void;
}

export function createBackend(options: PiBackendOptions = {}): BackendServices {
	const runtime = createDroneRuntime();
	const sessions = new PiBackend({ ...options, runtime });
	return {
		runtime,
		sessions,
		knowledge: sessions.knowledge,
		packages: sessions.packages,
		settings: sessions.settings,
		models: sessions.models,
		login: sessions.login,
		mcp: sessions.mcp,
		dispose: () => {
			sessions.dispose();
			void runtime.dispose();
		},
	};
}
