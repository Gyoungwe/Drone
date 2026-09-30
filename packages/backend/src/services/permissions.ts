import type {
	PermissionAuditTailEntry,
	PermissionProbeInput,
	PermissionProbeResult,
	PermissionSettingsSaveInput,
	PermissionSettingsSaveResult,
	PermissionSettingsSnapshot,
} from "@drone/shared";
import {
	loadPermissionConfig,
	probePermission,
	readPermissionAuditTail,
	readPermissionSettings,
	resetPermissionSettings,
	writePermissionSettings,
} from "../permissions";
import { getAgentDir } from "../session-engine/sdk";

/**
 * Permission settings domain service.
 *
 * The service owns the durable permissions.json boundary used by the settings
 * panel.  Host adapters can consume this object through BackendServices rather
 * than reaching through PiBackend; the façade methods remain as compatibility
 * delegates while the rest of the backend is migrated.
 */
export class PermissionSettingsService {
	constructor(private readonly agentDir: string = getAgentDir()) {}

	/** Whether the built-in permission extension is enabled in permissions.json. */
	getConfig(): { enabled: boolean } {
		return { enabled: loadPermissionConfig(this.agentDir).enabled };
	}

	/** Current file, parsed effective settings and optimistic-concurrency metadata. */
	getSettings(): PermissionSettingsSnapshot {
		return readPermissionSettings(this.agentDir);
	}

	/** Validate and atomically persist settings, preserving the hidden enabled flag. */
	saveSettings(input: PermissionSettingsSaveInput): PermissionSettingsSaveResult {
		return writePermissionSettings(this.agentDir, input);
	}

	/** Restore the user-visible defaults while preserving the hidden enabled flag. */
	resetSettings(): PermissionSettingsSnapshot {
		return resetPermissionSettings(this.agentDir);
	}

	/** Evaluate a tool call against the configured rules without executing it. */
	probe(input: PermissionProbeInput): PermissionProbeResult {
		return probePermission(this.agentDir, input);
	}

	/** Read the newest high-risk audit entries, newest first. */
	getAuditTail(limit?: number): PermissionAuditTailEntry[] {
		return readPermissionAuditTail(this.agentDir, limit);
	}
}
