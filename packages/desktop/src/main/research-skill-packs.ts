import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { RESEARCH_SKILL_SOURCES } from "@drone/shared";

interface Receipt {
	version: number;
	commit: string;
	noncommercialAcknowledged?: boolean;
	licenseAuthorization?: string;
	layout?: string;
	skills: Array<{ name: string; path: string }>;
	files: Record<string, string>;
}

/** Only explicit SKILL.md entries are registered: no upstream extensions, hooks or config. */
export function researchSkillPackPaths(root: string, options: { includeAcademic?: boolean } = {}) {
	const paths: string[] = [];
	const warnings: string[] = [];
	const promptPaths: string[] = [];
	let academicPiRoot: string | undefined;
	for (const source of RESEARCH_SKILL_SOURCES) {
		if (source.id === "academic" && !options.includeAcademic) continue;
		const directory = join(root, source.id);
		if (!existsSync(directory)) {
			if (source.id !== "academic")
				warnings.push(`Research skills ${source.id} missing; run npm run skills:sync.`);
			continue;
		}
		try {
			const receipt = JSON.parse(readFileSync(join(directory, ".drone-pack.json"), "utf8")) as Receipt;
			const selected = source.skills.filter((skill) => skill.bundled || source.id === "academic");
			const expected = selected.map(({ name, path }) => ({ name, path }));
			if (
				receipt.version !== 1 ||
				receipt.commit !== source.commit ||
				JSON.stringify(receipt.skills) !== JSON.stringify(expected) ||
				(source.id === "academic" &&
					(receipt.layout !== "pi-complete-v1" ||
						!["noncommercial", "separate-permission"].includes(receipt.licenseAuthorization ?? "")))
			)
				throw new Error("Stale or unacknowledged source receipt");
			const realRoot = realpathSync(directory);
			const pending: string[] = [];
			for (const skill of expected) {
				const path = join(directory, skill.path);
				const rel = relative(realRoot, realpathSync(path));
				if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..\\`) || rel.startsWith("../"))
					throw new Error("Skill escapes source root");
				const hash = createHash("sha256").update(readFileSync(path)).digest("hex");
				if (receipt.files?.[skill.path] !== hash) throw new Error(`Modified skill: ${skill.name}`);
				pending.push(path);
			}
			if (source.id === "academic") {
				for (const file of source.runtimeFiles) {
					if (realpathSync(join(directory, file.path)) !== join(realRoot, file.path))
						throw new Error(`Redirected ARS runtime: ${file.path}`);
					const actual = createHash("sha256")
						.update(readFileSync(join(directory, file.path)))
						.digest("hex");
					if (actual !== file.sha256) throw new Error(`Unpinned ARS runtime: ${file.path}`);
				}
				academicPiRoot = directory;
				promptPaths.push(
					...source.runtimeFiles
						.filter((f) => f.path.startsWith("commands/") && f.path.endsWith(".md"))
						.map((f) => join(directory, f.path)),
				);
			}
			paths.push(...pending);
		} catch (error) {
			warnings.push(
				`Research skills ${source.id} not loaded: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
	return { paths, warnings, promptPaths, academicPiRoot };
}
