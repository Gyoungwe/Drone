/** A redacted, metadata-only runtime diagnostics snapshot. */
export interface DiagnosticsStoreState {
	readonly id: string;
	readonly path: string;
	readonly owner: string;
	readonly schema: number | string;
	readonly sensitivity: "public" | "config" | "private" | "secret";
	readonly status: "missing" | "ok" | "unreadable";
	readonly bytes?: number;
	readonly modifiedAt?: number;
}

export interface DiagnosticsSnapshot {
	readonly version: string;
	readonly platform: string;
	readonly node: string;
	readonly generatedAt: string;
	readonly stores: DiagnosticsStoreState[];
	readonly incidentSnapshot?: unknown;
	readonly logTail?: string[];
}

/**
 * The portable JSON fallback used by the About page when a native archive
 * writer is unavailable.  The wrapper gives support tooling a stable marker
 * without changing the existing app:getDiagnostics response shape.
 */
export interface DiagnosticsPackage {
	readonly format: "drone-diagnostics";
	readonly schema: 1;
	readonly snapshot: DiagnosticsSnapshot;
}

export function serializeDiagnosticsPackage(snapshot: DiagnosticsSnapshot): string {
	const pkg: DiagnosticsPackage = { format: "drone-diagnostics", schema: 1, snapshot };
	return JSON.stringify(pkg, null, 2);
}
