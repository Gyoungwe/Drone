import { describe, expect, it } from "vitest";
import { CANDIDATE_MIN_CHARS, classifyIngest, INGEST_RULES, type IngestInput } from "../src/ingest-policy";

const filler = "This protocol describes each step in detail with reagent amounts and timings. ".repeat(5);
const METHOD_REPORT = `# Library prep\n\n## Methods\n\n${filler}\n\nBased on doi:10.1038/s41586-020-2649-2.\n`;
const CONCLUSION_REPORT = `# Review\n\n## 结论\n\n${filler}\n\n参考 PMID: 12345678\n`;

type Row = [string, IngestInput, Partial<ReturnType<typeof classifyIngest>>];

const rows: Row[] = [
	// 1. ephemeral paths
	["tmp dir", { path: "results/demo/run-1/tmp/x.csv" }, { class: "ephemeral", rule: 1 }],
	["cache dir", { path: ".cache/models/a.bin" }, { class: "ephemeral", rule: 1 }],
	["pycache", { path: "scripts/__pycache__/a.cpython-312.pyc" }, { class: "ephemeral", rule: 1 }],
	["browser download", { path: ".pi/browser-downloads/paper.pdf" }, { class: "ephemeral", rule: 1 }],
	["swap file", { path: "notes/.draft.md.swp" }, { class: "ephemeral", rule: 1 }],
	["partial download", { path: "results/run-1/data.csv.part" }, { class: "ephemeral", rule: 1 }],
	["editor backup", { path: "notes/plan.md~" }, { class: "ephemeral", rule: 1 }],
	["DS_Store", { path: "results/.DS_Store" }, { class: "ephemeral", rule: 1 }],
	["Windows path tmp", { path: "results\\run-1\\temp\\a.json" }, { class: "ephemeral", rule: 1 }],
	[
		"tmp wins over frontmatter",
		{ path: "scratch/n.md", frontmatter: { type: "method" } },
		{ class: "ephemeral", rule: 1 },
	],

	// 2. explicit declaration
	[
		"frontmatter type method",
		{ path: "notes/pcr.md", text: "---\ntype: method\nstatus: verified\n---\nshort" },
		{ class: "knowledge", type: "method", rule: 2, candidate: false },
	],
	[
		"frontmatter candidate",
		{ path: "notes/pcr.md", frontmatter: { type: "claim", status: "candidate" } },
		{ class: "knowledge", type: "claim", candidate: true, rule: 2 },
	],
	[
		"frontmatter class run-result",
		{ path: "results/x/report.md", frontmatter: { class: "run-result" } },
		{ class: "run-result", type: null, rule: 2 },
	],
	[
		"frontmatter ephemeral",
		{ path: "notes/a.md", frontmatter: { class: "ephemeral" } },
		{ class: "ephemeral", rule: 2 },
	],
	["Library paper", { path: "Library/Papers/hca.md" }, { class: "knowledge", type: "paper", rule: 2 }],
	["Library methods", { path: "Library/Methods/pcr.md" }, { class: "knowledge", type: "method", rule: 2 }],
	["Library ideas", { path: "Library/Ideas/2026-10-08-x.md" }, { class: "knowledge", type: "idea", rule: 2 }],
	[
		"Library explainer",
		{ path: "Library/Explainers/x/index.md" },
		{ class: "run-result", type: "explainer", purpose: "presentation", rule: 2 },
	],
	["Wiki page", { path: "Wiki/Atlas.md" }, { class: "knowledge", type: "wiki", rule: 2 }],
	["Inbox", { path: "Inbox/clip.md" }, { class: "knowledge", candidate: true, rule: 2 }],
	["Project claim", { path: "Projects/demo/Claims/c1.md" }, { class: "knowledge", type: "claim", rule: 2 }],
	[
		"Project decision",
		{ path: "Projects/demo/Decisions/d1.md" },
		{ class: "knowledge", type: "decision", rule: 2 },
	],
	[
		"Project run note",
		{ path: "Projects/demo/Runs/run-1.md" },
		{ class: "run-result", type: "run", rule: 2 },
	],
	[
		"Project artifact",
		{ path: "Projects/demo/Artifacts/fig.md" },
		{ class: "run-result", type: "artifact", rule: 2 },
	],
	["Vault index", { path: "Projects/demo/Index.md" }, { class: "knowledge", purpose: "navigation", rule: 2 }],
	[
		"Vault home",
		{ path: "Home.md", location: "vault" },
		{ class: "knowledge", purpose: "navigation", rule: 2 },
	],

	// 3. tool origin
	[
		"deposit method",
		{ path: "x.md", origin: { tool: "research_deposit_knowledge", type: "method" } },
		{ class: "knowledge", type: "method", rule: 3 },
	],
	[
		"wiki proposal",
		{ origin: { tool: "research_propose_wiki_update" } },
		{ class: "knowledge", type: "wiki", rule: 3 },
	],
	["daily idea", { origin: { tool: "daily_discovery" } }, { class: "knowledge", type: "idea", rule: 3 }],
	[
		"summarize run",
		{ origin: { tool: "research_summarize_run" } },
		{ class: "run-result", type: "run", purpose: "summary", rule: 3 },
	],
	[
		"archive source",
		{ origin: { tool: "research_archive_source" } },
		{ class: "run-result", purpose: "source", rule: 3 },
	],
	["research loop", { origin: { tool: "research_loop" } }, { class: "run-result", purpose: "log", rule: 3 }],
	[
		"archive explainer",
		{ origin: { tool: "research_archive_explainer" } },
		{ class: "run-result", type: "explainer", purpose: "presentation", rule: 3 },
	],

	// 4. run record filenames
	[
		"search log",
		{ path: "results/demo/run-1/search-log.md" },
		{ class: "run-result", purpose: "log", rule: 4 },
	],
	[
		"download receipts",
		{ path: "results/demo/download-receipts.md" },
		{ class: "run-result", purpose: "log", rule: 4 },
	],
	[
		"literature ops",
		{ path: "results/demo/literature-operations.json" },
		{ class: "run-result", purpose: "log", rule: 4 },
	],
	["metadata", { path: "results/demo/metadata.json" }, { class: "run-result", purpose: "log", rule: 4 }],
	["manifest", { path: "results/demo/manifest.v2.json" }, { class: "run-result", purpose: "log", rule: 4 }],
	["failures", { path: "results/demo/failures.json" }, { class: "run-result", purpose: "log", rule: 4 }],
	["summary", { path: "results/demo/SUMMARY.md" }, { class: "run-result", purpose: "summary", rule: 4 }],
	[
		"summary history",
		{ path: "results/demo/summary-history/2026-10-08.md" },
		{ class: "run-result", purpose: "summary", rule: 4 },
	],
	[
		"html report",
		{ path: "results/demo/report-final.html" },
		{ class: "run-result", purpose: "presentation", rule: 4 },
	],
	[
		"search log beats cited markdown",
		{ path: "notes/search-log.md", text: METHOD_REPORT },
		{ class: "run-result", purpose: "log", rule: 4 },
	],

	// 5. card containers
	[
		"evidence cards",
		{ path: "results/demo/evidence-cards.md" },
		{ class: "run-result", purpose: "cards", extractAtoms: true, rule: 5 },
	],
	[
		"paper cards",
		{ path: "results/demo/paper-cards.md" },
		{ class: "run-result", extractAtoms: true, rule: 5 },
	],
	["claims file", { path: "results/demo/claims.md" }, { class: "run-result", extractAtoms: true, rule: 5 }],

	// 6. data and figures
	["figure", { path: "results/demo/fig1.png" }, { class: "run-result", purpose: "intermediate", rule: 6 }],
	[
		"accepted table",
		{ path: "results/demo/de-genes.csv", acceptance: true },
		{ class: "run-result", purpose: "deliverable", rule: 6 },
	],
	["tree", { path: "analysis/tree.nwk" }, { class: "run-result", purpose: "intermediate", rule: 6 }],
	["h5ad outside run dir", { path: "data/atlas.h5ad" }, { class: "run-result", rule: 6 }],

	// 7. cited markdown candidates
	[
		"method report with DOI",
		{ path: "notes/library-prep.md", text: METHOD_REPORT },
		{ class: "knowledge", type: "method", candidate: true, rule: 7 },
	],
	[
		"conclusion report with PMID",
		{ path: "results/demo/review.md", text: CONCLUSION_REPORT },
		{ class: "knowledge", type: "claim", candidate: true, rule: 7 },
	],
	[
		"wikilink counts as a source",
		{
			path: "notes/x.md",
			text: METHOD_REPORT.replace("doi:10.1038/s41586-020-2649-2", "[[Library/Papers/hca]]"),
		},
		{ class: "knowledge", rule: 7 },
	],
	[
		"unsupported vault folder falls through to rule 7",
		{ path: "Projects/demo/Notes/x.md", text: METHOD_REPORT },
		{ class: "knowledge", type: "method", candidate: true, rule: 7 },
	],

	// 8. inquiry records
	[
		"reviewed finding",
		{ origin: { inquiry: { kind: "finding", status: "reviewed" } } },
		{ class: "knowledge", type: "claim", rule: 8 },
	],
	[
		"active decision",
		{ origin: { inquiry: { kind: "decision", status: "active" } } },
		{ class: "knowledge", type: "decision", rule: 8 },
	],

	// 9. fallback
	[
		"unreviewed finding",
		{ origin: { inquiry: { kind: "finding", status: "unreviewed" } } },
		{ class: "ephemeral", rule: 9 },
	],
	[
		"revoked decision",
		{ origin: { inquiry: { kind: "decision", status: "revoked" } } },
		{ class: "ephemeral", rule: 9 },
	],
	[
		"short markdown in a run dir",
		{ path: "results/demo/notes.md", text: "## Methods\nsee doi:10.1000/x" },
		{ class: "run-result", purpose: "intermediate", rule: 9 },
	],
	[
		"uncited long markdown",
		{ path: "notes/x.md", text: `## Methods\n${filler}` },
		{ class: "ephemeral", rule: 9 },
	],
	["markdown without text", { path: "notes/x.md" }, { class: "ephemeral", rule: 9 }],
	["script outside run dir", { path: "scripts/run.py" }, { class: "ephemeral", rule: 9 }],
	["script in run dir flag", { path: "analysis/run.py", inRunDir: true }, { class: "run-result", rule: 9 }],
	["nothing at all", {}, { class: "ephemeral", rule: 9 }],
];

