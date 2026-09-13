#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readKnowledgeBinding } from "../.pi/lib/knowledge/config.mjs";
import { embedTexts } from "../.pi/lib/knowledge/semantic-provider.mjs";
import { closeKnowledgeServices, KnowledgeService } from "../.pi/lib/knowledge/service.mjs";
import { configureObsidian } from "../.pi/lib/obsidian-workbench.mjs";

const fixture = JSON.parse(
	await readFile(new URL("./fixtures/semantic-benchmark.json", import.meta.url), "utf8"),
);
const live = process.argv.includes("--live-local");
if (live && (!process.env.PERCHO_BENCHMARK_EMBED_BASE_URL || !process.env.PERCHO_BENCHMARK_EMBED_MODEL))
	throw new Error("--live-local requires PERCHO_BENCHMARK_EMBED_BASE_URL and PERCHO_BENCHMARK_EMBED_MODEL");

const aliases = new Map([
	["butterfly", "wing"],
	["lepidoptera", "wing"],
	["蝴蝶", "wing"],
	["翅膀", "wing"],
	["classification", "classify"],
	["分类", "classify"],
]);
function fakeVector(text) {
	const value = String(text).toLowerCase();
	const vector = [0, 0, 0, 0];
	if (value.includes("蝴蝶") || value.includes("翅膀")) vector[0]++;
	if (value.includes("分类")) vector[1]++;
	for (const word of value.match(/[a-z]+/g) || []) {
		const key = aliases.get(word) || word;
		if (key === "wing") vector[0]++;
		if (key === "classify") vector[1]++;
		if (key === "astronomy") vector[2]++;
		if (/fish|water|quality|survey/.test(key)) vector[3]++;
	}
	if (!vector.some(Boolean)) vector[3] = 0.25;
	return vector;
}
async function fakeEmbeddingServer() {
	const server = createServer(async (req, res) => {
		let raw = "";
		for await (const part of req) raw += part;
		const body = JSON.parse(raw);
		const vectors = body.input.map(fakeVector);
		res.setHeader("content-type", "application/json");
		res.end(JSON.stringify({ embeddings: vectors, model: body.model }));
	});
	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	return {
		baseUrl: `http://127.0.0.1:${server.address().port}`,
		close: () => new Promise((resolve) => server.close(resolve)),
	};
}
function fingerprint(config) {
	return createHash("sha256")
		.update(`${config.provider}\0${config.baseUrl}\0${config.model}\0${config.chunkChars || 1200}`)
		.digest("hex");
}
function summarize(mode, query, returned, retrieval, started) {
	const relevant = new Set(query.relevant);
	return {
		mode,
		query: query.query,
		expected: query.relevant,
		returned,
		latencyMs: Date.now() - started,
		recallAtK: relevant.size
			? returned.filter((id) => relevant.has(id)).length / relevant.size
			: returned.length
				? 0
				: 1,
		noAnswer: returned.length === 0,
		distractorReturned: returned.includes("distractor"),
		...(retrieval ? { retrieval } : {}),
	};
}

const root = await realpath(await mkdtemp(join(tmpdir(), "percho-semantic-benchmark-")));
const vault = join(root, "Vault"),
	cwd = join(root, "project"),
	app = join(root, "app");
