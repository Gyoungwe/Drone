import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readKnowledgeBinding } from "../../../.pi/lib/knowledge/config.mjs";
import { embedTexts, validateSemanticConfig } from "../../../.pi/lib/knowledge/semantic-provider.mjs";
import { readSemanticSettings } from "../../../.pi/lib/knowledge/semantic-settings.mjs";
import { closeKnowledgeServices, KnowledgeService } from "../../../.pi/lib/knowledge/service.mjs";
import { configureObsidian } from "../../../.pi/lib/obsidian-workbench.mjs";

let root, vault, cwd, app;
beforeEach(async () => {
	root = await realpath(await mkdtemp(join(tmpdir(), "drone-semantic-")));
	vault = join(root, "Vault");
	cwd = join(root, "project");
	app = join(root, "app");
	await mkdir(cwd);
	vi.stubEnv("DRONE_KNOWLEDGE_DIR", app);
	vi.stubEnv("PI_RESEARCH_DESKTOP_CONFIG", undefined);
});
afterEach(async () => {
	await closeKnowledgeServices();
	vi.unstubAllEnvs();
	await rm(root, { recursive: true, force: true });
});
async function note(path, text) {
	await mkdir(join(vault, path, ".."), { recursive: true });
	await writeFile(join(vault, path), text);
}
async function fakeEmbeddings(handler = null) {
	const calls = [];
	const server = createServer(async (req, res) => {
		const body = await new Promise((resolve) => {
			let text = "";
			req.on("data", (part) => {
				text += part;
			});
			req.on("end", () => resolve(JSON.parse(text)));
		});
		calls.push({ path: req.url, body, authorization: req.headers.authorization });
		if (handler) return handler(req, res, body);
		const vectors = body.input.map((text) => (/butterfly|lepidoptera/i.test(text) ? [1, 0] : [0, 1]));
		res.setHeader("content-type", "application/json");
		res.end(
			req.url.endsWith("/api/embed")
				? JSON.stringify({ embeddings: vectors })
				: JSON.stringify({ data: vectors.map((embedding, index) => ({ index, embedding })) }),
		);
	});
	try {
		await new Promise((resolve, reject) => {
			server.once("error", reject);
			server.listen(0, "127.0.0.1", resolve);
		});
	} catch (error) {
		if (error?.code === "EPERM") return null; // Restricted sandboxes may prohibit loopback listeners.
		throw error;
	}
	const port = server.address().port;
	return {
		calls,
		baseUrl: `http://127.0.0.1:${port}/base`,
		close: () => new Promise((resolve) => server.close(resolve)),
	};
}

