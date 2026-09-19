import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { advisoryLine, registerAnswerPublication } from "../../../.pi/lib/knowledge/publication.mjs";
import { closeKnowledgeServices, getKnowledgeService } from "../../../.pi/lib/knowledge/service.mjs";
import { configureObsidian } from "../../../.pi/lib/obsidian-workbench.mjs";

let root, cwd, vault, service, prep;
async function note(path, text) {
	await mkdir(join(vault, path, ".."), { recursive: true });
	await writeFile(join(vault, path), text);
}
beforeEach(async () => {
	// Preserve the prior mandatory workflow as explicit strict-mode coverage.
	vi.stubEnv("DRONE_REVIEW_MODE", "strict");
	root = await realpath(await mkdtemp(join(tmpdir(), "drone-publication-")));
	cwd = join(root, "project");
	vault = join(root, "Vault");
	await mkdir(cwd);
	vi.stubEnv("DRONE_KNOWLEDGE_DIR", join(root, "app"));
	vi.stubEnv("PI_RESEARCH_DESKTOP_CONFIG", undefined);
	vi.stubEnv("PI_SUBAGENT_CHILD", undefined);
	await configureObsidian({ cwd, vault, project: "project-a" });
	await note("Wiki/Index.md", "# Topics\n[[Wiki/Autotomy]]\n");
	await note("Wiki/Autotomy.md", "# Autotomy\nRead the underlying evidence.\n[[Library/Papers/source]]\n");
	await note("Library/Papers/source.md", "# Autotomy evidence\nObservation under specific conditions.\n");
	service = await getKnowledgeService();
	prep = await service.prepare({ cwd, project: "project-a", query: "Autotomy" });
	await service.request("reconcile");
});
afterEach(async () => {
	await closeKnowledgeServices();
	vi.unstubAllEnvs();
	await rm(root, { recursive: true, force: true });
});
const answer = "Evidence is conditional. [[Library/Papers/source]]";
async function searchAndRead() {
	await service.read(prep.ticket, cwd, { path: "Wiki/Autotomy.md" });
	// This helper establishes a *complete* baseline before testing later invalidation.
	await vi.waitFor(
		async () => expect((await service.search(prep.ticket, cwd, { query: "Autotomy" })).complete).toBe(true),
		{ timeout: 2000 },
	);
	await service.read(prep.ticket, cwd, { path: "Library/Papers/source.md" });
}
describe("native answer readiness, not model self-certification", () => {
	it("publishes a bounded evidence ledger for 17 citations instead of losing all receipts", async () => {
		vi.stubEnv("DRONE_REVIEW_MODE", "automatic");
		const paths = Array.from({ length: 17 }, (_, i) => `Library/Papers/wing-${i}.md`);
		for (const path of paths) await note(path, `# Wing development\nEvidence ${path}`);
		await service.request("reconcile");
		await service.search(prep.ticket, cwd, { query: "Wing development" });
		for (const path of paths) await service.read(prep.ticket, cwd, { path });
		const events = new Map();
		const gate = registerAnswerPublication(
			{ on: (name, handler) => events.set(name, handler) },
			{
				getCurrent: () => ({ service, ticket: prep.ticket }),
			},
		);
		gate.begin(true);
		const text = paths.map((path) => `[[${path}]]`).join(" ");
		const preflight = await gate.preflight({ cwd }, text);
		expect(preflight.sources).toHaveLength(12);
		expect(preflight.unverifiedCitations).toEqual(paths.slice(12));
		const result = await events.get("message_end")(
			{ message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text }], timestamp: 1 } },
			{ cwd },
		);
		const proof = result.message.knowledgePublication;
		expect(proof).toMatchObject({
			status: "released",
			citationCount: 17,
			citationLimit: 12,
			unverifiedCitationCount: 5,
			vaultId: service.binding.vaultId,
		});
		expect(proof.sources.map((item) => item.path)).toEqual(paths.slice(0, 12));
		expect(proof.deliveries).toEqual([]);
		expect(proof.unverifiedCitations).toEqual(paths.slice(12));
		expect(proof.scientificallyVerified).toBe(false);
		const notice = result.message.content.map((item) => item.text).join(" ");
		expect(notice).toContain("17");
		expect(notice).toContain("12");
		expect(notice).toContain("5");
		expect(notice).not.toContain("请拆分");
	});
	it("an unread early citation does not erase later verified sources or delivery receipts", async () => {
		await searchAndRead();
		await note("Library/Explainers/delivery.md", "# Generated explanation\nOutput, not evidence.");
		const delivery = await service.deliveryReceipt(
			prep.ticket,
			cwd,
			join(vault, "Library/Explainers/delivery.md"),
		);
		const text = `[[Library/Papers/not-read]] ${answer} [[Library/Explainers/delivery]]`;
		const failure = await service
			.validateAnswer(prep.ticket, cwd, text, { deliveries: [delivery] })
			.catch((error) => error);
		expect(failure.code).toBe("source-unread");
		expect(failure.verified.sources.map((item) => item.path)).toEqual(["Library/Papers/source.md"]);
		expect(failure.verified.deliveries).toEqual([delivery]);
		expect(failure.verified.unverifiedCitations).toEqual(["Library/Papers/not-read.md"]);
		expect(failure.verified.unverifiedCitationCount).toBe(1);
	});
	it.each(["search-required", "coverage-incomplete"])(
		"%s still records citations that can be matched to current reads",
		async (code) => {
			await searchAndRead();
			const state = await service.check(prep.ticket, cwd);
			if (code === "search-required") state.answerSearch = null;
			else state.answerSearch = { ...state.answerSearch, complete: false };
			const failure = await service.validateAnswer(prep.ticket, cwd, answer).catch((error) => error);
			expect(failure.code).toBe(code);
			expect(failure.verified.sources.map((item) => item.path)).toEqual(["Library/Papers/source.md"]);
			expect(failure.verified.unverifiedCitations).toEqual([]);
			expect(advisoryLine(code, failure)).not.toContain("请重新");
		},
	);
	it.each(["source-changed", "delivery-changed", "citation-invalid"])(
		"%s keeps later current evidence and excludes the failed citation",
		async (code) => {
			await searchAndRead();
			let path = "Library/../outside.md";
			const deliveries = [];
			if (code !== "citation-invalid") {
				path = code === "delivery-changed" ? "Library/Explainers/result.md" : "Library/Papers/changed.md";
				await note(path, "# Original version");
				if (code === "delivery-changed")
					deliveries.push(await service.deliveryReceipt(prep.ticket, cwd, join(vault, path)));
				else await service.read(prep.ticket, cwd, { path });
				await note(path, "# Changed version");
			}
			const failure = await service
				.validateAnswer(prep.ticket, cwd, `[[${path}]] ${answer}`, { deliveries })
				.catch((error) => error);
			expect(failure.code).toBe(code);
			expect(failure.verified.sources.map((item) => item.path)).toEqual(["Library/Papers/source.md"]);
			expect(failure.verified.deliveries).toEqual([]);
			expect(failure.verified.unverifiedCitations).toEqual([path]);
			expect(failure.verified).toMatchObject({
				citationCount: 2,
				unverifiedCitationCount: 1,
				scientificallyVerified: false,
			});
		},
	);
	it("strict publication still blocks an over-budget answer after collecting evidence", async () => {
		await searchAndRead();
		const extra = Array.from({ length: 12 }, (_, i) => `[[Library/Papers/unread-${i}]]`).join(" ");
		const text = `${answer} ${extra}`;
		const failure = await service.validateAnswer(prep.ticket, cwd, text).catch((error) => error);
		expect(failure.code).toBe("citation-budget");
		expect(failure.verified.sources).toHaveLength(1);
		expect(failure.verified.unverifiedCitationCount).toBe(12);
		const events = new Map();
		const gate = registerAnswerPublication(
			{ on: (name, handler) => events.set(name, handler) },
			{
				getCurrent: () => ({ service, ticket: prep.ticket }),
			},
		);
		gate.begin(true);
		const result = await events.get("message_end")(
			{ message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text }], timestamp: 1 } },
			{ cwd },
		);
		expect(result.message.knowledgePublication.status).toBe("blocked");
		expect(result.message.content).not.toEqual([{ type: "text", text }]);
	});
	it("rejects a direct answer after navigation alone", async () => {
		await expect(service.validateAnswer(prep.ticket, cwd, answer)).rejects.toThrow("search");
	});
	it("host search from the turn query records evidence before citation checks", async () => {
		await expect(service.validateAnswer(prep.ticket, cwd, "no citations")).rejects.toThrow("search");
		await vi.waitFor(
			async () =>
				expect((await service.ensureAnswerSearch(prep.ticket, cwd, "Autotomy")).complete).toBe(true),
			{ timeout: 2000 },
		);
		await expect(service.validateAnswer(prep.ticket, cwd, "no citations")).rejects.toThrow("citation");
		const paths = await service.materializeCitations(prep.ticket, cwd, "Autotomy");
		expect(paths.length).toBeGreaterThan(0);
		expect(
			(
				await service.validateAnswer(
					prep.ticket,
					cwd,
					`Conditional.\n\n依据：${paths.map((path) => `[[${path.replace(/\.md$/i, "")}]]`).join(" ")}`,
				)
			).status,
		).toBe("ready");
	});
	it("rejects discovery-only search and unread evidence citations", async () => {
		await service.search(prep.ticket, cwd, { query: "Autotomy", wikiOnly: true });
		await expect(service.validateAnswer(prep.ticket, cwd, answer)).rejects.toThrow("search");
		await vi.waitFor(
			async () => expect((await service.search(prep.ticket, cwd, { query: "Autotomy" })).complete).toBe(true),
			{ timeout: 2000 },
		);
		await expect(service.validateAnswer(prep.ticket, cwd, answer)).rejects.toThrow("read");
		await service.read(prep.ticket, cwd, { path: "Library/Papers/source.md" });
		expect((await service.validateAnswer(prep.ticket, cwd, answer)).status).toBe("ready");
	});
	it("accepts a current cited source only after actual search and read", async () => {
		await searchAndRead();
		const proof = await service.validateAnswer(prep.ticket, cwd, answer);
		expect(proof.status).toBe("ready");
		expect(proof.scientificallyVerified).toBe(false);
		expect(proof.sources[0].path).toBe("Library/Papers/source.md");
	});
	it("rejects nonexistent citations and an uncited answer after hits", async () => {
		await searchAndRead();
		await expect(service.validateAnswer(prep.ticket, cwd, "Invented [[Library/fake]]")).rejects.toThrow(
			"read",
		);
		await expect(
			service.validateAnswer(prep.ticket, cwd, "A confident claim without provenance."),
		).rejects.toThrow("citation");
	});
	it("evidence search opens linked Wiki and top hits so citations can be attached", async () => {
		const found = await vi.waitFor(
			async () => {
				const value = await service.search(prep.ticket, cwd, { query: "Autotomy" });
				expect(value.complete).toBe(true);
				return value;
			},
			{ timeout: 2000 },
		);
		expect(found.hits.length).toBeGreaterThan(0);
		const paths = await service.citationCandidates(prep.ticket, cwd);
		expect(paths).toContain("Wiki/Autotomy.md");
		const proof = await service.validateAnswer(
			prep.ticket,
			cwd,
			`Conditional observation.\n\n依据：${paths.map((path) => `[[${path.replace(/\.md$/i, "")}]]`).join(" ")}`,
		);
		expect(proof.status).toBe("ready");
		expect(proof.scientificallyVerified).toBe(false);
	});
	it("rejects changed sources even when a model repeats the old claim", async () => {
		await searchAndRead();
		await note("Library/Papers/source.md", "# Corrected observation\n");
		await expect(service.validateAnswer(prep.ticket, cwd, answer)).rejects.toThrow(/changed|revision/);
	});
	it("drains redundant watcher notifications without accepting a new index revision", async () => {
		await searchAndRead();
		const before = (await service.request("status")).revision;
		await note("Library/Papers/source.md", "# Autotomy evidence\nObservation under specific conditions.\n");
		await vi.waitFor(
			async () => {
				const proof = await service.validateAnswer(prep.ticket, cwd, answer);
				expect(proof.status).toBe("ready");
				expect(proof.indexRevision).toBe(before);
			},
			{ timeout: 2000 },
		);
	});

	it("rejects old search receipts after new indexed evidence arrives", async () => {
		await searchAndRead();
		await note("Library/Papers/new.md", "# New contradictory Autotomy evidence\n");
		await service.request("changed", { paths: ["Library/Papers/new.md"] });
		await expect(service.validateAnswer(prep.ticket, cwd, answer)).rejects.toThrow("revision");
	});
	it("host materialization can refresh a stale current-turn search without weakening strict validation", async () => {
		await searchAndRead();
		const before = await service.validateAnswer(prep.ticket, cwd, answer);
		await note("Library/Papers/new.md", "# New Autotomy evidence\nA later indexed observation.\n");
		await service.request("changed", { paths: ["Library/Papers/new.md"] });
		// Let the filesystem watcher coalesce its duplicate notification so this test exercises
		// stale-search refresh, not scheduler timing. Publication-level tests cover the late-event race.
		await new Promise((resolve) => setTimeout(resolve, 250));
		await vi.waitFor(async () => expect((await service.request("status")).pendingChanges).toBe(0));
		await expect(service.validateAnswer(prep.ticket, cwd, answer)).rejects.toThrow("revision");
		const paths = await service.materializeCitations(prep.ticket, cwd, "Autotomy", { refresh: true });
		expect(paths.length).toBeGreaterThan(0);
		const after = await service.validateAnswer(prep.ticket, cwd, answer);
		expect(after.status).toBe("ready");
		expect(after.indexRevision).toBeGreaterThan(before.indexRevision);
	});
	it("distinguishes complete zero hits from missing/partial coverage", async () => {
		await service.read(prep.ticket, cwd, { path: "Wiki/Autotomy.md" });
		await vi.waitFor(
			async () =>
				expect((await service.search(prep.ticket, cwd, { query: "notpresentuniquetoken" })).complete).toBe(
					true,
				),
			{ timeout: 2000 },
		);
		expect(
			(await service.validateAnswer(prep.ticket, cwd, "There were no hits for this query.")).status,
		).toBe("no-hits");
		await note("Library/too-big.md", "x".repeat(1024 * 1024 + 1));
		await service.request("reconcile");
		await service.search(prep.ticket, cwd, { query: "notpresentuniquetoken" });
		await expect(service.validateAnswer(prep.ticket, cwd, "No evidence exists.")).rejects.toThrow(
			/complete|coverage/,
		);
	});
	it("does not let a failed newer search reuse a previous success", async () => {
		await searchAndRead();
		await expect(service.search(prep.ticket, cwd, { query: "" })).rejects.toThrow();
		await expect(service.validateAnswer(prep.ticket, cwd, answer)).rejects.toThrow("search");
	});
	it("rejects foreign project tickets and new turn receipts do not inherit old searches", async () => {
		await searchAndRead();
		await expect(service.validateAnswer(prep.ticket, join(root, "other"), answer)).rejects.toThrow(
			"navigation",
		);
		const next = await service.prepare({ cwd, project: "project-a", query: "a new question" });
		await expect(service.validateAnswer(next.ticket, cwd, answer)).rejects.toThrow("search");
	});
});
