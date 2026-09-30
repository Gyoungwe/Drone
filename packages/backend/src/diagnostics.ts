import type { StorageRegistry, StorageState } from "./storage/registry";

export interface DiagnosticsSnapshot {
	readonly version: string;
	readonly platform: NodeJS.Platform;
	readonly node: string;
	readonly generatedAt: string;
	readonly stores: StorageState[];
	readonly incidentSnapshot?: unknown;
	readonly logTail?: string[];
}

const SECRET_PATTERNS = [
	/(api[_-]?key|token|secret|password|authorization)\s*[:=]\s*[^\s,;]+/gi,
	/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g,
];

export function redactDiagnosticText(value: string): string {
	return SECRET_PATTERNS.reduce((text, pattern) => text.replace(pattern, "$1=[REDACTED]"), value);
}

/** Build a diagnostics payload without reading credentials, Vault contents or session bodies. */
export async function buildDiagnostics(
	registry: StorageRegistry,
	options: { version: string; incidentSnapshot?: unknown; logTail?: readonly string[] },
): Promise<DiagnosticsSnapshot> {
	return {
		version: options.version,
		platform: process.platform,
		node: process.version,
		generatedAt: new Date().toISOString(),
		stores: await registry.inspect(),
		incidentSnapshot: options.incidentSnapshot,
		logTail: options.logTail?.map(redactDiagnosticText),
	};
}
