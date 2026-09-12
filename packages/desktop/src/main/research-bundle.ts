import { readFileSync } from "node:fs";
import { join } from "node:path";
/** Same explicit bundle in a clean install, any project, and the packaging smoke test. */
export function researchBundlePaths(root: string): {
	additionalExtensionPaths: string[];
	additionalSkillPaths: string[];
} {
	const manifest = JSON.parse(readFileSync(join(root, "lib/workbench-manifest.json"), "utf8")) as {
		version: number;
		extensions: string[];
		skills: string[];
	};
	if (
		manifest.version !== 1 ||
		!Array.isArray(manifest.extensions) ||
		!Array.isArray(manifest.skills) ||
		manifest.extensions.some((p) => !/^[a-z0-9-]+\.mjs$/.test(p)) ||
		manifest.skills.some((p) => !/^[a-z0-9-]+$/.test(p))
	)
		throw new Error("Invalid bundled research manifest");
	return {
		additionalExtensionPaths: manifest.extensions.map((name) => join(root, "extensions", name)),
		additionalSkillPaths: manifest.skills.map((name) => join(root, "skills", name, "SKILL.md")),
	};
}
