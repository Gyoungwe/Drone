import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
	const root = mkdtempSync(join(tmpdir(), "drone-manifest-"));
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
it("resolves the bundled MCP runtime from the staged pi packages and the shipped resources layout", () => {
	const root = resolve("../../.pi");
	const packagesRoot = mkdtempSync(join(tmpdir(), "drone-pi-packages-"));
	try {
		const missing = researchBundlePaths(root, packagesRoot);
		expect(missing.mcpRuntimePath).toBeUndefined();
		expect(missing.warnings.join("\n")).toMatch(/pi-mcp-adapter@5\.1\.0 is not installed/);

		const adapter = join(packagesRoot, "pi-mcp-adapter");
		mkdirSync(adapter);
		writeFileSync(join(adapter, "index.ts"), "export default () => {};\n");
		writeFileSync(
			join(adapter, "package.json"),
			JSON.stringify({ name: "pi-mcp-adapter", version: "5.0.0", pi: { extensions: ["./index.ts"] } }),
		);
		expect(researchBundlePaths(root, packagesRoot).warnings.join("\n")).toMatch(
			/is 5\.0\.0, expected 5\.1\.0/,
		);

		writeFileSync(
			join(adapter, "package.json"),
			JSON.stringify({ name: "pi-mcp-adapter", version: "5.1.0", pi: { extensions: ["./index.ts"] } }),
		);
		const found = researchBundlePaths(root, packagesRoot);
		expect(found.warnings).toEqual([]);
		expect(found.mcpRuntimePath).toBe(join(adapter, "index.ts"));
		// Loaded through desktopIntegration.mcpRuntimePath, never as a research workbench extension.
		expect(found.additionalExtensionPaths).not.toContain(found.mcpRuntimePath);
	} finally {
		rmSync(packagesRoot, { recursive: true, force: true });
	}
});
it("ships the staged pi packages where main looks for them", () => {
	const builder = readFileSync(resolve("electron-builder.yml"), "utf8");
	// research-workbench is audited to contain no node_modules; the runtime lives beside it.
	expect(builder).toMatch(
		/- from: "pi-packages\/node_modules"\r?\n\s+to: "pi-packages\/node_modules"\r?\n\s+filter: \["\*\*\/\*"/,
	);
	const beforePack = builder.match(/^beforePack: "([^"]+)"/m)?.[1] ?? "";
	const pinned = JSON.parse(readFileSync(resolve("pi-packages/package.json"), "utf8")).dependencies;
	expect(pinned).toEqual({ "pi-mcp-adapter": "5.1.0" });
	expect(readFileSync(resolve(beforePack), "utf8")).toContain("stage-pi-packages.mjs");
	expect(readFileSync(resolve("package.json"), "utf8")).toMatch(
		/"dist": "node \.\.\/\.\.\/scripts\/stage-pi-packages\.mjs && /,
	);
});
