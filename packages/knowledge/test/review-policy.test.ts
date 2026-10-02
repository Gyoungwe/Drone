import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { advisoryCodes, readReviewMode, saveReviewMode } from "../src/review-policy";

let root: string;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "drone-review-policy-"));
	vi.stubEnv("DRONE_KNOWLEDGE_DIR", join(root, "app"));
	vi.stubEnv("DRONE_REVIEW_MODE", undefined);
});

afterEach(async () => {
	vi.unstubAllEnvs();
	await rm(root, { recursive: true, force: true });
});

describe("review policy", () => {
	it("defaults to automatic and persists a restrictive policy atomically", async () => {
		expect(readReviewMode()).toBe("automatic");
		expect(await saveReviewMode("strict")).toEqual({ mode: "strict" });
		expect(readReviewMode()).toBe("strict");
		const path = join(root, "app", "review-policy.json");
		expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ version: 1, mode: "strict" });
		if (process.platform !== "win32") expect((await stat(path)).mode & 0o777).toBe(0o600);
	});

	it("lets the strict environment override persisted automatic mode", async () => {
		await saveReviewMode("automatic");
		vi.stubEnv("DRONE_REVIEW_MODE", "strict");
		expect(readReviewMode()).toBe("strict");
		vi.stubEnv("DRONE_REVIEW_MODE", "automatic");
		expect(readReviewMode()).toBe("automatic");
	});

	it("uses strict mode for malformed persisted data and rejects unsafe setup", async () => {
		await saveReviewMode("automatic");
		await import("node:fs/promises").then(({ writeFile }) =>
			writeFile(join(root, "app", "review-policy.json"), "{invalid"),
		);
		expect(readReviewMode()).toBe("strict");
		await expect(saveReviewMode("invalid")).rejects.toThrow("Invalid review mode");
		vi.stubEnv("DRONE_KNOWLEDGE_DIR", "relative");
		expect(() => readReviewMode()).toThrow("must be absolute");
	});

	it("publishes the stable advisory code set", () => {
		expect(advisoryCodes.has("citation-required")).toBe(true);
		expect(advisoryCodes.has("unknown-code")).toBe(false);
		expect(advisoryCodes.size).toBe(13);
	});
});
