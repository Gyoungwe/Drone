import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { alignmentPreview, layoutTree, parseNewick } from "@drone/shared";
import { afterEach, describe, expect, it } from "vitest";
import { LARGE_BIO_FILE_BYTES, largeBioFileReason } from "../src/tools/bio/extension";

const WORKSPACE_ROOT = resolve(__dirname, "../../..");
const FIXTURES_DIR = join(WORKSPACE_ROOT, "test/fixtures/simulated-user");

let tempDir = "";
afterEach(async () => {
	if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

describe("simulated user test fixtures: scientific viewers & biological formats", () => {
	it("parses Newick tree fixtures with divergence lengths and bootstrap support", () => {
		// 1. species_tree.nwk
		const speciesTreeText = readFileSync(join(FIXTURES_DIR, "tree/species_tree.nwk"), "utf8");
		const speciesTree = parseNewick(speciesTreeText);
		const speciesLayout = layoutTree(speciesTree);
		expect(speciesLayout.leaves).toBe(4);
		expect(speciesLayout.hasLengths).toBe(true);
		expect(speciesLayout.depth).toBeCloseTo(253.51);

		// 2. tree_with_support.treefile (带 bootstrap 支持率)
		const supportTreeText = readFileSync(join(FIXTURES_DIR, "tree/tree_with_support.treefile"), "utf8");
		const supportTree = parseNewick(supportTreeText);
		const supportLayout = layoutTree(supportTree);
		expect(supportLayout.leaves).toBe(19);
		expect(supportLayout.hasLengths).toBe(true);
		const supportLabels = supportLayout.nodes.filter((n) => !n.leaf && n.name);
		expect(supportLabels.length).toBeGreaterThan(0);
		expect(supportLabels.some((n) => n.name.includes("100"))).toBe(true);

		// 3. synthetic_tree.nwk
		const synTreeText = readFileSync(join(FIXTURES_DIR, "tree/synthetic_tree.nwk"), "utf8");
		const synTree = parseNewick(synTreeText);
		const synLayout = layoutTree(synTree);
		expect(synLayout.leaves).toBe(4);
		expect(synLayout.hasLengths).toBe(true);
	});

	it("parses multiple sequence alignments across FASTA, Clustal, and PHYLIP formats", () => {
		// 1. FASTA alignment with gaps
		const alnText = readFileSync(join(FIXTURES_DIR, "alignment/alignment.aln"), "utf8");
		const aln = alignmentPreview(alnText, "aln");
		expect(aln.records.length).toBe(19);
		expect(aln.length).toBeGreaterThan(1000);
		expect(aln.records[0]?.sequence).toContain("-");

		// 2. Clustal format
		const clustalText = readFileSync(join(FIXTURES_DIR, "alignment/alignment_clustal.aln"), "utf8");
		const clustal = alignmentPreview(clustalText, "aln");
		expect(clustal.format).toBe("clustal");
		expect(clustal.records.length).toBe(4);

		// 3. PHYLIP format
		const phyText = readFileSync(join(FIXTURES_DIR, "alignment/alignment.phy"), "utf8");
		const phy = alignmentPreview(phyText, "phy");
		expect(phy.format).toBe("phylip");
		expect(phy.records.length).toBe(111);

		// 4. QIIME 2 aligned consensus fasta
		const pairedFastaText = readFileSync(join(FIXTURES_DIR, "alignment/paired-default.fasta"), "utf8");
		const pairedFasta = alignmentPreview(pairedFastaText, "fasta");
		expect(pairedFasta.records.length).toBe(18);
		expect(pairedFasta.length).toBe(254);
	});

	it("verifies public VCF variants and read metadata fixtures", () => {
		const cleanVcf = readFileSync(join(FIXTURES_DIR, "variants/clean.vcf"), "utf8");
		expect(cleanVcf).toContain("##fileformat=VCFv4.2");
		expect(cleanVcf).toContain("#CHROM\tPOS\tID\tREF\tALT");

		const grch38Vcf = readFileSync(join(FIXTURES_DIR, "variants/grch38.vcf"), "utf8");
		expect(grch38Vcf).toContain("##fileformat=VCFv4.2");

		const variantsVcf = readFileSync(join(FIXTURES_DIR, "variants/variants.vcf"), "utf8");
		expect(variantsVcf).toContain("SVTYPE=DEL");

		const fastq = readFileSync(join(FIXTURES_DIR, "reads/reads.fastq"), "utf8");
		expect(fastq).toMatch(/^@read1/);

		const metadata = readFileSync(join(FIXTURES_DIR, "reads/sample-metadata.tsv"), "utf8");
		expect(metadata).toContain("sample-id");

		const license = readFileSync(join(FIXTURES_DIR, "reads/QIIME2_LICENSE"), "utf8");
		expect(license).toContain("BSD 3-Clause License");
	});

	it("verifies the offline interactive report fixture is self-contained without external network calls", () => {
		const html = readFileSync(join(FIXTURES_DIR, "reports/report_interactive.html"), "utf8");
		expect(html).toContain("<!DOCTYPE html>");
		// 严禁包含 http:// 或 https:// 外链，确保完全符合 connect-src 'none' 的严格 CSP
		expect(html).not.toMatch(/https?:\/\//i);
		expect(html).toContain("drone-html://");
		expect(html).toContain("btn-zoom-in");
		expect(html).toContain("svg-chart");
	});

	it("verifies TC-50 large file guard triggers on generated oversized files (>4 MiB)", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "oversized-guard-"));
		const { execSync } = await import("node:child_process");
		const generatorScript = join(WORKSPACE_ROOT, "scripts/generate-simulated-fixtures.mjs");
		execSync(`node "${generatorScript}" "${tempDir}"`, { stdio: "pipe" });

		const bamReason = await largeBioFileReason(tempDir, "sample_oversized.bam");
		expect(bamReason).toContain("SAM/BAM");
		expect(bamReason).toContain("is a 4.5 MB");
		expect(bamReason).toContain("samtools view -H");

		const vcfReason = await largeBioFileReason(tempDir, "sample_oversized.vcf");
		expect(vcfReason).toContain("VCF/BCF");
		expect(vcfReason).toContain("is a 4.5 MB");
		expect(vcfReason).toContain("bcftools view -h");

		const fastqReason = await largeBioFileReason(tempDir, "sample_oversized.fastq");
		expect(fastqReason).toContain("FASTQ");
		expect(fastqReason).toContain("is a 4.5 MB");
		expect(fastqReason).toContain("seqkit stats");
	});
});
