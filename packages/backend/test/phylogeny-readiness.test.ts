import { workflowStage, workflowStageForSkill } from "@drone/shared";
import { describe, expect, it } from "vitest";
import { detectResearchIntent, selectResearchSkills } from "../src/capabilities/research-skill-router";
import { type BioEnvironment, formatEnvironment, missingToolGroups } from "../src/tools/bio/environment";

const installed = ["phylogenetics", "etetoolkit", "scikit-bio", "nature-figure"].map((name) => ({
	name,
	description: name,
	filePath: `/skills/${name}/SKILL.md`,
}));
const env = (tools: Record<string, string | null>, envManager: string | null = "mamba"): BioEnvironment => ({
	where: "local",
	tools,
	envManager,
	condaEnvs: [],
	containers: [],
	cpus: 8,
	memoryGb: 32,
	freeMemoryGb: 16,
	freeDiskGb: 100,
});

describe("phylogeny stage readiness", () => {
	it("is a registered stage owned by phylogenetics with a contract", () => {
		expect(workflowStage("phylogeny")?.commands).toEqual(["skill:phylogenetics", "skill:etetoolkit"]);
		expect(workflowStageForSkill("phylogenetics")?.id).toBe("phylogeny");
	});
	it.each(["构建 DHX16 的系统发育树并渲染", "Build and render a phylogenetic tree with IQ-TREE"])(
		"%s routes to the phylogeny stage (not unavailable)",
		(text) => {
			const r = selectResearchSkills(installed, new Set(["research"] as const), detectResearchIntent(text));
			expect(r.stage).toBe("phylogeny");
			expect(r.primaryWorkflow).toBe("phylogenetics");
			expect(r.contract).toMatch(/mamba/);
			expect(r.unavailableStage).toBeUndefined();
		},
	);
	it("only reports unavailable when the skill itself is not installed", () => {
		const r = selectResearchSkills(
			installed.filter((s) => !["phylogenetics", "etetoolkit"].includes(s.name)),
			new Set(["research"] as const),
			detectResearchIntent("构建系统发育树"),
		);
		expect(r.unavailableStage).toBe("phylogeny");
	});
});

describe("bio_environment install guidance", () => {
	it("suggests a mamba/bioconda env when tree tools are missing", () => {
		const e = env({ mafft: null, iqtree2: null, FastTree: null });
		expect(missingToolGroups(e).map((g) => g.id)).toEqual(["phylogeny"]);
		expect(formatEnvironment(e)).toMatch(
			/mamba create -n phylogeny -c conda-forge -c bioconda mafft trimal iqtree fasttree/,
		);
	});
	it("suggests installing Miniforge when no env manager exists", () => {
		expect(formatEnvironment(env({}, null))).toMatch(/Miniforge/);
	});
	it("no hint when an aligner and a tree builder are present", () => {
		expect(missingToolGroups(env({ mafft: "7.5", FastTree: "2.1" }))).toEqual([]);
	});
});