describe("semantic HTTP adapter", () => {
	it("rejects unknown fields/types and preserves explicitly disabled configured providers", () => {
		expect(() => validateSemanticConfig({ provider: "mystery" })).toThrow("Unknown semantic provider");
		expect(() =>
			validateSemanticConfig({
				provider: "ollama",
				baseUrl: "http://127.0.0.1:1",
				model: "m",
				remoteConsent: "true",
			}),
		).toThrow("boolean");
		expect(() =>
			validateSemanticConfig({
				provider: "ollama",
				baseUrl: "http://127.0.0.1:1",
				model: "m",
				enabled: "false",
			}),
		).toThrow("enabled");
		expect(() =>
			validateSemanticConfig({ provider: "ollama", enabled: false, credential: "raw-key" }),
		).toThrow("Unknown semantic setting");
		expect(() => validateSemanticConfig({ provider: "ollama", enabled: false, minSimilarity: 1.1 })).toThrow(
			"minSimilarity",
		);
		expect(validateSemanticConfig({ provider: "ollama", enabled: false })).toMatchObject({
			enabled: false,
			provider: "ollama",
		});
	});
	it("rejects coercible and overflowing vectors", async () => {
		const fake = await fakeEmbeddings((_req, res) => {
			res.setHeader("content-type", "application/json");
			res.end(JSON.stringify({ embeddings: [["1", 0]] }));
		});
		if (!fake) return;
		try {
			await expect(
				embedTexts({ provider: "ollama", baseUrl: fake.baseUrl, model: "m" }, ["x"]),
			).rejects.toThrow("NaN");
		} finally {
			await fake.close();
		}
	});
	it("uses documented Ollama and OpenAI-compatible wire formats against a local fake server", async () => {
		const fake = await fakeEmbeddings();
		if (!fake) return;
		try {
			await expect(
				embedTexts({ provider: "ollama", baseUrl: fake.baseUrl, model: "exact-model" }, ["butterfly"]),
			).resolves.toMatchObject({ dimension: 2 });
			await expect(
				embedTexts({ provider: "openai-compatible", baseUrl: fake.baseUrl, model: "other-model" }, [
					"butterfly",
				]),
			).resolves.toMatchObject({ dimension: 2 });
			expect(fake.calls).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						path: "/base/api/embed",
						body: { model: "exact-model", input: ["butterfly"], truncate: false },
					}),
					expect.objectContaining({
						path: "/base/v1/embeddings",
						body: { model: "other-model", input: ["butterfly"], encoding_format: "float" },
					}),
				]),
			);
		} finally {
			await fake.close();
		}
	});
	it("rejects unsafe remote configuration, bad credentials references, malformed vectors, and aborts", async () => {
		expect(() =>
			validateSemanticConfig({
				provider: "openai-compatible",
				baseUrl: "http://example.test",
				model: "m",
				remoteConsent: true,
				credentialEnv: "KEY",
			}),
		).toThrow("HTTPS");
		expect(() =>
			validateSemanticConfig({
				provider: "openai-compatible",
				baseUrl: "https://example.test?token=x",
				model: "m",
				remoteConsent: true,
				credentialEnv: "KEY",
			}),
		).toThrow("without credentials");
		expect(() =>
			validateSemanticConfig({
				provider: "openai-compatible",
				baseUrl: "https://example.test",
				model: "m",
				remoteConsent: false,
				credentialEnv: "KEY",
			}),
		).toThrow("remoteConsent");
		await expect(
			embedTexts(
				{
					provider: "ollama",
					baseUrl: "http://127.0.0.1:9",
					model: "m",
					credentialEnv: "MISSING_TEST_CREDENTIAL",
				},
				["x"],
			),
		).rejects.toThrow("MISSING_TEST_CREDENTIAL is not set");
		const fake = await fakeEmbeddings((_req, res) => {
			res.setHeader("content-type", "application/json");
			res.end(JSON.stringify({ embeddings: [[0, 0]] }));
		});
		if (!fake) return;
		try {
			await expect(
				embedTexts({ provider: "ollama", baseUrl: fake.baseUrl, model: "m" }, ["x"]),
			).rejects.toThrow("zero-norm");
		} finally {
			await fake.close();
		}
	});
});

describe("semantic settings concurrency and safety", () => {
	it("allows only one concurrent compare-and-swap save and rejects a symlink", async () => {
		const configured = await configureObsidian({ cwd, vault, project: "project-a" });
		const service = new KnowledgeService(await readKnowledgeBinding(), app);
		try {
			const input = { provider: "ollama", baseUrl: "http://127.0.0.1:9", model: "m", enabled: false };
			const saves = await Promise.allSettled([
				service.saveSemanticSettings(input, configured.bindingRevision, 0),
				service.saveSemanticSettings(input, configured.bindingRevision, 0),
			]);
			expect(saves.filter((result) => result.status === "fulfilled")).toHaveLength(1);
			const settings = await readSemanticSettings(configured.vaultId);
			expect(settings.updatedAt).toBe((await readSemanticSettings(configured.vaultId)).updatedAt);
			await rm(join(app, configured.vaultId, "semantic.json"), { force: true });
			await symlink(join(root, "elsewhere"), join(app, configured.vaultId, "semantic.json"));
			await expect(readSemanticSettings(configured.vaultId)).rejects.toThrow("unsafe");
		} finally {
			await service.close();
		}
	});
});