await mkdir(cwd, { recursive: true });
process.env.PERCHO_KNOWLEDGE_DIR = app;
const paths = fixture.documents.map((doc) => `Library/Papers/${doc.id}.md`);
for (let i = 0; i < fixture.documents.length; i++) {
	await mkdir(join(vault, "Library/Papers"), { recursive: true });
	await writeFile(join(vault, paths[i]), `# ${fixture.documents[i].id}\n${fixture.documents[i].text}`);
}
const configured = await configureObsidian({ cwd, vault, project: "benchmark" });
const binding = await readKnowledgeBinding();
let fake;
const results = [];
const service = new KnowledgeService(binding, app);
try {
	await service.request("reconcile");
	// Actual SQLite FTS baseline, with semantic settings still absent/off.
	for (const query of fixture.queries) {
		const prep = await service.prepare({ cwd, project: "benchmark", query: query.query });
		const started = Date.now();
		const found = await service.search(prep.ticket, cwd, { query: query.query, limit: 3 });
		const returned = found.hits.map((hit) => fixture.documents[paths.indexOf(hit.path)]?.id).filter(Boolean);
		results.push(summarize("fts", query, returned, found.retrievalMetrics, started));
	}

	fake = live ? null : await fakeEmbeddingServer();
	const config = {
		enabled: true,
		provider: process.env.PERCHO_BENCHMARK_EMBED_PROVIDER || "ollama",
		baseUrl: live ? process.env.PERCHO_BENCHMARK_EMBED_BASE_URL : fake.baseUrl,
		model: live ? process.env.PERCHO_BENCHMARK_EMBED_MODEL : "deterministic-fixture-embedding",
		credentialEnv: "",
		remoteConsent: false,
		chunkChars: 1200,
		minSimilarity: 0.45,
	};
	const initial = await service.getSemanticSettings();
	await service.saveSemanticSettings(config, configured.bindingRevision, initial.revision);
	let batches = 0,
		processed = 0;
	for (; batches < 64; batches++) {
		const batch = await service.rebuildSemanticIndex({ limit: 8, project: "benchmark" });
		processed += batch.processed || 0;
		if (!batch.partial || !batch.processed) break;
	}
	const index = await service.semanticStatus({ project: "benchmark" });
	if (!(index.index.semantic?.vectors > 0)) throw new Error("Production semantic index built zero vectors");

	// Semantic-only uses the production adapter + worker candidate/index/hydration path, without lexical fusion.
	for (const query of fixture.queries) {
		const started = Date.now();
		const vector = (await embedTexts(config, [query.query])).vectors[0];
		const candidates = await service.request("semanticCandidates", {
			fingerprint: fingerprint(config),
			project: "benchmark",
			vector,
			limit: 3,
			minSimilarity: config.minSimilarity,
		});
		const hydrated = await service.request("hydrateCandidates", {
			candidates,
			project: "benchmark",
			limit: 3,
		});
		const returned = hydrated.hits
			.map((hit) => fixture.documents[paths.indexOf(hit.path)]?.id)
			.filter(Boolean);
		results.push(summarize("semantic", query, returned, null, started));
	}

	// Hybrid goes through KnowledgeService.search: current semantic settings, query embedding, worker candidates, RRF, current-source hydration.
	for (const query of fixture.queries) {
		const prep = await service.prepare({ cwd, project: "benchmark", query: query.query });
		const started = Date.now();
		const found = await service.search(prep.ticket, cwd, { query: query.query, limit: 3 });
		const returned = found.hits.map((hit) => fixture.documents[paths.indexOf(hit.path)]?.id).filter(Boolean);
		results.push(summarize("hybrid", query, returned, found.retrievalMetrics, started));
	}
	const hybrid = results.filter((row) => row.mode === "hybrid");
	const summary = {
		fixture: "synthetic",
		vectorSource: live ? "optional live local provider" : "deterministic local fake HTTP embedding server",
		productionPipeline: true,
		index: { batches: batches + 1, processed, semantic: index.index.semantic },
		results,
		invariants: {
			metricsPresent: hybrid.every((row) => row.retrieval && typeof row.retrieval.elapsedMs === "number"),
			semanticIndexPopulated: index.index.semantic.vectors > 0,
			noInvalidPaths: results.every((row) =>
				row.returned.every((id) => fixture.documents.some((doc) => doc.id === id)),
			),
		},
	};
	console.log(JSON.stringify(summary, null, 2));
	if (!Object.values(summary.invariants).every(Boolean)) process.exitCode = 1;
} finally {
	await service.close();
	await fake?.close();
	await closeKnowledgeServices();
	await rm(root, { recursive: true, force: true });
}
