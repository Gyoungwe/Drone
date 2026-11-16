import { createHash } from "node:crypto";
import { stableJson } from "@drone/compute";

export const CAPSULE_LIMIT = 64 * 1024 * 1024;

export interface EvidenceAttestationCapsule {
	readonly format: "drone-evidence-attestation";
	readonly schemaVersion: 1;
	readonly audience: "public" | "restricted";
	readonly checkpointId: string;
	readonly createdAt: string;
	readonly exportedAt: string;
	readonly files: readonly { readonly sha256: string; readonly included: boolean }[];
	readonly blobs: Readonly<Record<string, string>>;
	readonly digest: string;
}

const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

function record(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("Invalid attestation object");
	return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
	if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key)))
		throw new Error(`Invalid ${label} keys`);
}

function isHash(value: unknown): value is string {
	return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function timestamp(value: unknown): string {
	if (
		typeof value !== "string" ||
		!Number.isFinite(Date.parse(value)) ||
		new Date(value).toISOString() !== value
	)
		throw new Error("Invalid attestation timestamp");
	return value;
}

function attestedFiles(value: unknown): EvidenceAttestationCapsule["files"] {
	if (!Array.isArray(value) || !value.length || value.length > 10000)
		throw new Error("Invalid attestation files");
	const files = value.map((entry) => {
		const file = record(entry);
		exactKeys(file, ["sha256", "included"], "attestation file");
		if (!isHash(file.sha256) || typeof file.included !== "boolean")
			throw new Error("Invalid attestation file");
		return { sha256: file.sha256, included: file.included };
	});
	let previous = "";
	for (const file of files) {
		if (file.sha256 < previous) throw new Error("Attestation files are not sorted by sha256");
		previous = file.sha256;
	}
	return files;
}

function attestedBlobs(value: unknown, files: EvidenceAttestationCapsule["files"]): Record<string, string> {
	const expected = new Set(files.filter((file) => file.included).map((file) => file.sha256));
	const blobs: Record<string, string> = {};
	const sizes = new Map<string, number>();
	for (const [hash, encoded] of Object.entries(record(value))) {
		if (!expected.has(hash)) throw new Error("Unexpected attestation blob");
		if (typeof encoded !== "string" || encoded.length > CAPSULE_LIMIT * 2)
			throw new Error("Invalid or oversized attestation blob");
		const bytes = Buffer.from(encoded, "base64");
		if (bytes.toString("base64") !== encoded || digest(bytes) !== hash)
			throw new Error("Attestation blob checksum mismatch");
		blobs[hash] = encoded;
		sizes.set(hash, bytes.length);
	}
	let size = 0;
	for (const file of files) {
		if (!file.included) continue;
		const bytes = sizes.get(file.sha256);
		if (bytes === undefined) throw new Error("Missing attestation blob");
		size += bytes;
	}
	if (size > CAPSULE_LIMIT)
		throw new Error("Evidence exceeds capsule limit; use a smaller explicit checkpoint");
	return blobs;
}

export function verifyAttestationCapsule(value: unknown): EvidenceAttestationCapsule {
	const capsule = record(value);
	exactKeys(
		capsule,
		[
			"format",
			"schemaVersion",
			"audience",
			"checkpointId",
			"createdAt",
			"exportedAt",
			"files",
			"blobs",
			"digest",
		],
		"attestation",
	);
	if (capsule.format !== "drone-evidence-attestation" || capsule.schemaVersion !== 1)
		throw new Error("Unsupported attestation version");
	if (capsule.audience !== "public" && capsule.audience !== "restricted")
		throw new Error("Invalid attestation audience");
	if (!isHash(capsule.checkpointId) || !isHash(capsule.digest)) throw new Error("Invalid attestation hash");
	const files = attestedFiles(capsule.files);
	const body: Omit<EvidenceAttestationCapsule, "digest"> = {
		format: capsule.format,
		schemaVersion: capsule.schemaVersion,
		audience: capsule.audience,
		checkpointId: capsule.checkpointId,
		createdAt: timestamp(capsule.createdAt),
		exportedAt: timestamp(capsule.exportedAt),
		files,
		blobs: attestedBlobs(capsule.blobs, files),
	};
	if (digest(stableJson(body)) !== capsule.digest) throw new Error("Attestation digest mismatch");
	return { ...body, digest: capsule.digest };
}

export function audienceRank(audience: EvidenceAttestationCapsule["audience"] | "private"): number {
	return audience === "public" ? 0 : audience === "restricted" ? 1 : 2;
}

export async function buildAttestationCapsule(
	checkpoint: {
		readonly id: string;
		readonly createdAt: string;
		readonly files: readonly {
			readonly artifact: {
				readonly sha256: string;
				readonly accessLevel?: "public" | "restricted" | "private";
			};
		}[];
	},
	audience: EvidenceAttestationCapsule["audience"],
	exportedAt: string,
	readBlob: (sha256: string) => Promise<Buffer>,
): Promise<EvidenceAttestationCapsule> {
	const files = checkpoint.files
		.map(({ artifact }) => ({
			sha256: artifact.sha256,
			included: audienceRank(artifact.accessLevel ?? "private") <= audienceRank(audience),
		}))
		.sort((a, b) => a.sha256.localeCompare(b.sha256));
	const blobs: Record<string, string> = {};
	for (const file of files) {
		if (file.included) blobs[file.sha256] = (await readBlob(file.sha256)).toString("base64");
	}
	const body = {
		format: "drone-evidence-attestation" as const,
		schemaVersion: 1 as const,
		audience,
		checkpointId: checkpoint.id,
		createdAt: checkpoint.createdAt,
		exportedAt,
		files,
		blobs,
	};
	return verifyAttestationCapsule({ ...body, digest: digest(stableJson(body)) });
}
