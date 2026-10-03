/** Shared validation helpers. Invalid input is rejected before a runner or ledger is called. */

export const MAX_ID_LENGTH = 128;
export const MAX_TEXT_LENGTH = 64_000;
export const MAX_CODE_LENGTH = 1_000_000;

export function nonEmptyText(value: unknown, max = MAX_TEXT_LENGTH): value is string {
	return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

export function safeId(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= MAX_ID_LENGTH &&
		/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
	);
}

export function finiteNonNegative(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function positiveFinite(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function boundedInteger(value: unknown, min: number, max: number): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}

export function isoDate(value: unknown): value is string {
	return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function safeRunPath(value: unknown): value is string {
	if (typeof value !== "string" || value.length === 0 || value.includes("\u0000")) return false;
	if (value.startsWith("/") || value.startsWith("\\") || /^[A-Za-z]:[\\/]/.test(value)) return false;
	const parts = value.replaceAll("\\", "/").split("/");
	return parts[0] === "runs" && parts.every((part) => part.length > 0 && part !== "." && part !== "..");
}

export function stableJson(value: unknown): string {
	return JSON.stringify(value, (_key, nested) => {
		if (!nested || typeof nested !== "object" || Array.isArray(nested)) return nested;
		return Object.fromEntries(Object.entries(nested).sort(([a], [b]) => a.localeCompare(b)));
	});
}

export function assertValid(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}
