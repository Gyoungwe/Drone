import { createHash } from "node:crypto";

/** Deterministic JSON used by every evidence digest. */
export function stableJson(value: unknown): string {
	if (value === null || typeof value !== "object") {
		const encoded = JSON.stringify(value);
		return encoded === undefined ? "null" : encoded;
	}
	if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
	const object = value as Record<string, unknown>;
	return `{${Object.keys(object)
		.filter((key) => object[key] !== undefined)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
		.join(",")}}`;
}

export function canonicalJson(value: unknown): string {
	return `${stableJson(value)}\n`;
}

/** SHA-256 is the only digest used by the evidence contract. */
export function sha256Hex(value: string | Uint8Array): string {
	return createHash("sha256").update(value).digest("hex");
}

export function digestJson(value: unknown): string {
	return sha256Hex(canonicalJson(value));
}

export function isSha256(value: unknown): value is string {
	return typeof value === "string" && /^[a-f0-9]{64}$/iu.test(value);
}
