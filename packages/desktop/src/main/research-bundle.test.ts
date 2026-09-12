import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { researchBundlePaths } from "./research-bundle";

it("loads the same first-party extensions and skills in all desktop projects", () => {
	const root = resolve("../../.pi"),
		paths = researchBundlePaths(root);
	expect(paths.additionalExtensionPaths).toContain(join(root, "extensions/source-archive.mjs"));
	expect(paths.additionalExtensionPaths).toContain(join(root, "extensions/research-loop.mjs"));
	expect(paths.additionalSkillPaths).toContain(join(root, "skills/research-workflow/SKILL.md"));
	expect(paths.additionalSkillPaths).toContain(join(root, "skills/research-show-me/SKILL.md"));
	expect(paths.additionalExtensionPaths.length).toBe(new Set(paths.additionalExtensionPaths).size);
});
it("refuses escaping or invalid manifest paths", () => {
	const root = mkdtempSync(join(tmpdir(), "percho-manifest-"));
	mkdirSync(join(root, "lib"));
	try {
		writeFileSync(
			join(root, "lib/workbench-manifest.json"),
			JSON.stringify({ version: 1, extensions: ["../../private.mjs"], skills: [] }),
		);
		expect(() => researchBundlePaths(root)).toThrow("Invalid");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
