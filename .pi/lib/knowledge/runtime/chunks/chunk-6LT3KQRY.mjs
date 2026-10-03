// @ts-nocheck
import {
  knowledgeDirectory
} from "./chunk-CXEKIGAQ.mjs";

// packages/knowledge/src/review-policy.ts
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
function errorCode(error) {
  return error && typeof error === "object" && "code" in error ? error.code : void 0;
}
function readReviewMode() {
  if (process.env.DRONE_REVIEW_MODE === "strict") return "strict";
  const root = knowledgeDirectory();
  if (!root) return "automatic";
  try {
    const value = JSON.parse(readFileSync(join(root, "review-policy.json"), "utf8"));
    const mode = value && typeof value === "object" && "mode" in value ? value.mode : void 0;
    return mode === "automatic" ? "automatic" : "strict";
  } catch (error) {
    return errorCode(error) === "ENOENT" ? "automatic" : "strict";
  }
}
async function saveReviewMode(mode) {
  if (mode !== "automatic" && mode !== "strict") throw new Error("Invalid review mode");
  const root = knowledgeDirectory();
  if (!root) throw new Error("No application knowledge directory");
  await mkdir(root, { recursive: true });
  const temp = join(root, `review-policy.${randomUUID()}.tmp`);
  await writeFile(temp, JSON.stringify({ version: 1, mode }), { flag: "wx", mode: 384 });
  await rename(temp, join(root, "review-policy.json"));
  return { mode: readReviewMode() };
}
var advisoryCodes = /* @__PURE__ */ new Set([
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
  "citation-budget"
]);

export {
  readReviewMode,
  saveReviewMode,
  advisoryCodes
};
