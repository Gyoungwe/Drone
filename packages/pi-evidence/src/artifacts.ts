import { digestJson, isSha256, sha256Hex } from "./digest";

export const EVIDENCE_CAPSULE_LIMIT = 64 * 1024 * 1024;

export type EvidenceArtifactRole = "input" | "output" | "code" | "environment" | "review";
export type EvidenceAccessLevel = "public" | "restricted" | "private";

/** A content-addressed artifact revision. The path is only a portable label. */
export interface EvidenceArtifact {
	readonly artifactId: string;
	readonly versionId: string;
	readonly path: string;
	readonly sha256: string;
	readonly bytes: number;
	readonly role: EvidenceArtifactRole;
	readonly accessLevel?: EvidenceAccessLevel;
	readonly parentVersionIds: readonly string[];
	readonly producedByJobId?: string;
}

export interface EvidenceArtifactManifest {
	readonly version: 1;
	readonly entries: readonly EvidenceArtifact[];
	readonly totalBytes?: number;
}

/** Compatibility names used by the host evidence service during migration. */
export type ArtifactManifest = EvidenceArtifactManifest;
export type ArtifactRecord = EvidenceArtifact;

export interface ArtifactManifestInputEntry {
	readonly artifactId?: string;
	readonly versionId?: string;
	readonly path: string;
	readonly sha256?: string;
	readonly bytes?: number;
	readonly size?: number;
	readonly role?: EvidenceArtifactRole;
	readonly accessLevel?: EvidenceAccessLevel;
	readonly parentVersionIds?: readonly string[];
	readonly producedByJobId?: string;
	readonly symlink?: boolean;
}

export interface ArtifactVerification {
	readonly path: string;
	readonly expectedSha256: string;
	readonly actualSha256?: string;
	readonly ok: boolean;
	readonly reason?: "invalid-path" | "size-mismatch" | "checksum-mismatch" | "private-path";
}

export interface ArtifactManifestValidation {
	readonly valid: boolean;
	readonly errors: readonly string[];
	readonly entries: readonly EvidenceArtifact[];
	readonly totalBytes: number;
}

export interface ArtifactManifestValidationOptions {
	readonly maxTotalBytes?: number;
	readonly expected?: readonly ArtifactManifestInputEntry[];
	readonly requireIdentity?: boolean;
}

const PRIVATE_PATH_PART =
	/^(?:\.env(?:\.|$)|auth\.json$|credentials?(?:\.|$)|secrets?(?:\.|$)|tokens?(?:\.|$)|password(?:\.|$)|\.ssh$|\.git$|\.pi$|\.drone$|userData$|sessions?$)/iu;

/** Paths in a manifest are relative, slash-separated labels and never host paths. */
export function isSafeEvidencePath(path: unknown): boolean {
	if (typeof path !== "string" || !path || path.includes("\u0000") || path.includes("\\")) return false;
	if (path.startsWith("/") || path.startsWith("~") || /^[A-Za-z]:/.test(path)) return false;
	const parts = path.split("/");
	return parts.every(
		(part) => part.length > 0 && part !== "." && part !== ".." && !PRIVATE_PATH_PART.test(part),
	);
}

export function isSafeBranchId(value: unknown): value is string {
	return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,100}$/.test(value);
}

function bytesOf(entry: ArtifactManifestInputEntry): number {
	return entry.bytes ?? entry.size ?? 0;
}

function normalizeEntry(entry: ArtifactManifestInputEntry): EvidenceArtifact {
	return {
		artifactId: entry.artifactId ?? "",
		versionId: entry.versionId ?? "",
		path: entry.path,
		sha256: entry.sha256 ?? "",
		bytes: bytesOf(entry),
		role: entry.role ?? "output",
		...(entry.accessLevel ? { accessLevel: entry.accessLevel } : {}),
		parentVersionIds: [...(entry.parentVersionIds ?? [])],
		...(entry.producedByJobId ? { producedByJobId: entry.producedByJobId } : {}),
	};
}

function sourceEntries(
	manifest: EvidenceArtifactManifest | readonly ArtifactManifestInputEntry[],
): readonly ArtifactManifestInputEntry[] {
	if (Array.isArray(manifest)) return manifest as readonly ArtifactManifestInputEntry[];
	return (manifest as EvidenceArtifactManifest).entries;
}

