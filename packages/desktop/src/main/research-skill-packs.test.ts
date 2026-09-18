import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { RESEARCH_SKILL_SOURCES } from "@drone/shared";
import { afterEach, expect, it, vi } from "vitest";
import { researchSkillPackPaths } from "./research-skill-packs";

vi.mock("@drone/shared", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@drone/shared")>();
	const crypto = await import("node:crypto");
	const sources = structuredClone(actual.RESEARCH_SKILL_SOURCES);
	const academic = sources.find((s) => s.id === "academic");
	if (!academic) throw new Error("Missing fixture source");
	academic.runtimeFiles = ["pi/wrapper.js", "commands/ars-plan.md", "MODE_REGISTRY.md"].map((path) => ({
		path,
		sha256: crypto.createHash("sha256").update(`${path}\n`).digest("hex"),
	}));
	return { ...actual, RESEARCH_SKILL_SOURCES: sources };
});
const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture(id: string, acknowledgment = false) {
	const root = mkdtempSync(join(tmpdir(), "research-pack-"));
	roots.push(root);
	const source = RESEARCH_SKILL_SOURCES.find((s) => s.id === id);
	if (!source) throw new Error(`Missing fixture ${id}`);
	const skills = source.skills
		.filter((s) => s.bundled || id === "academic")
		.map(({ name, path }) => ({ name, path }));
	const files: Record<string, string> = {};
	for (const skill of skills) {
		const target = join(root, id, skill.path);
		mkdirSync(dirname(target), { recursive: true });
		const body = `---\nname: ${skill.name}\ndescription: fixture\n---\n`;
		writeFileSync(target, body);
		files[skill.path] = createHash("sha256").update(body).digest("hex");
	}
	for (const file of source.runtimeFiles) {
		const path = join(root, id, file.path);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, `${file.path}\n`);
		files[file.path] = file.sha256;
	}
	const receipt = {
		version: 1,
		commit: source.commit,
		skills,
		files,
		layout: "pi-complete-v1",
		licenseAuthorization: acknowledgment ? "noncommercial" : "",
		noncommercialAcknowledged: acknowledgment,
	};
	writeFileSync(join(root, id, ".drone-pack.json"), JSON.stringify(receipt));
	return { root, skills, receipt };
}
it("loads only pinned explicit skill paths and preserves original names", () => {
	const { root } = fixture("nature");
	const result = researchSkillPackPaths(root);
	expect(result.paths).toHaveLength(20);
	expect(result.paths.some((p) => p.endsWith("SKILL.md"))).toBe(true);
	expect(result.warnings.join(" ")).toContain("scientific missing");
});
it("keeps restricted scientific skills out of the default bundle", () => {
	const { root } = fixture("scientific");
	const result = researchSkillPackPaths(root);
	expect(result.paths).toHaveLength(148);
	expect(result.paths.some((path) => /(?:what-if-oracle|deepspot-m|skills[/\\]docx)/.test(path))).toBe(false);
});
it("does not load a partly changed source", () => {
	const { root, skills } = fixture("nature");
	const first = skills[0];
	if (!first) throw new Error("Missing fixture skill");
	writeFileSync(join(root, "nature", first.path), "modified");
	const result = researchSkillPackPaths(root);
	expect(result.paths).toEqual([]);
	expect(result.warnings.join(" ")).toContain("Modified skill");
});
it("does not load stale or injected receipt entries", () => {
	const { root, receipt } = fixture("nature");
	receipt.skills.push({ name: "injected", path: "../../evil/SKILL.md" });
	writeFileSync(join(root, "nature", ".drone-pack.json"), JSON.stringify(receipt));
	expect(researchSkillPackPaths(root).paths).toEqual([]);
});
it("requires both explicit ARS inclusion and its license acknowledgment", () => {
	const { root, receipt } = fixture("academic");
	expect(researchSkillPackPaths(root).paths).toEqual([]);
	expect(researchSkillPackPaths(root, { includeAcademic: true }).paths).toEqual([]);
	receipt.licenseAuthorization = "separate-permission";
	writeFileSync(join(root, "academic", ".drone-pack.json"), JSON.stringify(receipt));
	const loaded = researchSkillPackPaths(root, { includeAcademic: true });
	expect(loaded.paths).toHaveLength(4);
	expect(loaded.promptPaths).toHaveLength(1);
	expect(loaded.academicPiRoot).toBe(join(root, "academic"));
	expect(researchSkillPackPaths(root).paths).toEqual([]);
});
it("packaging includes the complete ARS source and enforces release preflight", () => {
	const config = readFileSync(new URL("../../electron-builder.yml", import.meta.url), "utf8");
	expect(config).toContain('from: "resources/research-skills/nature"');
	expect(config).toContain('from: "resources/research-skills/scientific"');
	expect(config).toContain('from: "resources/research-skills/academic"');
	expect(config).toContain('beforePack: "../../scripts/verify-research-release.cjs"');
	const main = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
	expect(main).toContain("{ includeAcademic: true }");
	expect(main).not.toContain("includeAcademic: !app.isPackaged");
});

it("refuses a modified executable wrapper even if the receipt was changed", () => {
	const { root, receipt } = fixture("academic", true);
	const modified = "unreviewed code";
	writeFileSync(join(root, "academic", "pi/wrapper.js"), modified);
	receipt.files["pi/wrapper.js"] = createHash("sha256").update(modified).digest("hex");
	writeFileSync(join(root, "academic", ".drone-pack.json"), JSON.stringify(receipt));
	const result = researchSkillPackPaths(root, { includeAcademic: true });
	expect(result.paths).toEqual([]);
	expect(result.promptPaths).toEqual([]);
	expect(result.academicPiRoot).toBeUndefined();
});

it("refuses a redirected runtime directory even when file bytes match the pin", () => {
	const { root } = fixture("academic", true);
	const external = mkdtempSync(join(tmpdir(), "ars-redirect-"));
	roots.push(external);
	writeFileSync(join(external, "wrapper.js"), "pi/wrapper.js\n");
	rmSync(join(root, "academic", "pi"), { recursive: true, force: true });
	symlinkSync(external, join(root, "academic", "pi"), "junction");
	const result = researchSkillPackPaths(root, { includeAcademic: true });
	expect(result.academicPiRoot).toBeUndefined();
	expect(result.warnings.join(" ")).toContain("Redirected ARS runtime");
});
