import type { DiagnosticsSnapshot } from "@drone/shared";
import type { DiagnosticsOptions } from "../diagnostics";
import { buildDiagnostics } from "../diagnostics";
import type { StorageRegistry } from "../storage/registry";
import type { SessionHost } from "./session-host";
export class SessionApiDiagnostics {
	protected host!: SessionHost;
	bindHost(host: SessionHost): void {
		this.host = host;
	}

	/** Return redacted runtime/storage metadata without reading secrets or session bodies. */
	async getDiagnostics(options: DiagnosticsOptions = {}): Promise<DiagnosticsSnapshot> {
		return buildDiagnostics(this.host.storage, {
			version: options.version ?? "unknown",
			incidentSnapshot: options.incidentSnapshot,
			logTail: options.logTail,
		});
	}

	/** Expose the metadata-only inventory to composition-root services. */
	getStorageRegistry(): StorageRegistry {
		return this.host.storage;
	}
}