/** Validate a manifest before a host reads or exposes any corresponding bytes. */
export function validateArtifactManifest(
	manifest: EvidenceArtifactManifest | readonly ArtifactManifestInputEntry[],
	options: ArtifactManifestValidationOptions = {},
): ArtifactManifestValidation & readonly ArtifactVerification[] {
	const source = sourceEntries(manifest);
	const errors: string[] = [];
	const objectManifest = Array.isArray(manifest) ? undefined : (manifest as EvidenceArtifactManifest);
	if (objectManifest && objectManifest.version !== 1) errors.push("Unsupported artifact manifest version");
	const entries = source.map(normalizeEntry);
	const verifications: ArtifactVerification[] = [];
	const paths = new Set<string>();
	const versions = new Set<string>();
	const expectedByPath = new Map((options.expected ?? source).map((entry) => [entry.path, entry]));
	let totalBytes = 0;

	for (const entry of entries) {
		const path = entry.path;
		const pathKey = path.toLocaleLowerCase("en-US");
		const bytes = entry.bytes;
		totalBytes += Number.isFinite(bytes) ? bytes : 0;
		let reason: ArtifactVerification["reason"] | undefined;
		if (!isSafeEvidencePath(path)) {
			reason =
				path.startsWith("/") || path.startsWith("~") || /^[A-Za-z]:/.test(path)
					? "private-path"
					: "invalid-path";
			errors.push(`Unsafe evidence path: ${path}`);
		}
		if (
			paths.has(pathKey) ||
			[...paths].some((known) => known.startsWith(`${pathKey}/`) || pathKey.startsWith(`${known}/`))
		) {
			reason = "invalid-path";
			errors.push(`Duplicate or conflicting evidence path: ${path}`);
		}
		paths.add(pathKey);
		if (options.requireIdentity && (!entry.artifactId || !entry.versionId || versions.has(entry.versionId))) {
			errors.push(`Invalid or duplicate artifact identity: ${path}`);
		}
		versions.add(entry.versionId);
		if (!Number.isSafeInteger(bytes) || bytes < 0) {
			reason = "size-mismatch";
			errors.push(`Invalid artifact size: ${path}`);
		}
		if (!isSha256(entry.sha256)) {
			reason = "checksum-mismatch";
			errors.push(`Invalid sha256: ${path}`);
		}
		if (!Array.isArray(entry.parentVersionIds)) errors.push(`Invalid parent version list: ${path}`);
		if (!["input", "output", "code", "environment", "review"].includes(entry.role)) {
			errors.push(`Invalid artifact role: ${path}`);
		}
		const expected = expectedByPath.get(path);
		if (expected?.bytes !== undefined && bytes > expected.bytes)
			errors.push(`Artifact exceeds expected size: ${path}`);
		verifications.push({ path, expectedSha256: entry.sha256, ok: !reason, ...(reason ? { reason } : {}) });
	}
	if (options.maxTotalBytes !== undefined && totalBytes > options.maxTotalBytes)
		errors.push(`Artifacts exceed ${options.maxTotalBytes} bytes`);
	if (totalBytes > EVIDENCE_CAPSULE_LIMIT) errors.push("Evidence exceeds capsule limit");
	if (objectManifest && objectManifest.totalBytes !== undefined && objectManifest.totalBytes !== totalBytes)
		errors.push("Artifact manifest totalBytes mismatch");
	const result = verifications as unknown as ArtifactManifestValidation & readonly ArtifactVerification[];
	Object.assign(result, { valid: errors.length === 0, errors, entries, totalBytes });
	return result;
}

export function assertValidArtifactManifest(
	manifest: EvidenceArtifactManifest | readonly ArtifactManifestInputEntry[],
	options: ArtifactManifestValidationOptions = {},
): EvidenceArtifactManifest {
	const validation = validateArtifactManifest(manifest, {
		...options,
		requireIdentity: options.requireIdentity ?? true,
	});
	if (!validation.valid) throw new Error(`Invalid artifact manifest: ${validation.errors.join("; ")}`);
	const entries = [...validation.entries].sort((a, b) => a.path.localeCompare(b.path));
	const normalized: EvidenceArtifactManifest = { version: 1, entries, totalBytes: validation.totalBytes };
	return normalized;
}

export function artifactManifestDigest(manifest: EvidenceArtifactManifest): string {
	const normalized = assertValidArtifactManifest(manifest, { requireIdentity: false });
	return digestJson(normalized);
}

export const isSafeArtifactPath = isSafeEvidencePath;

export function artifactManifestBytes(manifest: EvidenceArtifactManifest): number {
	return manifest.entries.reduce((total, entry) => total + entry.bytes, 0);
}

export function withinArtifactLimit(manifest: EvidenceArtifactManifest, maxBytes: number): boolean {
	return Number.isFinite(maxBytes) && maxBytes >= 0 && artifactManifestBytes(manifest) <= maxBytes;
}

export function validateArtifactEntry(
	entry: ArtifactManifestInputEntry,
): ArtifactVerification["reason"] | undefined {
	const result = validateArtifactManifest([entry]);
	return result[0]?.ok ? undefined : (result[0]?.reason ?? "checksum-mismatch");
}

export function artifactDigest(bytes: string | Uint8Array): string {
	return sha256Hex(bytes);
}

export function artifactFromBytes(input: {
	readonly artifactId: string;
	readonly versionId: string;
	readonly path: string;
	readonly bytes: string | Uint8Array;
	readonly role: EvidenceArtifactRole;
	readonly accessLevel?: EvidenceAccessLevel;
	readonly parentVersionIds?: readonly string[];
	readonly producedByJobId?: string;
}): EvidenceArtifact {
	if (!input.artifactId || !input.versionId || !isSafeEvidencePath(input.path))
		throw new Error("Artifact identity or path is invalid");
	const bytes = typeof input.bytes === "string" ? new TextEncoder().encode(input.bytes) : input.bytes;
	return {
		artifactId: input.artifactId,
		versionId: input.versionId,
		path: input.path,
		sha256: artifactDigest(bytes),
		bytes: bytes.byteLength,
		role: input.role,
		...(input.accessLevel ? { accessLevel: input.accessLevel } : {}),
		parentVersionIds: [...(input.parentVersionIds ?? [])],
		...(input.producedByJobId ? { producedByJobId: input.producedByJobId } : {}),
	};
}
