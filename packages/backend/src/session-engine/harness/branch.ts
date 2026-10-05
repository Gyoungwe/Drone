import { decodeTaskView } from "@drone/shared";
/** Normalize the SDK's append-only entry shapes without importing runtime values. */
export interface HarnessBranchEntry {
	type?: unknown;
	id?: unknown;
	timestamp?: unknown;
	message?: unknown;
	customType?: unknown;
	content?: unknown;
	details?: unknown;
	data?: unknown;
	summary?: unknown;
}
export interface HarnessCustomRecord extends HarnessBranchEntry {
	customType: string;
}
export function record(value: unknown): HarnessBranchEntry | undefined {
	return value && typeof value === "object" ? (value as HarnessBranchEntry) : undefined;
}
export function boundedText(value: unknown, limit = 1_200): string | undefined {
	if (typeof value !== "string") return undefined;
	const text = value.replace(/\s+/gu, " ").trim();
	return text ? (text.length > limit ? `${text.slice(0, limit - 1)}…` : text) : undefined;
}
export function contentText(value: unknown, limit = 1_200): string | undefined {
	if (typeof value === "string") return boundedText(value, limit);
	if (!Array.isArray(value)) return undefined;
	return boundedText(
		value
			.flatMap((block) => {
				const candidate = block as { type?: unknown; text?: unknown } | null;
				return candidate?.type === "text" && typeof candidate.text === "string" ? [candidate.text] : [];
			})
			.join(" "),
		limit,
	);
}
export function customRecords(branch: readonly unknown[]): HarnessCustomRecord[] {
	return branch.flatMap((value) => {
		const entry = record(value);
		if (!entry) return [];
		if ((entry.type === "custom_message" || entry.type === "custom") && typeof entry.customType === "string")
			return [entry as HarnessCustomRecord];
		// Compatibility for legacy context messages and in-memory hosts.
		const message = record(entry.message) as (HarnessBranchEntry & { role?: unknown }) | undefined;
		return entry.type === "message" && message?.role === "custom" && typeof message.customType === "string"
			? [{ ...message, id: entry.id, timestamp: entry.timestamp, customType: message.customType }]
			: [];
	});
}
export function latestCustom(
	branch: readonly unknown[],
	customType: string,
): HarnessCustomRecord | undefined {
	return customRecords(branch)
		.reverse()
		.find((entry) => entry.customType === customType);
}
export function latestUserObjective(branch: readonly unknown[]): string | undefined {
	for (const value of [...branch].reverse()) {
		const entry = record(value);
		const message = record(entry?.message) as (HarnessBranchEntry & { role?: unknown }) | undefined;
		if (entry?.type === "message" && message?.role === "user") return contentText(message.content);
	}
	return undefined;
}

export function taskViewFromBranch(branch: readonly unknown[]) {
	for (const message of customRecords(branch).reverse()) {
		const payload = record(message.details) ?? record(message.data);
		const view = decodeTaskView((payload as { taskView?: unknown } | undefined)?.taskView);
		if (view) return view;
	}
	return undefined;
}
