import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { ArtifactManifest } from "@drone/compute";
import { asRecord } from "./compute-job-state";

export { verifyArtifactChecksums };

/** Verify collection paths and sha256 before exposing artifacts to host readers. */
export function validateArtifactManifest(
	manifest: ArtifactManifest,
	targetDir: string,
	expected?: readonly string[],
	maxBytes = 500 * 1024 * 1024,
): void {
	const files = (asRecord(manifest).entries ?? []) as unknown;
	if (!Array.isArray(files)) throw new Error("Invalid artifact manifest");
	const expectedSet = expected ? new Set(expected) : undefined;
	const seen = new Set<string>();
	let totalBytes = 0;
	for (const item of files) {
		const record = asRecord(item);
		const path = record.path;
		if (typeof path !== "string" || !path || isAbsolute(path) || path.split(/[\\/]/).includes(".."))
			throw new Error("Artifact manifest contains an unsafe path");
		if (expectedSet && !expectedSet.has(path)) throw new Error(`Unexpected artifact: ${path}`);
		seen.add(path);
		const size = record.bytes ?? record.size;
		if (typeof size === "number" && Number.isFinite(size) && size >= 0) totalBytes += size;
		const target = resolve(targetDir, path);
		if (relative(targetDir, target).startsWith("..") || isAbsolute(relative(targetDir, target)))
			throw new Error("Artifact escapes target directory");
		const checksum = record.sha256 ?? record.checksum;
		if (typeof checksum !== "string" || !/^[a-f0-9]{64}$/i.test(checksum))
			throw new Error(`Invalid checksum for artifact: ${path}`);
	}
	for (const path of expectedSet ?? []) if (!seen.has(path)) throw new Error(`Missing artifact: ${path}`);
	if (totalBytes > maxBytes) throw new Error(`Artifacts exceed collection limit: ${maxBytes} bytes`);
}

async function verifyArtifactChecksums(manifest: ArtifactManifest, targetDir: string): Promise<void> {
	const files = (asRecord(manifest).entries ?? []) as unknown;
	if (!Array.isArray(files)) throw new Error("Invalid artifact manifest");
	for (const item of files) {
		const record = asRecord(item);
		const path = record.path;
		if (typeof path !== "string") continue;
		const expected = record.sha256 ?? record.checksum;
		if (expected === undefined) continue;
		const fullPath = resolve(targetDir, path);
		const info = await lstat(fullPath);
		if (info.isSymbolicLink() || !info.isFile()) throw new Error(`Artifact is not a regular file: ${path}`);
		const actual = artifactSha256(await readFile(fullPath));
		if (actual.toLowerCase() !== String(expected).toLowerCase())
			throw new Error(`Artifact checksum mismatch: ${path}`);
	}
}

export function artifactSha256(content: Uint8Array): string {
	return createHash("sha256").update(content).digest("hex");
}
