import type { DiagnosticsSnapshot } from "@drone/shared";
import { diagnosticText } from "@drone/tasks";
import type { StorageRegistry } from "./storage/registry";

export type { DiagnosticsSnapshot } from "@drone/shared";

const SECRET_KEY_PATTERN =
	/(api[_-]?key|token|secret|password|authorization)\s*[:=]\s*(?:Bearer\s+)?[^\s,;]+/gi;
const SECRET_PEM_PATTERN = /-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const SENSITIVE_PATH_PATTERN =
	/\b(path|filePath|cwd|directory|dir|root)\s*[:=]\s*["']?(?:~\/|\/|[A-Za-z]:[\\/])[^"'\s,;]*/gi;
const SENSITIVE_FIELD_PATTERN =
	/^(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|authorization|credential|private[_-]?key|vault|session(?:[_-]?(?:body|content|messages?))?|transcript|conversation|prompt|response|message|content|body|input|output)$/i;
const PATH_FIELD_PATTERN = /^(?:path|filePath|cwd|directory|dir|root)$/i;
const MAX_DIAGNOSTIC_DEPTH = 6;
const MAX_DIAGNOSTIC_ITEMS = 64;
const MAX_DIAGNOSTIC_STRING = 2048;

export function redactDiagnosticText(value: string): string {
	return diagnosticText(value, 8192)
		.replace(SECRET_KEY_PATTERN, (_match, key: string) => `${key}=[REDACTED]`)
		.replace(BEARER_PATTERN, "Bearer [REDACTED]")
		.replace(SENSITIVE_PATH_PATTERN, (_match, key: string) => `${key}=<redacted-path>`)
		.replace(SECRET_PEM_PATTERN, "[REDACTED PEM]");
}

/** Keep paths useful for diagnostics without leaking a user's home directory. */
function redactDiagnosticPath(value: string): string {
	const normalized = value.replaceAll("\\", "/");
	if (!normalized.startsWith("/") && !normalized.startsWith("~/") && !/^[A-Za-z]:\//.test(normalized)) {
		return normalized;
	}
	const basename = normalized.split("/").filter(Boolean).at(-1);
	return basename ? `<redacted>/${basename}` : "<redacted>";
}

function sanitizeDiagnosticValue(
	value: unknown,
	key?: string,
	depth = 0,
	seen = new WeakSet<object>(),
): unknown {
	if (key && SENSITIVE_FIELD_PATTERN.test(key)) return undefined;
	if (typeof value === "string") {
		const text = redactDiagnosticText(value);
		return text.length > MAX_DIAGNOSTIC_STRING ? `${text.slice(0, MAX_DIAGNOSTIC_STRING)}…` : text;
	}
	if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
	if (value === undefined || depth >= MAX_DIAGNOSTIC_DEPTH) return undefined;
	if (Array.isArray(value)) {
		return value
			.slice(0, MAX_DIAGNOSTIC_ITEMS)
			.map((item) => sanitizeDiagnosticValue(item, undefined, depth + 1, seen))
			.filter((item) => item !== undefined);
	}
	if (typeof value !== "object") return undefined;
	if (seen.has(value)) return "[CIRCULAR]";
	seen.add(value);
	const result: Record<string, unknown> = {};
	for (const [childKey, childValue] of Object.entries(value).slice(0, MAX_DIAGNOSTIC_ITEMS)) {
		if (SENSITIVE_FIELD_PATTERN.test(childKey)) continue;
		const sanitized = PATH_FIELD_PATTERN.test(childKey)
			? typeof childValue === "string"
				? redactDiagnosticPath(childValue)
				: undefined
			: sanitizeDiagnosticValue(childValue, childKey, depth + 1, seen);
		if (sanitized !== undefined) result[childKey] = sanitized;
	}
	return result;
}

function sanitizeStorePath(path: string): string {
	return redactDiagnosticPath(path);
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
		stores: (await registry.inspect()).map((store) => ({
			...store,
			path: sanitizeStorePath(store.path),
		})),
		incidentSnapshot: sanitizeDiagnosticValue(options.incidentSnapshot),
		logTail: options.logTail?.map(redactDiagnosticText),
	};
}
