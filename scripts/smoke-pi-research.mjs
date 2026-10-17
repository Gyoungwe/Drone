#!/usr/bin/env node

// Offline external-install fixture for @drone/pi-research. It creates two
// source records in a temporary workspace, exercises search -> two reads ->
// deposit -> source-grounded answer, and removes the fixture afterwards.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const packageArg = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
const packageDir = resolve(packageArg || join(root, "packages/pi-research"));
const fixtureOnly = process.argv.includes("--fixture-only");

async function command(name, args, options = {}) {
	return execFileAsync(name, args, {
		maxBuffer: 16 * 1024 * 1024,
		...options,
		env: { ...process.env, ...options.env },
	});
}

async function fakeContext(cwd) {
	return {
		cwd,
		sessionId: "smoke-pi-research",
		hasUI: false,
		isProjectTrusted: () => true,
		sessionManager: { getSessionId: () => "smoke-pi-research", getBranch: () => [] },
		ui: { notify: () => undefined },
	};
}

async function loadTools(packageRoot, cwd, agentDir) {
	const { DefaultResourceLoader, SettingsManager } = await import("@earendil-works/pi-coding-agent");
	const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
	const extensionPaths = manifest.pi.extensions.map((entry) => resolve(packageRoot, entry));
	const skillPaths = (manifest.pi.skills || []).map((pattern) =>
		resolve(packageRoot, pattern.replace(/\/\*$/, ""), "research-workflow/SKILL.md"),
	);
	const loader = new DefaultResourceLoader({
		cwd,
		agentDir,
		settingsManager: SettingsManager.inMemory(),
		noExtensions: true,
		noSkills: true,
		additionalExtensionPaths: extensionPaths,
		additionalSkillPaths: skillPaths,
	});
	await loader.reload();
	assert.deepEqual(loader.getExtensions().errors, [], "package extension failed to load");
	const extension = loader.getExtensions().extensions.find((entry) => extensionPaths.includes(entry.path));
	assert(extension, "pi-research extension was not loaded");
	assert(
		loader.getSkills().skills.some((skill) => skill.name === "research-workflow"),
		"research skill was not loaded",
	);
	return extension;
}

async function invoke(extension, name, args, ctx) {
	const tool = extension.tools.get(name);
	assert(tool, `missing tool: ${name}`);
	return tool.definition.execute(`smoke:${name}`, args, new AbortController().signal, () => undefined, ctx);
}

async function runFixture(packageRoot, label) {
	const base = await mkdtemp(join(tmpdir(), `drone-pi-research-${label}-`));
	const project = join(base, "project");
	const sources = join(project, "sources");
	const agentDir = join(base, "agent");
	await mkdir(sources, { recursive: true });
	await mkdir(agentDir, { recursive: true });
	await writeFile(
		join(sources, "article-a.md"),
		"---\nid: article-a\ntitle: Bee brain atlas\ndoi: 10.1234/bee.a\nuri: https://example.org/bee-a\n---\n\n# Bee brain atlas\n\nThe atlas reports marker-a in mushroom bodies and records the sample design.\n",
	);
	await writeFile(
		join(sources, "article-b.md"),
		"---\nid: article-b\ntitle: Pollinator transcriptome\ndoi: 10.1234/bee.b\nuri: https://example.org/bee-b\n---\n\n# Pollinator transcriptome\n\nThe transcriptome reports marker-b after exposure and records a different cohort.\n",
	);
	const extension = await loadTools(packageRoot, project, agentDir);
	const ctx = await fakeContext(project);
	const searched = await invoke(
		extension,
		"research_search_sources",
		{ query: "bee marker", source_dir: "sources", limit: 4 },
		ctx,
	);
	assert.equal(searched.details.count, 2, JSON.stringify(searched.details));
	const ids = searched.details.hits.map((hit) => hit.source_id);
	assert.deepEqual(ids.sort(), ["article-a", "article-b"]);
	for (const id of ids) {
		const read = await invoke(extension, "research_read_source", { source_id: id }, ctx);
		assert.equal(read.details.status, "read");
		assert.equal(read.details.read_receipt.source_id, id);
	}
	const repeated = await invoke(extension, "research_read_source", { source_id: ids[0] }, ctx);
	assert.equal(repeated.details.status, "already-read");
	const deposited = await invoke(
		extension,
		"research_deposit_research_note",
		{
			title: "Bee markers",
			slug: "bee-markers",
			markdown: "The two source records report distinct marker observations.",
			source_ids: ids,
		},
		ctx,
	);
	assert.equal(deposited.details.status, "written");
	assert.equal(deposited.details.scientificallyVerified, false);
	assert.equal((await readFile(join(project, deposited.details.path), "utf8")).includes("bee-a"), true);
	const answered = await invoke(
		extension,
		"research_answer_sources",
		{ question: "What do the two source records report?", source_ids: ids },
		ctx,
	);
	assert.equal(answered.details.evidence_gate.answerable, true);
	assert.equal(answered.details.source_count, 2);
	assert.equal(answered.details.citations.length, 2);
	assert(answered.details.answer.includes("marker-a"));
	assert(answered.details.answer.includes("marker-b"));
	const status = await invoke(extension, "research_status", {}, ctx);
	assert.deepEqual(status.details, { searches: 1, reads: 2, deposits: 1, answerable: true });
	await rm(base, { recursive: true, force: true });
	return { packageRoot, sources: 2, reads: 2, answerable: true };
}

const result = await runFixture(packageDir, fixtureOnly ? "fixture" : "direct");
if (!fixtureOnly) {
	const packDir = await mkdtemp(join(tmpdir(), "drone-pi-research-pack-"));
	try {
		const npmCache = join(packDir, "npm-cache");
		const npmLogs = join(packDir, "npm-logs");
		await mkdir(npmCache, { recursive: true });
		await mkdir(npmLogs, { recursive: true });
		const packed = JSON.parse(
			(
				await command("npm", ["pack", packageDir, "--json", "--pack-destination", packDir], {
					cwd: root,
					env: { npm_config_cache: npmCache, npm_config_logs: npmLogs },
				})
			).stdout,
		);
		const tarball = packed?.[0]?.filename;
		assert(tarball, "npm pack did not produce a tarball");
		const unpackRoot = join(packDir, "unpacked");
		await mkdir(unpackRoot, { recursive: true });
		await command("tar", ["-xzf", join(packDir, tarball), "-C", unpackRoot]);
		await runFixture(join(unpackRoot, "package"), "packed");
	} finally {
		await rm(packDir, { recursive: true, force: true });
	}
}
console.log(`pi-research evidence-loop smoke passed (${result.sources} sources, ${result.reads} receipts)`);
