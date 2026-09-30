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
