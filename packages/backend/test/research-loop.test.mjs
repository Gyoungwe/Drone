import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
	completeResearchGate,
	observeResearchReceipt,
	startResearchRun,
	updateResearchLoop,
} from "../../../.pi/lib/research-loop.mjs";

let cwd, runDir;
beforeEach(async () => {
	cwd = await realpath(await mkdtemp(join(tmpdir(), "percho-research-loop-")));
	await mkdir(join(cwd, "results"), { recursive: true });
	const started = await startResearchRun({
		cwd,
		project: "research-workbench",
		resultSlug: "loop-fixture",
		query: "How does DESeq2 normalize counts?",
	});
	runDir = started.run_dir;
});
afterEach(async () => {
	await rm(cwd, { recursive: true, force: true });
});

async function seedArchive() {
	const sources = join(runDir, "sources");
	await mkdir(join(sources, "papers"), { recursive: true });
	const file = join(sources, "papers", "paper.pdf");
	await writeFile(file, "fixture-pdf");
	await writeFile(
		join(sources, "download-manifest.json"),
		`${JSON.stringify({
			items: [
				{ id: "src-1", status: "downloaded", sha256: "abc", path: file, url: "https://example.test/p" },
			],
			failures: [],
		})}\n`,
	);
}

it("records a successful knowledge search as the local query without a manual research_loop call", async () => {
	const observed = await observeResearchReceipt({
		cwd,
		runDir,
		toolName: "research_search_knowledge",
		args: { query: "DESeq2 size factors" },
		details: { query: "DESeq2 size factors", complete: true, hits: [{ path: "Library/Methods/deseq2.md" }] },
	});
	expect(observed.evidence_gate.stage).toBe("local_query_recorded");
});

it("advances inspection from a non-Wiki read and does not throw without a prior web search", async () => {
	await observeResearchReceipt({
		cwd,
		runDir,
		toolName: "research_search_knowledge",
		args: { query: "DESeq2" },
		details: { complete: true, query: "DESeq2" },
	});
	const observed = await observeResearchReceipt({
		cwd,
		runDir,
		toolName: "research_read_knowledge",
		args: { path: "Library/Methods/deseq2.md" },
		details: { path: "Library/Methods/deseq2.md", missing: false },
	});
	expect(observed.evidence_gate.stage).toBe("sources_inspected");
	expect(observed.evidence_gate.source_refs).toContain("Library/Methods/deseq2.md");
});

it("ignores Wiki reads and failed tools", async () => {
	expect(
		await observeResearchReceipt({
			cwd,
			runDir,
			toolName: "research_read_knowledge",
			args: { path: "Wiki/rna-seq.md" },
			details: { path: "Wiki/rna-seq.md" },
		}),
	).toBeNull();
	expect(
		await observeResearchReceipt({
			cwd,
			runDir,
			toolName: "research_search_knowledge",
			args: { query: "x" },
			isError: true,
		}),
	).toBeNull();
});

it("closes the gate in one host-serial complete after a verified archive", async () => {
	await seedArchive();
	await updateResearchLoop({
		cwd,
		runDir,
		action: "record_local",
		query: "DESeq2",
	});
	await updateResearchLoop({
		cwd,
		runDir,
		action: "record_external",
		notes: "used local notes",
	});
	await updateResearchLoop({
		cwd,
		runDir,
		action: "inspect_sources",
		sourceRefs: ["https://example.test/p"],
	});
	const done = await completeResearchGate({ cwd, runDir });
	expect(done.evidence_gate.stage).toBe("answerable");
	expect(done.evidence_gate.answerable).toBe(true);
	expect(done.evidence_gate.archive_count).toBe(1);
	expect(done.evidence_gate.claim_refs[0]).toMatch(/^Observed:/);
});

it("archive download receipts inspect, verify and complete without parallel research_loop calls", async () => {
	await seedArchive();
	const observed = await observeResearchReceipt({
		cwd,
		runDir,
		toolName: "research_archive_source",
		args: { run_dir: runDir, url: "https://example.test/p", category: "papers" },
		details: {
			status: "downloaded",
			path: join(runDir, "sources", "papers", "paper.pdf"),
			url: "https://example.test/p",
		},
	});
	expect(observed.evidence_gate.stage).toBe("answerable");
	expect(observed.evidence_gate.answerable).toBe(true);
	const metadata = JSON.parse(await readFile(join(runDir, "metadata.json"), "utf8"));
	expect(metadata.evidence_gate.stage).toBe("answerable");
});

it("a missing run does not throw into the tool pipeline", async () => {
	await expect(
		observeResearchReceipt({
			cwd,
			runDir: join(cwd, "results", "loop-fixture", "run-missing"),
			toolName: "research_search_knowledge",
			args: { query: "x" },
			details: { complete: true },
		}),
	).resolves.toBeNull();
});
