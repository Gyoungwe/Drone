import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { ArtifactManifest } from "@drone/compute";
import type { AnalysisArtifactEvidence } from "./analysis-adapters";

export interface VerifiedAnalysisArtifact extends AnalysisArtifactEvidence {
	readonly bytes: number;
	readonly sha256: string;
}

/** Stream full-file integrity checks while bounding the evidence sent to the model. */
export async function readAnalysisArtifacts(
	targetDir: string,
	manifest: ArtifactManifest,
): Promise<readonly VerifiedAnalysisArtifact[]> {
	const root = await realpath(targetDir);
	const artifacts: VerifiedAnalysisArtifact[] = [];
	let remainingText = 80_000;
	const seen = new Set<string>();
	for (const entry of manifest.entries) {
		if (seen.has(entry.path)) throw new Error(`Duplicate artifact path: ${entry.path}`);
		seen.add(entry.path);
		const path = resolve(root, entry.path);
		const rel = relative(root, path);
		if (
			isAbsolute(entry.path) ||
			entry.path.includes("\\") ||
			!rel ||
			rel === ".." ||
			rel.startsWith(`..${sep}`)
		)
			throw new Error("Artifact path escapes collection directory");
		const stat = await lstat(path);
		const actual = await realpath(path);
		const realRel = relative(root, actual);
		if (!stat.isFile() || stat.isSymbolicLink() || realRel === ".." || realRel.startsWith(`..${sep}`))
			throw new Error("Artifact must be a regular file within collection directory");
		if (!entry.sha256 || !/^[a-fA-F0-9]{64}$/.test(entry.sha256))
			throw new Error(`Artifact has no valid checksum: ${entry.path}`);
		const hash = createHash("sha256");
		let bytes = 0;
		let captured = 0;
		const chunks: Buffer[] = [];
		const limit = Math.min(24_000, remainingText);
		for await (const chunk of createReadStream(actual)) {
			const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
			bytes += data.length;
			hash.update(data);
			if (captured < limit) {
				const part = data.subarray(0, limit - captured);
				chunks.push(part);
				captured += part.length;
			}
		}
		const sha256 = hash.digest("hex");
		if (sha256 !== entry.sha256.toLowerCase() || bytes !== (entry.bytes ?? entry.size))
			throw new Error(`Artifact checksum or size mismatch: ${entry.path}`);
		remainingText -= captured;
		const prefix = Buffer.concat(chunks);
		artifacts.push({
			path: entry.path,
			bytes,
			sha256,
			...(prefix.includes(0) ? {} : { text: prefix.toString("utf8") }),
		});
	}
	return artifacts;
}
