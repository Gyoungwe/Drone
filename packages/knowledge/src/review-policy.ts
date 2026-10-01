import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { knowledgeDirectory } from "./config";

export type ReviewMode = "automatic" | "strict";

function errorCode(error: unknown): unknown {
	return error && typeof error === "object" && "code" in error ? error.code : undefined;
}

/**
 * Read the review policy from the host-owned application directory.
 * Environment policy is intentionally higher precedence than persisted state.
 */
export function readReviewMode(): ReviewMode {
	if (process.env.DRONE_REVIEW_MODE === "strict") return "strict";
	const root = knowledgeDirectory();
	if (!root) return "automatic";
	try {
		const value: unknown = JSON.parse(readFileSync(join(root, "review-policy.json"), "utf8"));
		const mode =
			value && typeof value === "object" && "mode" in value ? (value as { mode?: unknown }).mode : undefined;
		return mode === "automatic" ? "automatic" : "strict";
	} catch (error) {
		return errorCode(error) === "ENOENT" ? "automatic" : "strict";
	}
}

/** Persist a review mode atomically with restrictive file permissions. */
export async function saveReviewMode(mode: string): Promise<{ mode: ReviewMode }> {
	if (mode !== "automatic" && mode !== "strict") throw new Error("Invalid review mode");
	const root = knowledgeDirectory();
	if (!root) throw new Error("No application knowledge directory");
	await mkdir(root, { recursive: true });
	const temp = join(root, `review-policy.${randomUUID()}.tmp`);
	await writeFile(temp, JSON.stringify({ version: 1, mode }), { flag: "wx", mode: 0o600 });
	await rename(temp, join(root, "review-policy.json"));
	return { mode: readReviewMode() };
}

export const advisoryCodes = new Set([
	"paper-citation-required",
	"search-required",
	"coverage-incomplete",
	"wiki-changed",
	"citation-required",
	"source-unread",
	"source-changed",
	"delivery-changed",
	"search-stale",
	"check-timeout",
	"not-prepared",
	"citation-invalid",
	"citation-budget",
]);