describe("worker-owned hybrid retrieval", () => {
	it("re-scans semantic batches so new paths and remaining chunks are never skipped", async () => {
		await configureObsidian({ cwd, vault, project: "project-a" });
		await note("Library/Papers/z-last.md", `# Last\n${"z".repeat(700)}`);
		const service = new KnowledgeService(await readKnowledgeBinding(), app);
		try {
			await service.request("reconcile");
			const fingerprint = "cursor-regression";
			const first = await service.request("semanticBatch", {
				fingerprint,
				project: "project-a",
				limit: 1,
				chunkChars: 256,
			});
			expect(first.items).toHaveLength(1);
			await service.request("semanticStore", {
				fingerprint,
				items: first.items.map((item) => ({ ...item, vector: [1, 0] })),
			});
			const seen = [];
			for (
				let i = 0;
				i < 12 && !seen.some((item) => item.path === "Library/Papers/z-last.md" && item.chunkIndex === 1);
				i++
			) {
				const next = await service.request("semanticBatch", {
					fingerprint,
					project: "project-a",
					limit: 1,
					chunkChars: 256,
				});
				if (!next.items.length) break;
				seen.push(next.items[0]);
				await service.request("semanticStore", {
					fingerprint,
					items: next.items.map((item) => ({ ...item, vector: [1, 0] })),
				});
			}
			expect(seen).toContainEqual(
				expect.objectContaining({ path: "Library/Papers/z-last.md", chunkIndex: 1 }),
			);
			await note("Library/Papers/a-new.md", "# New\nnewly added evidence");
			await service.request("changed", { paths: ["Library/Papers/a-new.md"] });
			const added = await service.request("semanticBatch", {
				fingerprint,
				project: "project-a",
				limit: 4,
				chunkChars: 256,
			});
			expect(added.items.map((item) => item.path)).toContain("Library/Papers/a-new.md");
		} finally {
			await service.close();
		}
	});

	it("hydrates semantic candidates around the matched chunk", async () => {
		await configureObsidian({ cwd, vault, project: "project-a" });
		const lines = Array.from({ length: 40 }, (_, i) =>
			i === 30 ? "MATCHED_POLLEN_BEHAVIOR evidence" : `line-${i} ${"x".repeat(24)}`,
		).join("\n");
		await note("Library/Papers/chunked.md", `# Chunked\n${lines}`);
		const service = new KnowledgeService(await readKnowledgeBinding(), app);
		try {
			await service.request("reconcile");
			const fingerprint = "hydrate-regression";
			const batch = await service.request("semanticBatch", {
				fingerprint,
				project: "project-a",
				limit: 16,
				chunkChars: 256,
			});
			const match = batch.items.find((item) => item.text.includes("MATCHED_POLLEN_BEHAVIOR"));
			expect(match).toBeTruthy();
			await service.request("semanticStore", {
				fingerprint,
				items: [{ ...match, vector: [1, 0] }],
			});
			const candidates = await service.request("semanticCandidates", {
				fingerprint,
				project: "project-a",
				vector: [1, 0],
				minSimilarity: 0.9,
			});
			expect(candidates[0]).toMatchObject({ chunkIndex: match.chunkIndex });
			const hydrated = await service.request("hydrateCandidates", {
				project: "project-a",
				candidates,
				limit: 1,
			});
			expect(hydrated.hits[0].startLine).toBeGreaterThan(1);
			expect(hydrated.hits[0].text).toContain("MATCHED_POLLEN_BEHAVIOR");
		} finally {
			await service.close();
		}
	});

	it("runs injected semantic candidates even when FTS fills top-k, fuses/dedupes, and does not mint receipts", async () => {
		await configureObsidian({ cwd, vault, project: "project-a" });
		await note("Library/Papers/lexical.md", "# butterfly\nlexical butterfly evidence");
		await note("Library/Papers/semantic.md", "# synonym\nsemantic-only evidence");
		const service = new KnowledgeService(await readKnowledgeBinding(), app, {
			semanticCandidateProvider: async () => [
				{ path: "Library/Papers/lexical.md", score: 1 },
				{ path: "Library/Papers/semantic.md", score: 0.9 },
			],
		});
		try {
			const prep = await service.prepare({ cwd, project: "project-a", query: "butterfly" });
			await service.request("reconcile");
			const result = await service.search(prep.ticket, cwd, { query: "butterfly", limit: 1 });
			expect(result.retrievalMetrics.semanticCandidates).toBe(2);
			expect(result.retrievalMetrics.mergedCandidates).toBe(1);
			expect(result.hits[0]).toMatchObject({ path: "Library/Papers/lexical.md", retrieval: "hybrid" });
			await expect(service.evidenceReceipts(prep.ticket, cwd, ["Library/Papers/lexical.md"])).rejects.toThrow(
				"not read",
			);
		} finally {
			await service.close();
		}
	});
	it("rejects stale semantic hashes and candidates outside the current project", async () => {
		await configureObsidian({ cwd, vault, project: "project-a" });
		await note("Library/Papers/current.md", "# Current\nsource");
		await note("Projects/project-b/Evidence/private.md", "# Private\nsource");
		const service = new KnowledgeService(await readKnowledgeBinding(), app);
		try {
			await service.request("reconcile");
			const batch = await service.request("semanticBatch", {
				fingerprint: "test-fingerprint",
				project: "project-a",
				limit: 16,
			});
			await service.request("semanticStore", {
				fingerprint: "test-fingerprint",
				items: batch.items
					.filter((item) => item.path === "Library/Papers/current.md")
					.map((item) => ({ ...item, vector: [1, 0] })),
			});
			expect((await service.semanticStatus()).index.semantic.paths).toBe(1);
			expect(
				await service.request("semanticCandidates", {
					fingerprint: "test-fingerprint",
					project: "project-a",
					vector: [0.3, Math.sqrt(1 - 0.3 ** 2)],
					minSimilarity: 0.35,
				}),
			).toEqual([]);
			expect(
				await service.request("semanticCandidates", {
					fingerprint: "test-fingerprint",
					project: "project-a",
					vector: [0.3, Math.sqrt(1 - 0.3 ** 2)],
					minSimilarity: 0.2,
				}),
			).toEqual([expect.objectContaining({ path: "Library/Papers/current.md" })]);
			expect(
				(
					await service.request("hydrateCandidates", {
						candidates: [
							{ path: "Library/Papers/current.md", hash: "stale" },
							{ path: "Projects/project-b/Evidence/private.md" },
						],
						project: "project-a",
					})
				).hits,
			).toEqual([]);
			await writeFile(join(vault, "Library/Papers/current.md"), "# Changed\nreplacement");
			await service.request("changed", { paths: ["Library/Papers/current.md"] });
			expect(
				await service.request("semanticCandidates", {
					fingerprint: "test-fingerprint",
					project: "project-a",
					vector: [1, 0],
				}),
			).toEqual([]);
		} finally {
			await service.close();
		}
	});
	it("persists settings with binding/settings CAS and incrementally indexes only the current provider fingerprint", async () => {
		const configured = await configureObsidian({ cwd, vault, project: "project-a" });
		await note("Library/Papers/synonym.md", "# Lepidoptera\nButterfly synonym evidence.");
		const fake = await fakeEmbeddings();
		if (!fake) return;
		const service = new KnowledgeService(await readKnowledgeBinding(), app);
		try {
			const initial = await service.getSemanticSettings();
			expect(initial.enabled).toBe(false);
			await expect(
				service.saveSemanticSettings(
					{ provider: "ollama", baseUrl: fake.baseUrl, model: "m1" },
					configured.bindingRevision - 1,
					initial.revision,
				),
			).rejects.toThrow("binding revision");
			await service.saveSemanticSettings(
				{ provider: "ollama", baseUrl: fake.baseUrl, model: "m1" },
				configured.bindingRevision,
				initial.revision,
			);
			await service.request("reconcile");
			expect(
				(await service.rebuildSemanticIndex({ limit: 8, project: "project-a" })).processed,
			).toBeGreaterThan(0);
			const prep = await service.prepare({ cwd, project: "project-a", query: "butterfly" });
			const found = await service.search(prep.ticket, cwd, { query: "butterfly", limit: 3 });
			expect(found.hits.map((hit) => hit.path)).toContain("Library/Papers/synonym.md");
			const settings = await service.getSemanticSettings();
			await service.saveSemanticSettings(
				{ provider: "ollama", baseUrl: fake.baseUrl, model: "m2" },
				configured.bindingRevision,
				settings.revision,
			);
			const switched = await service.search(prep.ticket, cwd, { query: "butterfly", limit: 3 });
			expect(switched.retrievalMetrics.semanticCandidates).toBe(0);
			await rm(join(vault, "Library/Papers/synonym.md"));
			await service.request("changed", { paths: ["Library/Papers/synonym.md"] });
			expect((await service.semanticStatus()).index.semantic.paths).toBe(0);
		} finally {
			await service.close();
			await fake.close();
		}
	});
});
