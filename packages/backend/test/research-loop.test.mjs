import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import researchLoopExtension from "../../../.pi/extensions/research-loop.mjs";
import { saveWorkspaceConfig } from "../../../.pi/extensions/workspace-config.mjs";
import { verifyLiteratureReceipt } from "../../../.pi/lib/literature-receipt.mjs";
import {
	completeResearchGate,
	observeResearchReceipt,
	resetResearchReceipts,
	startResearchRun,
	updateResearchLoop,
} from "../../../.pi/lib/research-loop.mjs";
import { createResearchReceiptJournal } from "../../../.pi/lib/research-receipt-journal.mjs";
import { registerResearchToolMeta } from "./tool-manifest-fixture.mjs";

// 回执日志只记账声明了 drone.journal 的工具（挂钩 1）：先让真实扩展登记声明
registerResearchToolMeta();

let journals = [];
let cwd, runDir;
beforeEach(async () => {
	vi.stubEnv("DRONE_KNOWLEDGE_DIR", undefined);
	vi.stubEnv("PI_RESEARCH_DESKTOP_CONFIG", undefined);
	cwd = await realpath(await mkdtemp(join(tmpdir(), "drone-research-loop-")));
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
	for (const j of journals) await j.close();
	journals = [];
	resetResearchReceipts({ cwd, runDir });
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
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
	await expect(completeResearchGate({ cwd, runDir })).rejects.toThrow("explicit claim_refs");
	const done = await completeResearchGate({
		cwd,
		runDir,
		claimRefs: ["Explicit limited claim -> https://example.test/p"],
	});
	expect(done.evidence_gate.stage).toBe("answerable");
	expect(done.evidence_gate.answerable).toBe(true);
	expect(done.evidence_gate.archive_count).toBe(1);
	expect(done.evidence_gate.claim_refs[0]).toMatch(/^Explicit limited claim/);
});

it("archive download receipts record acquisition but never auto-bind claims or finalize", async () => {
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
	expect(observed.evidence_gate.stage).toBe("sources_archived");
	expect(observed.evidence_gate.answerable).toBe(false);
	expect(observed.evidence_gate.claim_refs).toEqual([]);
	const metadata = JSON.parse(await readFile(join(runDir, "metadata.json"), "utf8"));
	expect(metadata.evidence_gate.stage).toBe("sources_archived");
});

