import type {
	ArtifactEntry,
	ArtifactManifest,
	ArtifactManifestEntry,
	ArtifactRecord,
	ArtifactValidationResult,
	ArtifactVerification,
} from "./types";

export interface ArtifactValidationOptions {
	readonly observed?: readonly ArtifactRecord[];
	readonly maxTotalBytes?: number;
	readonly expected?: readonly ArtifactManifestEntry[];
}

/** Reject absolute paths, traversal, empty components and symlink-like paths. */
export function isSafeArtifactPath(path: string): boolean {
	if (!path || path.includes("\u0000") || path.startsWith("~")) return false;
	if (path.startsWith("/") || path.startsWith("\\") || /^[A-Za-z]:[\\/]/.test(path)) return false;
	const parts = path.replaceAll("\\", "/").split("/");
	return parts.every((part) => part.length > 0 && part !== "." && part !== "..");
}

function validSha256(value: string): boolean {
	return /^[a-fA-F0-9]{64}$/.test(value);
}

function bytesOf(entry: ArtifactEntry | ArtifactManifestEntry): number {
	return entry.bytes ?? ("size" in entry ? (entry.size ?? 0) : 0);
}

/**
 * Validate a runner collect manifest before files are exposed locally.
 * The returned array carries richer validation fields as own properties, so
 * old callers can use `.every(v => v.ok)` while newer callers inspect the
 * `{valid, errors, entries, totalBytes}` projection.
 */
export function validateArtifactManifest(
	manifest: ArtifactManifest | readonly ArtifactManifestEntry[],
	options: ArtifactValidationOptions = {},
): ArtifactValidationResult & ArtifactVerification[] {
	const source: readonly ArtifactManifestEntry[] = Array.isArray(manifest)
		? (manifest as readonly ArtifactManifestEntry[])
		: (manifest as ArtifactManifest).entries;
	const entries: readonly ArtifactManifestEntry[] = source.map((entry) => ({
		path: entry.path,
		bytes: entry.bytes ?? ("size" in entry && typeof entry.size === "number" ? entry.size : undefined),
		sha256: entry.sha256,
		symlink: entry.symlink,
	}));
	const errors: string[] = [];
	const records: ArtifactRecord[] = [];
	const verifications: ArtifactVerification[] = [];
	let totalBytes = 0;
	const expected = options.expected ?? entries;
	const expectedByPath = new Map(expected.map((entry) => [entry.path.replaceAll("\\", "/"), entry]));

	for (const entry of entries) {
		const normalizedPath = entry.path.replaceAll("\\", "/");
		const bytes = bytesOf(entry);
		totalBytes += bytes;
		let reason: ArtifactVerification["reason"] | undefined;
		if (!isSafeArtifactPath(entry.path)) {
			reason = "invalid-path";
			errors.push(`Unsafe artifact path: ${entry.path}`);
		}
		if (entry.symlink) {
			reason = "invalid-path";
			errors.push(`Symlink artifact is not allowed: ${entry.path}`);
		}
		if (!Number.isSafeInteger(bytes) || bytes < 0) {
			reason = "size-mismatch";
			errors.push(`Invalid artifact size: ${entry.path}`);
		}
		if (entry.sha256 === undefined) {
			reason = "checksum-mismatch";
			errors.push(`Missing sha256: ${entry.path}`);
		} else if (!validSha256(entry.sha256)) {
			reason = "checksum-mismatch";
			errors.push(`Invalid sha256: ${entry.path}`);
		}
		const expectedEntry = expectedByPath.get(normalizedPath);
		if (expectedEntry?.bytes !== undefined && bytes > expectedEntry.bytes)
			errors.push(`Artifact exceeds expected size: ${entry.path}`);
		verifications.push({
			path: entry.path,
			expectedSha256: entry.sha256 ?? "",
			ok: !reason,
			...(reason ? { reason } : {}),
		});
	}

	if (options.maxTotalBytes !== undefined && totalBytes > options.maxTotalBytes) {
		errors.push(`Artifacts exceed ${options.maxTotalBytes} bytes`);
	}

	if (options.observed) {
		const observedByPath = new Map(options.observed.map((item) => [item.path.replaceAll("\\", "/"), item]));
		for (const expectedEntry of expected) {
			const path = expectedEntry.path.replaceAll("\\", "/");
			const observed = observedByPath.get(path);
			if (!observed) {
				errors.push(`Missing artifact: ${expectedEntry.path}`);
				continue;
			}
			if (observed.symlink || !isSafeArtifactPath(observed.path))
				errors.push(`Unsafe artifact path: ${observed.path}`);
			if (!Number.isSafeInteger(observed.bytes) || observed.bytes < 0)
				errors.push(`Invalid artifact size: ${observed.path}`);
			if (!validSha256(observed.sha256)) errors.push(`Invalid sha256: ${observed.path}`);
			if (expectedEntry.bytes !== undefined && observed.bytes !== expectedEntry.bytes)
				errors.push(`Artifact size mismatch: ${expectedEntry.path}`);
			if (expectedEntry.sha256 && observed.sha256.toLowerCase() !== expectedEntry.sha256.toLowerCase())
				errors.push(`Artifact checksum mismatch: ${expectedEntry.path}`);
			records.push({ ...observed, path });
		}
		for (const observed of options.observed) {
			if (!expectedByPath.has(observed.path.replaceAll("\\", "/")))
				errors.push(`Unexpected artifact: ${observed.path}`);
		}
	} else {
		for (const entry of entries) {
			if (entry.sha256 !== undefined && validSha256(entry.sha256))
				records.push({
					path: entry.path,
					bytes: bytesOf(entry),
					sha256: entry.sha256,
					...(entry.symlink ? { symlink: true } : {}),
				});
		}
	}

	const result = verifications as ArtifactValidationResult & ArtifactVerification[];
	Object.assign(result, { valid: errors.length === 0, errors, entries: records, totalBytes });
	return result;
}

export function artifactManifestBytes(manifest: ArtifactManifest): number {
	return manifest.entries.reduce((sum, entry) => sum + bytesOf(entry), 0);
}

export function withinArtifactLimit(manifest: ArtifactManifest, maxBytes: number): boolean {
	return Number.isFinite(maxBytes) && maxBytes >= 0 && artifactManifestBytes(manifest) <= maxBytes;
}

export function validateArtifactEntry(entry: ArtifactEntry): string | undefined {
	if (!isSafeArtifactPath(entry.path)) return "invalid-path";
	const bytes = bytesOf(entry);
	if (!Number.isSafeInteger(bytes) || bytes < 0) return "size-mismatch";
	if (entry.sha256 === undefined || !validSha256(entry.sha256)) return "checksum-mismatch";
	if (entry.symlink) return "invalid-path";
	return undefined;
}
