import { EVIDENCE_CAPSULE_LIMIT, type EvidenceAccessLevel, type EvidenceArtifact } from "./artifacts";
import { type EvidenceCheckpoint, validateCheckpoint } from "./checkpoints";
import { canonicalJson, digestJson, isSha256, sha256Hex } from "./digest";

export type EvidenceAudience = EvidenceAccessLevel;

export interface EvidenceCapsulePublication {
	readonly audience: EvidenceAudience;
	readonly omittedPaths: readonly string[];
}

export interface EvidenceCapsule {
	readonly format: "drone-evidence-capsule";
	readonly version: 1;
	readonly checkpoint: EvidenceCheckpoint;
	/** Base64 encoded content-addressed bytes; private blobs never enter a public capsule. */
	readonly blobs: Readonly<Record<string, string>>;
	readonly publication?: EvidenceCapsulePublication;
}

const audienceRank = (value: EvidenceAudience): number =>
	value === "public" ? 0 : value === "restricted" ? 1 : 2;

function decodeBase64(value: string): Uint8Array {
	if (!value || value.length > EVIDENCE_CAPSULE_LIMIT * 2 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value))
		throw new Error("Invalid or oversized capsule blob");
	const data = Uint8Array.from(Buffer.from(value, "base64"));
	if (Buffer.from(data).toString("base64") !== value) throw new Error("Invalid capsule base64");
	return data;
}

function encodeBlob(value: string | Uint8Array): string {
	return typeof value === "string" ? value : Buffer.from(value).toString("base64");
}

function eligibleFiles(capsule: EvidenceCapsule): readonly EvidenceArtifact[] {
	const audience = capsule.publication?.audience ?? "private";
	return capsule.checkpoint.files
		.filter((file) => audienceRank(file.artifact.accessLevel ?? "private") <= audienceRank(audience))
		.map((file) => file.artifact);
}

export function validateCapsule(capsule: EvidenceCapsule): void {
	if (capsule.format !== "drone-evidence-capsule" || capsule.version !== 1)
		throw new Error("Unsupported capsule version");
	validateCheckpoint(capsule.checkpoint);
	const audience = capsule.publication?.audience ?? "private";
	if (!["public", "restricted", "private"].includes(audience))
		throw new Error("Invalid capsule publication audience");
	const omittedPaths = capsule.checkpoint.files
		.filter((file) => audienceRank(file.artifact.accessLevel ?? "private") > audienceRank(audience))
		.map((file) => file.artifact.path)
		.sort();
	if (
		capsule.publication &&
		canonicalJson([...capsule.publication.omittedPaths].sort()) !== canonicalJson(omittedPaths)
	)
		throw new Error("Capsule publication omission list mismatch");
	const expected = new Set(eligibleFiles(capsule).map((artifact) => artifact.sha256));
	if (!capsule.blobs || typeof capsule.blobs !== "object") throw new Error("Missing capsule blobs");
	for (const [hash, encoded] of Object.entries(capsule.blobs)) {
		if (!isSha256(hash) || !expected.has(hash)) throw new Error("Unexpected capsule blob");
		const data = decodeBase64(encoded);
		const artifact = capsule.checkpoint.files.find((file) => file.artifact.sha256 === hash)?.artifact;
		if (!artifact || data.byteLength !== artifact.bytes || sha256Hex(data) !== hash)
			throw new Error("Capsule blob checksum mismatch");
	}
	for (const artifact of eligibleFiles(capsule))
		if (typeof capsule.blobs[artifact.sha256] !== "string") throw new Error("Missing capsule blob");
	if (Object.keys(capsule.blobs).length !== expected.size) throw new Error("Unexpected capsule blobs");
}

export function createEvidenceCapsule(
	checkpoint: EvidenceCheckpoint,
	blobs: Readonly<Record<string, string | Uint8Array>>,
	audience: EvidenceAudience = "private",
): EvidenceCapsule {
	validateCheckpoint(checkpoint);
	const omittedPaths = checkpoint.files
		.filter((file) => audienceRank(file.artifact.accessLevel ?? "private") > audienceRank(audience))
		.map((file) => file.artifact.path)
		.sort();
	const selected: Record<string, string> = {};
	for (const artifact of checkpoint.files.map((file) => file.artifact)) {
		if (audienceRank(artifact.accessLevel ?? "private") > audienceRank(audience)) continue;
		const value = blobs[artifact.sha256];
		if (value === undefined) throw new Error(`Missing blob for ${artifact.path}`);
		const encoded = encodeBlob(value);
		const bytes = decodeBase64(encoded);
		if (bytes.byteLength !== artifact.bytes || sha256Hex(bytes) !== artifact.sha256)
			throw new Error(`Blob does not match ${artifact.path}`);
		selected[artifact.sha256] = encoded;
	}
	const capsule: EvidenceCapsule = {
		format: "drone-evidence-capsule",
		version: 1,
		checkpoint,
		blobs: selected,
		...(audience === "private" ? {} : { publication: { audience, omittedPaths } }),
	};
	validateCapsule(capsule);
	return capsule;
}

export function serializeCapsule(capsule: EvidenceCapsule): string {
	validateCapsule(capsule);
	return canonicalJson(canonicalCapsule(capsule));
}

function canonicalCapsule(capsule: EvidenceCapsule): EvidenceCapsule {
	if (!capsule.publication) return capsule;
	return {
		...capsule,
		publication: {
			...capsule.publication,
			omittedPaths: [...capsule.publication.omittedPaths].sort(),
		},
	};
}

export function parseCapsule(serialized: string): EvidenceCapsule {
	if (serialized.length > EVIDENCE_CAPSULE_LIMIT * 2) throw new Error("Capsule exceeds import limit");
	let parsed: unknown;
	try {
		parsed = JSON.parse(serialized);
	} catch {
		throw new Error("Invalid evidence capsule JSON");
	}
	validateCapsule(parsed as EvidenceCapsule);
	return parsed as EvidenceCapsule;
}

export function validateCapsuleImport(serialized: string | EvidenceCapsule): EvidenceCheckpoint {
	const capsule = typeof serialized === "string" ? parseCapsule(serialized) : serialized;
	validateCapsule(capsule);
	return capsule.checkpoint;
}

export function capsuleDigest(capsule: EvidenceCapsule): string {
	validateCapsule(capsule);
	return digestJson(canonicalCapsule(capsule));
}

export function capsuleBytes(capsule: EvidenceCapsule): Uint8Array {
	return new TextEncoder().encode(serializeCapsule(capsule));
}
