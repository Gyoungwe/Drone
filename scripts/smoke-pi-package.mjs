#!/usr/bin/env node

// External-install smoke for a native Pi package.
//
// The script intentionally reports NOT_RUN when the installed `pi` CLI is
// older than the package's locked minimum. It never treats an older CLI or a
// missing model credential as a successful native-Pi acceptance.

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const packageDir = resolve(process.argv[2] || "packages/pi-knowledge");
const fixtureOnly = process.argv.includes("--fixture-only");
const packageJson = JSON.parse(await readFile(join(packageDir, "package.json"), "utf8"));

function versionParts(value) {
	const match = String(value).match(/(\d+)\.(\d+)\.(\d+)/);
	return match ? match.slice(1).map(Number) : null;
}
function atLeast(actual, required) {
	for (let i = 0; i < required.length; i++) {
		if ((actual?.[i] || 0) !== required[i]) return (actual?.[i] || 0) > required[i];
	}
	return true;
}
async function command(name, args, options = {}) {
	return execFileAsync(name, args, { maxBuffer: 8 * 1024 * 1024, ...options });
}
async function fakeToolContext(cwd) {
	return {
		cwd,
		sessionId: "smoke-pi-knowledge",
		hasUI: false,
		isProjectTrusted: () => true,
		sessionManager: { getSessionId: () => "smoke-pi-knowledge", getBranch: () => [] },
		ui: { notify: () => undefined },
	};
}
async function loadTools(packageRoot, cwd, agentDir) {
	const { DefaultResourceLoader, SettingsManager } = await import("@earendil-works/pi-coding-agent");
	const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
	const extensionPaths = manifest.pi.extensions.map((path) => resolve(packageRoot, path));
	const skillPaths = (manifest.pi.skills || []).flatMap((pattern) => {
		const directory = resolve(packageRoot, pattern.replace(/\/\*$/, ""));
		return ["research-vault", "research-workflow", "research-show-me"].map((name) =>
			join(directory, name, "SKILL.md"),
		);
	});
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
	const loaded = loader.getExtensions();
	assert.deepEqual(loaded.errors, [], `package extension failed to load: ${JSON.stringify(loaded.errors)}`);
	const extension = loaded.extensions.find((entry) => extensionPaths.includes(entry.path));
	assert(extension, `extension was not loaded: ${extensionPaths.join(", ")}`);
	return { extension, skills: loader.getSkills().skills };
}
async function invoke(extension, name, args, ctx) {
	const tool = extension.tools.get(name);
	assert(tool, `missing tool: ${name}`);
	return tool.definition.execute(`smoke:${name}`, args, new AbortController().signal, () => undefined, ctx);
}
async function fixtureRun(packageRoot, label) {
	const rootDir = await mkdtemp(join(tmpdir(), `drone-pi-knowledge-${label}-`));
	const project = join(rootDir, "project");
	const vault = join(rootDir, "Vault");
	const agentDir = join(rootDir, "agent");
	const knowledgeDir = join(rootDir, "knowledge");
	await Promise.all([
		mkdir(join(project, ".pi"), { recursive: true }),
		mkdir(join(vault, "Wiki"), { recursive: true }),
		mkdir(join(vault, "Library", "Papers"), { recursive: true }),
		mkdir(join(vault, "Projects", "project"), { recursive: true }),
		mkdir(agentDir, { recursive: true }),
		mkdir(knowledgeDir, { recursive: true }),
	]);
	await Promise.all([
		writeFile(join(vault, "Home.md"), "# Home\n\n[[Wiki/Index]]\n"),
		writeFile(join(vault, "Wiki/Index.md"), "# Wiki\n"),
		writeFile(join(vault, "Projects/project/Context.md"), "# Context\n"),
		writeFile(join(vault, "Projects/project/Index.md"), "# Project\n"),
		writeFile(
			join(vault, "Library", "Papers", "Fixture.md"),
			"# Fixture knowledge\n\nThis package smoke note contains package-fixture-marker.\n",
		),
		writeFile(
			join(project, ".pi", "research-workspace.json"),
			`${JSON.stringify(
				{
					resultsRoot: "./results",
					obsidianVault: "../Vault",
					knowledgeProfile: "hybrid",
					knowledgeDepositMode: "verified",
					subagentMcpPolicy: "none",
					maxConcurrentSubagents: 4,
					timezone: "UTC",
				},
				null,
				2,
			)}\n`,
		),
	]);
	const boundVault = await realpath(vault);
	const binding = {
		version: 1,
		vault: boundVault,
		vaultId: createHash("sha256").update(boundVault).digest("hex").slice(0, 24),
		revision: 1,
		profile: "hybrid",
		depositMode: "verified",
		subagentPolicy: "none",
		updatedAt: new Date().toISOString(),
	};
	await writeFile(join(knowledgeDir, "binding.json"), `${JSON.stringify(binding, null, 2)}\n`);
	const previous = process.env.DRONE_KNOWLEDGE_DIR;
	process.env.DRONE_KNOWLEDGE_DIR = join(rootDir, "unconfigured");
	try {
		const unconfigured = await loadTools(packageRoot, project, agentDir);
		const status = await invoke(
			unconfigured.extension,
			"knowledge_status",
			{},
			await fakeToolContext(project),
		);
		assert.equal(status.details.status, "unconfigured");
		assert.equal(status.details.next, "/drone-init");

		process.env.DRONE_KNOWLEDGE_DIR = knowledgeDir;
		const configured = await loadTools(packageRoot, project, agentDir);
		const ctx = await fakeToolContext(project);
		const configuredStatus = await invoke(configured.extension, "knowledge_status", {}, ctx);
		assert.equal(configuredStatus.details.status, "configured");
		await invoke(configured.extension, "research_prepare_knowledge", {}, ctx);
		let searched;
		for (let attempt = 0; attempt < 20; attempt++) {
			searched = await invoke(
				configured.extension,
				"research_search_knowledge",
				{ query: "package-fixture-marker", limit: 6 },
				ctx,
			);
			if (searched.details?.hits?.some((hit) => hit.text?.includes("package-fixture-marker"))) break;
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		assert(
			searched?.details?.hits?.some((hit) => hit.text?.includes("package-fixture-marker")),
			`fixture note was not searchable: ${JSON.stringify(searched?.details)}`,
		);

		// PR-4 native-Pi loop: local-first search, bounded snippets, bidirectional
		// read receipts, and a repeated fixed question that can only be answered
		// from the local fixture evidence.
		const nativeSearch = await invoke(
			configured.extension,
			"knowledge_search",
			{ query: "package-fixture-marker" },
			ctx,
		);
		const trace = [{ type: "knowledge_search", source: nativeSearch.details.local.status }];
		assert.equal(nativeSearch.details.local.status, "searched");
		assert.equal(nativeSearch.details.answerRound, 1);
		assert(nativeSearch.details.hits.length <= 6);
		assert(nativeSearch.details.hits.every((hit) => (hit.text || "").length <= 300));
		assert(nativeSearch.details.hits.some((hit) => hit.text.includes("package-fixture-marker")));
		const notePath = "Library/Papers/Fixture.md";
		const firstRead = await invoke(configured.extension, "knowledge_read", { path: notePath }, ctx);
		trace.push({ type: "knowledge_read", status: firstRead.details.status });
		assert.equal(firstRead.details.status, "read");
		assert(Array.isArray(firstRead.details.links.outgoing));
		assert(Array.isArray(firstRead.details.links.backlinks));
		const secondRead = await invoke(configured.extension, "knowledge_read", { path: notePath }, ctx);
		trace.push({ type: "knowledge_read", status: secondRead.details.status });
		assert.equal(secondRead.details.status, "already-read");
		assert.equal(secondRead.details.hash, firstRead.details.hash);
		const firstAnswer = await invoke(
			configured.extension,
			"knowledge_answer_context",
			{ question: "package-fixture-marker" },
			ctx,
		);
		const secondAnswer = await invoke(
			configured.extension,
			"knowledge_answer_context",
			{ question: "package-fixture-marker" },
			ctx,
		);
		trace.push({
			type: "knowledge_answer_context",
			source: firstAnswer.details.source,
			round: firstAnswer.details.answerRound,
		});
		trace.push({
			type: "knowledge_answer_context",
			source: secondAnswer.details.source,
			round: secondAnswer.details.answerRound,
		});
		assert.equal(firstAnswer.details.source, "local");
		assert.equal(secondAnswer.details.source, "local");
		assert.equal(firstAnswer.details.answerRound, 1);
		assert.equal(secondAnswer.details.answerRound, 2);
		assert.equal(secondAnswer.details.answerable, true);
		assert(secondAnswer.details.hits.some((hit) => hit.text.includes("package-fixture-marker")));
		const deposits = [];
		for (const [type, title] of [
			["paper", "Fixture paper"],
			["software", "Fixture software"],
			["method", "Fixture method"],
			["idea", "Fixture idea"],
		]) {
			const deposited = await invoke(
				configured.extension,
				"knowledge_deposit",
				{
					type,
					title,
					markdown: `Fixture ${type} body`,
					source_links: ["https://example.org/drone-fixture-source"],
				},
				ctx,
			);
			assert.equal(deposited.details.type, type);
			assert.equal(deposited.details.scientificallyVerified, false);
			deposits.push(deposited.details.note);
			trace.push({ type: "knowledge_deposit", category: type });
		}
		assert.deepEqual(
			trace.map((event) => event.type),
			[
				"knowledge_search",
				"knowledge_read",
				"knowledge_read",
				"knowledge_answer_context",
				"knowledge_answer_context",
				"knowledge_deposit",
				"knowledge_deposit",
				"knowledge_deposit",
				"knowledge_deposit",
			],
		);
		return {
			unconfigured: status.details,
			configured: configuredStatus.details.status,
			fixtureHit: true,
			nativeLoop: {
				searchHits: nativeSearch.details.hits.length,
				secondAnswerSource: secondAnswer.details.source,
				duplicateRead: secondRead.details.status,
				deposits,
				trace,
			},
			skills: configured.skills.map((skill) => skill.name).filter((name) => name.startsWith("research-")),
		};
	} finally {
		if (previous === undefined) delete process.env.DRONE_KNOWLEDGE_DIR;
		else process.env.DRONE_KNOWLEDGE_DIR = previous;
		await rm(rootDir, { recursive: true, force: true });
	}
}

const output = await fixtureRun(packageDir, fixtureOnly ? "fixture" : "preinstall");
if (fixtureOnly) {
	console.log(JSON.stringify({ status: "PASS", mode: "fixture-only", package: packageJson.name, ...output }));
	process.exit(0);
}

let piVersion;
try {
	piVersion = versionParts((await command("pi", ["--version"])).stdout);
} catch (error) {
	console.log(JSON.stringify({ status: "NOT_RUN", reason: `pi CLI unavailable: ${error.message}` }));
	process.exit(2);
}
if (!atLeast(piVersion, [1, 1, 0])) {
	console.log(
		JSON.stringify({
			status: "NOT_RUN",
			reason: "Pi CLI is older than the locked minimum; no external-install acceptance was claimed",
			piVersion: piVersion?.join(".") || null,
			required: "1.1.0",
		}),
	);
	process.exit(2);
}

const temp = await mkdtemp(join(tmpdir(), "drone-pi-package-smoke-"));
const home = join(temp, "home");
const agentDir = join(temp, "agent");
const cwd = join(temp, "project");
await mkdir(cwd, { recursive: true });
const env = {
	...process.env,
	HOME: home,
	PI_CODING_AGENT_DIR: agentDir,
	XDG_CONFIG_HOME: join(home, ".config"),
};
try {
	const packed = await command("npm", ["pack", "--json", "--pack-destination", temp], {
		cwd: packageDir,
		env,
	});
	const tarball = join(temp, JSON.parse(packed.stdout)[0].filename);
	// Pi 1.1.0 accepts a local directory as a package source. A .tgz path is
	// currently persisted as a raw extension path instead of being unpacked;
	// exercise that documented plan path explicitly so the smoke records the
	// limitation instead of silently treating it as a successful install.
	await command("pi", ["install", tarball], { cwd, env });
	const tarballList = await command("pi", ["list"], { cwd, env });
	const tarballUnsupported =
		tarballList.stdout.includes(".tgz") ||
		tarballList.stderr.includes(".tgz") ||
		/Unknown file extension|Failed to load extension/.test(`${tarballList.stdout}\n${tarballList.stderr}`);
	await command("pi", ["uninstall", tarball], { cwd, env });
	const npmRoot = join(temp, "npm-install");
	await command("npm", ["install", "--prefix", npmRoot, "--ignore-scripts", "--legacy-peer-deps", tarball], {
		cwd,
		env,
	});
	const installed = join(npmRoot, "node_modules", ...packageJson.name.split("/"));
	assert(existsSync(join(installed, "package.json")), "npm did not unpack the package tarball");
	await command("pi", ["install", installed], { cwd, env });
	const loaded = await loadTools(installed, cwd, agentDir);
	const smoke = await fixtureRun(installed, "installed");
	await command("pi", ["uninstall", installed], { cwd, env });
	const finalList = await command("pi", ["list"], { cwd, env });
	const removed = !finalList.stdout.includes(installed);
	assert(removed, "pi uninstall left the package source configured");
	console.log(
		JSON.stringify({
			status: tarballUnsupported ? "PARTIAL" : "PASS",
			mode: "external-install",
			package: packageJson.name,
			piVersion,
			tarballDirectInstall: tarballUnsupported ? "NOT_SUPPORTED_BY_PI_1.1.0" : "PASS",
			workaround: "npm pack -> npm install --prefix -> pi install <package-directory>",
			extension: loaded.extension.path,
			...smoke,
		}),
	);
	if (tarballUnsupported) process.exitCode = 2;
} finally {
	await rm(temp, { recursive: true, force: true });
}