async function localPaper(name = "paper", key = "ABCDEFGH") {
	const vault = join(cwd, "Vault");
	await mkdir(join(vault, "Library/Papers"), { recursive: true });
	await saveWorkspaceConfig(cwd, { obsidianVault: vault });
	const path = `Library/Papers/${name}.md`,
		doi = `10.1038/${name}`;
	const text = `# Paper\n${doi}\nzotero:${key}\nResult and limitations.`;
	await writeFile(join(vault, path), text);
	const hash = createHash("sha256").update(text).digest("hex");
	vi.stubGlobal("fetch", async (url) => ({
		ok: true,
		json: async () => (url.endsWith("/children") ? [] : { data: { DOI: doi } }),
	}));
	const proof = await verifyLiteratureReceipt({ doi, zotero_key: key, note_path: path, vault });
	return { vault, path, text, hash, proof };
}
async function noteRead(p, overrides = {}) {
	return observeResearchReceipt({
		cwd,
		runDir,
		toolName: "research_read_knowledge",
		args: { path: p.path },
		details: { path: p.path, text: p.text, hash: p.hash, startLine: 1, endLine: 4, ...overrides },
	});
}
async function identity(p, overrides = {}) {
	return observeResearchReceipt({
		cwd,
		runDir,
		toolName: "research_verify_literature",
		details: { ...p.proof, ...overrides },
	});
}
it("reuses actual current-turn note reads without pretending to archive PDFs", async () => {
	const p = await localPaper();
	await noteRead(p);
	await identity(p);
	await expect(completeResearchGate({ cwd, runDir })).rejects.toThrow("explicit claim_refs");
	const done = await completeResearchGate({
		cwd,
		runDir,
		claimRefs: ["Limited method claim -> Library/Papers/paper.md section Result"],
	});
	expect(done.evidence_gate).toMatchObject({
		answerable: true,
		archive_count: 0,
		reuse_count: 1,
		scientificallyVerified: false,
	});
	expect(done.evidence_gate.reused_sources[0]).toMatchObject({
		hash: p.hash,
		fulltext_status: "metadata-only",
		originalFulltextReadThisTurn: false,
	});
});
it("identity alone, Wiki and empty read ranges do not establish reuse", async () => {
	const p = await localPaper();
	await identity(p);
	await expect(completeResearchGate({ cwd, runDir, claimRefs: ["claim"] })).rejects.toThrow();
	await noteRead(p, { text: "" });
	await expect(updateResearchLoop({ cwd, runDir, action: "verify_archive" })).rejects.toThrow(
		"No available source",
	);
	await noteRead(p, { startLine: 20, endLine: 19 });
	await expect(updateResearchLoop({ cwd, runDir, action: "verify_archive" })).rejects.toThrow(
		"No available source",
	);
});
it("changed or replayed notes cannot finalize with old receipts", async () => {
	const p = await localPaper();
	await noteRead(p);
	await identity(p);
	await writeFile(join(p.vault, p.path), `${p.text} Changed`);
	await expect(completeResearchGate({ cwd, runDir, claimRefs: ["claim"] })).rejects.toThrow("changed");
	await writeFile(join(p.vault, p.path), p.text);
	resetResearchReceipts({ cwd, runDir });
	await expect(completeResearchGate({ cwd, runDir, claimRefs: ["claim"] })).rejects.toThrow(
		"receipt is missing",
	);
});
it("binding changes cannot reuse a same-named note", async () => {
	const p = await localPaper();
	await noteRead(p);
	await identity(p);
	const other = join(cwd, "OtherVault");
	await mkdir(join(other, "Library/Papers"), { recursive: true });
	await writeFile(join(other, p.path), p.text);
	await saveWorkspaceConfig(cwd, { obsidianVault: other });
	await expect(completeResearchGate({ cwd, runDir, claimRefs: ["claim"] })).rejects.toThrow("changed");
});
it("failed or partial dual-library results do not count", async () => {
	const p = await localPaper();
	await noteRead(p);
	await identity(p, { status: "partial" });
	await expect(updateResearchLoop({ cwd, runDir, action: "verify_archive" })).rejects.toThrow(
		"No available source",
	);
});
it("parallel real receipts retain all source refs rather than last-writer-wins", async () => {
	const a = await localPaper("a", "ABCDEFGH"),
		b = await localPaper("b", "BCDEFGHJ");
	vi.stubGlobal("fetch", async (url) => ({
		ok: true,
		json: async () =>
			url.endsWith("/children")
				? []
				: { data: { DOI: url.includes("ABCDEFGH") ? "10.1038/a" : "10.1038/b" } },
	}));
	await Promise.all([noteRead(a), noteRead(b), identity(a), identity(b)]);
	const done = await completeResearchGate({ cwd, runDir, claimRefs: ["claim a", "claim b"] });
	expect(done.evidence_gate.reuse_count).toBe(2);
	expect(done.evidence_gate.source_refs).toEqual(expect.arrayContaining([a.path, b.path]));
});
it("live API failure after successful identity verification invalidates reuse", async () => {
	const p = await localPaper();
	await noteRead(p);
	await identity(p);
	vi.stubGlobal("fetch", async () => {
		throw new Error("offline");
	});
	await expect(completeResearchGate({ cwd, runDir, claimRefs: ["claim"] })).rejects.toThrow("changed");
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

function journal() {
	const j = createResearchReceiptJournal(cwd);
	journals.push(j);
	return j;
}
function readEvent(p, id = "read") {
	return {
		toolCallId: id,
		toolName: "research_read_knowledge",
		args: { path: p.path },
		details: { path: p.path, text: p.text, hash: p.hash, startLine: 1, endLine: 4 },
	};
}
function verifyEvent(p, id = "verify") {
	return { toolCallId: id, toolName: "research_verify_literature", args: {}, details: p.proof };
}
async function attachJournal(j) {
	return j.execute(runDir, () => updateResearchLoop({ cwd, runDir, action: "status" }));
}
async function finishJournal(j) {
	return j.execute(runDir, () =>
		completeResearchGate({ cwd, runDir, claimRefs: ["Limited claim -> Library/Papers/paper.md Result"] }),
	);
}
it.each(["read-before-start", "verify-before-read", "start-before-read", "parallel"])(
	"journal supports legitimate order %s without rereading",
	async (order) => {
		const p = await localPaper(),
			j = journal();
		if (order === "start-before-read") await attachJournal(j);
		if (order === "verify-before-read") {
			await j.record(verifyEvent(p));
			await j.record(readEvent(p));
		} else if (order === "parallel")
			await Promise.all([j.record(readEvent(p)), j.record(verifyEvent(p)), attachJournal(j)]);
		else {
			await j.record(readEvent(p));
			await j.record(verifyEvent(p));
		}
		await attachJournal(j);
		const done = await finishJournal(j);
		expect(done.evidence_gate).toMatchObject({ answerable: true, archive_count: 0, reuse_count: 1 });
		expect(done.receipt_journal.buffered).toBe(2);
		expect(done.evidence_gate.reused_sources[0].evidence_profile).toMatchObject({
			identity: "both-verified",
			reading: { kind: "literature-note", scope: "current-turn" },
			claimSupport: "not-assessed",
		});
	},
);
it("journal rejects cross-session run ownership without erasing the first session's proof", async () => {
	const p = await localPaper(),
		a = journal(),
		b = journal();
	await a.record(readEvent(p));
	await a.record(verifyEvent(p));
	await attachJournal(a);
	await expect(attachJournal(b)).rejects.toThrow("another active session");
	expect((await finishJournal(a)).evidence_gate.answerable).toBe(true);
});
it("new turn cannot use old or late completed receipts", async () => {
	const p = await localPaper(),
		old = journal();
	await old.record(readEvent(p));
	await old.record(verifyEvent(p));
	await attachJournal(old);
	await old.close();
	await old.record(readEvent(p, "late"));
	const next = journal();
	await attachJournal(next);
	await expect(finishJournal(next)).rejects.toThrow("receipt is missing");
});
it("binding changes between buffered reading and run creation invalidate the receipt", async () => {
	const p = await localPaper(),
		j = journal();
	await j.record(readEvent(p));
	const other = join(cwd, "OtherVault");
	await mkdir(join(other, "Library/Papers"), { recursive: true });
	await writeFile(join(other, p.path), p.text);
	await saveWorkspaceConfig(cwd, { obsidianVault: other });
	const proof = await verifyLiteratureReceipt({
		doi: p.proof.doi,
		zotero_key: p.proof.zoteroKey,
		note_path: p.path,
		vault: other,
	});
	await j.record(verifyEvent({ ...p, proof }));
	await attachJournal(j);
	await expect(finishJournal(j)).rejects.toThrow("No available source");
});
it("failed receipts and repeat completion events do not inflate the journal", async () => {
	const p = await localPaper(),
		j = journal();
	await j.record({ ...readEvent(p, "failed"), isError: true });
	await Promise.all([j.record(readEvent(p)), j.record(readEvent(p)), j.record(verifyEvent(p))]);
	const done = await finishJournal(j);
	expect(done.receipt_journal.buffered).toBe(2);
	expect(done.evidence_gate.reuse_count).toBe(1);
});
it("buffered note changes before attachment are not accepted", async () => {
	const p = await localPaper(),
		j = journal();
	await j.record(readEvent(p));
	await j.record(verifyEvent(p));
	await writeFile(join(p.vault, p.path), `${p.text} changed`);
	await attachJournal(j);
	await expect(finishJournal(j)).rejects.toThrow("No available source");
});
it("extension captures tool events before start, returns current state, and ignores old-turn completions", async () => {
	const p = await localPaper(),
		hooks = new Map();
	let tool;
	const ctx = { cwd, sessionId: "fixture-session" };
	researchLoopExtension({
		registerTool(t) {
			tool = t;
		},
		on(name, fn) {
			if (!hooks.has(name)) hooks.set(name, []);
			hooks.get(name).push(fn);
		},
	});
	const emit = async (name, event) => {
		for (const fn of hooks.get(name) || []) await fn(event, ctx);
	};
	await emit("before_agent_start", { systemPrompt: "" });
	await emit("message_start", { message: { role: "user", content: "first question" } });
	const native = async (event) => {
		await emit("tool_execution_start", { ...event, args: event.args });
		await emit("tool_execution_end", { ...event, result: { details: event.details } });
	};
	try {
		await native(readEvent(p));
		await native(verifyEvent(p));
		const start = await tool.execute(
			"start",
			{ action: "start", query: "Existing literature", result_slug: "extension-order" },
			null,
			null,
			ctx,
		);
		runDir = start.details.run_dir;
		expect(start.details.evidence_gate.reuse_count).toBe(1);
		const done = await tool.execute(
			"complete",
			{ action: "complete", run_dir: runDir, claim_refs: ["Limited claim -> paper.md"] },
			null,
			null,
			ctx,
		);
		expect(done.details.evidence_gate.answerable).toBe(true);
		expect(JSON.parse(done.content[0].text).evidence_gate.events).toBeUndefined();
		await emit("message_start", { message: { role: "user", content: "queued different question" } });
		await expect(
			tool.execute(
				"queued-complete",
				{ action: "complete", run_dir: runDir, claim_refs: ["claim"] },
				null,
				null,
				ctx,
			),
		).rejects.toThrow("receipt is missing");
		await emit("tool_execution_start", readEvent(p, "late"));
		await emit("before_agent_start", { systemPrompt: "" });
		await emit("tool_execution_end", { ...readEvent(p, "late"), result: { details: readEvent(p).details } });
		await expect(
			tool.execute("again", { action: "complete", run_dir: runDir, claim_refs: ["claim"] }, null, null, ctx),
		).rejects.toThrow("receipt is missing");
	} finally {
		await emit("session_shutdown", {});
	}
});

it("run-owned archive receipts accept canonical relative paths without crossing runs", async () => {
	await seedArchive();
	const j = journal();
	await attachJournal(j);
	await j.record({
		toolName: "research_archive_source",
		toolCallId: "archive",
		args: { run_dir: relative(cwd, runDir), url: "https://example.test/p" },
		details: { status: "downloaded", path: join(runDir, "sources/papers/paper.pdf") },
	});
	const status = await attachJournal(j);
	expect(status.evidence_gate.archive_count).toBe(1);
	expect(status.evidence_gate.answerable).toBe(false);
});
it("closing an old journal twice cannot erase a newer turn's receipts", async () => {
	const p = await localPaper(),
		old = journal();
	await attachJournal(old);
	await old.close();
	const next = journal();
	await next.record(readEvent(p));
	await next.record(verifyEvent(p));
	await attachJournal(next);
	await old.close();
	expect((await finishJournal(next)).evidence_gate.answerable).toBe(true);
});

it("complete persists structured excerpt bindings and labels legacy compatibility", async () => {
	const p = await localPaper();
	await noteRead(p);
	await identity(p);
	const done = await completeResearchGate({
		cwd,
		runDir,
		claimBindings: [
			{
				claim: "Limited finding",
				relationship: "direct",
				organism: "test",
				method: "test",
				limitations: "fixture only",
				sources: [{ path: p.path, start_line: 4, end_line: 4, quote: "Result and limitations." }],
			},
		],
	});
	expect(done.evidence_gate.claim_bindings[0]).toMatchObject({
		provenanceChecked: true,
		scientificallyVerified: false,
	});
	expect(done.evidence_gate.warnings).toEqual([]);
	await expect(
		completeResearchGate({
			cwd,
			runDir,
			claimBindings: [
				{
					claim: "fake",
					relationship: "direct",
					limitations: "none",
					sources: [{ path: p.path, start_line: 4, end_line: 4, quote: "fabricated" }],
				},
			],
		}),
	).rejects.toThrow("quote");
});

it("reconciliation's live verification receipt is accepted without a redundant identity tool call", async () => {
	const p = await localPaper(),
		j = journal();
	await j.record(readEvent(p));
	await j.record({
		toolName: "research_reconcile_literature",
		toolCallId: "reconcile",
		args: { run_dir: runDir },
		details: { receipt: p.proof, status: "both-identities-verified", writesToLibraries: 0 },
	});
	const done = await finishJournal(j);
	expect(done.evidence_gate).toMatchObject({ answerable: true, reuse_count: 1, archive_count: 0 });
	expect(done.receipt_journal.buffered).toBe(2);
});