describe("classifyIngest", () => {
	it.each(rows)("%s", (_name, input, expected) => {
		const result = classifyIngest(input);
		expect(result).toMatchObject(expected);
		expect(result.ruleId).toBe(INGEST_RULES[result.rule]);
		expect(result.reasons.length).toBeGreaterThan(0);
	});

	it("requires at least CANDIDATE_MIN_CHARS of body for rule 7", () => {
		const body = `## Methods\nsee doi:10.1000/x\n${"a".repeat(CANDIDATE_MIN_CHARS - 40)}`;
		expect(classifyIngest({ path: "notes/x.md", text: body }).rule).toBe(9);
		expect(classifyIngest({ path: "notes/x.md", text: `${body}${"a".repeat(60)}` }).rule).toBe(7);
	});

	it("does not count frontmatter toward the body length", () => {
		const text = `---\nnote: ${"x".repeat(400)}\n---\n## Methods\ndoi:10.1000/x\n`;
		expect(classifyIngest({ path: "notes/x.md", text }).rule).toBe(9);
	});

	it("ignores unknown frontmatter types and deposit types", () => {
		expect(classifyIngest({ path: "notes/x.md", frontmatter: { type: "journal" } }).rule).toBe(9);
		expect(classifyIngest({ origin: { tool: "research_deposit_knowledge", type: "run" } }).rule).toBe(9);
	});

	it("does not apply Vault folder rules to workspace files", () => {
		expect(classifyIngest({ path: "Library/Papers/x.md", location: "workspace" }).rule).toBe(9);
	});

	it("is deterministic and pure", () => {
		const input: IngestInput = { path: "notes/library-prep.md", text: METHOD_REPORT };
		const snapshot = JSON.stringify(input);
		expect(classifyIngest(input)).toEqual(classifyIngest(input));
		expect(JSON.stringify(input)).toBe(snapshot);
	});
});
