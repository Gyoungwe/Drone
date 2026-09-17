import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { knowledgeDirectory } from "./config.mjs";

// Host configuration, never read from retrieved notes or model tool arguments.
export function readReviewMode() {
	if (process.env.DRONE_REVIEW_MODE === "strict") return "strict";
	const root = knowledgeDirectory();
	if (!root) return "automatic";
	try {
		const value = JSON.parse(readFileSync(join(root, "review-policy.json"), "utf8"));
		return value.mode === "automatic" ? "automatic" : "strict";
	} catch (error) {
		return error.code === "ENOENT" ? "automatic" : "strict";
	}
}
export async function saveReviewMode(mode) {
	if (!["automatic", "strict"].includes(mode)) throw new Error("Invalid review mode");
	const root = knowledgeDirectory();
	if (!root) throw new Error("No application knowledge directory");
	await mkdir(root, { recursive: true });
	const temp = join(root, `review-policy.${randomUUID()}.tmp`);
	await writeFile(temp, JSON.stringify({ version: 1, mode }), { flag: "wx", mode: 0o600 });
	await rename(temp, join(root, "review-policy.json"));
	return { mode: await readReviewMode() };
}
export const advisoryCodes = new Set([
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
