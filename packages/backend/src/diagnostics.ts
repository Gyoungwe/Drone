import type { DiagnosticsSnapshot } from "@drone/shared";
import type { StorageRegistry } from "./storage/registry";

export type { DiagnosticsSnapshot } from "@drone/shared";

const SECRET_KEY_PATTERN = /(api[_-]?key|token|secret|password|authorization)\s*[:=]\s*[^\s,;]+/gi;
const SECRET_PEM_PATTERN = /-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g;

export function redactDiagnosticText(value: string): string {
	return value
		.replace(SECRET_KEY_PATTERN, (_match, key: string) => `${key}=[REDACTED]`)
		.replace(SECRET_PEM_PATTERN, "[REDACTED PEM]");
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
