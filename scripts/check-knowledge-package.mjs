// Offline resource/runtime smoke; run with Node or ELECTRON_RUN_AS_NODE=1 Electron.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";
import { parse } from "yaml";

const resourceArg = process.argv.indexOf("--resources");
if (resourceArg >= 0 && !process.argv[resourceArg + 1])
	throw new Error("--resources requires a packaged research-workbench directory");
const suppliedResources = resourceArg >= 0 ? await realpath(resolve(process.argv[resourceArg + 1])) : null;
const root = await realpath(await mkdtemp(join(tmpdir(), "drone-knowledge-package-")));
let serviceModule;
try {
	const config = parse(await readFile("packages/desktop/electron-builder.yml", "utf8"));
	for (const item of suppliedResources
		? []
		: config.extraResources.filter((item) => item.to.startsWith("research-workbench/"))) {
		await cp(resolve("packages/desktop", item.from), join(root, item.to), { recursive: true });
	}
	const resources = suppliedResources || join(root, "research-workbench");
	assert(
		existsSync(join(resources, "extensions/knowledge-worker.mjs")),
		"Packaged research-workbench is missing extensions/knowledge-worker.mjs",
	);
	assert(
		existsSync(join(resources, "extensions/.knowledge-worker-manifest.json")),
		"Packaged research-workbench is missing the knowledge worker manifest",
	);
	const workerPath = join(resources, "extensions/knowledge-worker.mjs");
	const workerManifest = JSON.parse(
		await readFile(join(resources, "extensions/.knowledge-worker-manifest.json"), "utf8"),
	);
	assert.equal(
		createHash("sha256")
			.update(await readFile(workerPath))
			.digest("hex"),
		workerManifest.outputSha256,
		"Packaged knowledge worker bytes do not match the build manifest",
	);
	const manifest = JSON.parse(await readFile(join(resources, "extensions/workbench-manifest.json"), "utf8")),
		a = join(root, "A"),
		b = join(root, "B"),
		agentDir = join(root, "agent");
	// Audit the actual shipped tree as well as the resource-copy fixture.
	async function audit(directory) {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			assert(!entry.isSymbolicLink(), `Bundled symlink is not permitted: ${entry.name}`);
			assert(
				!/^(?:auth|binding|semantic|specialists)\.json$|\.(?:sqlite(?:-wal|-shm)?|db|log|jsonl|tmp)$|^(?:node_modules|sessions|\.git|\.env)$/.test(
					entry.name,
				),
				`Private/runtime file in package: ${entry.name}`,
			);
			if (entry.isDirectory()) await audit(join(directory, entry.name));
		}
	}
	await audit(resources);
	await Promise.all([mkdir(a), mkdir(b), mkdir(agentDir)]);
	process.env.DRONE_KNOWLEDGE_DIR = join(root, "app");
	process.env.DRONE_RESEARCH_WORKBENCH_ROOT = resources;
	delete process.env.PI_RESEARCH_DESKTOP_CONFIG;
	// Knowledge production code is bundled in the generated extension graph.
	// The old `.pi/lib/knowledge` compatibility tree is intentionally absent
	// from packaged resources, so the smoke must exercise the shipped entry.
	const workbench = await import(pathToFileURL(join(resources, "extensions/obsidian-workbench.mjs")));
	serviceModule = workbench;
	const binding = await workbench.configureObsidian({ cwd: a, vault: join(root, "Vault") });
	await writeFile(join(binding.vault, "Library/Papers/fixture.md"), "# Fixture\npackagedmarker 自切\n");
	const loader = new DefaultResourceLoader({
		cwd: b,
		agentDir,
		settingsManager: SettingsManager.create(b, agentDir),
		noExtensions: true,
		noSkills: true,
		additionalExtensionPaths: manifest.extensions.map((name) => join(resources, "extensions", name)),
		additionalSkillPaths: manifest.skills.map((name) => join(resources, "skills", name, "SKILL.md")),
	});
	await loader.reload();
	assert.deepEqual(loader.getExtensions().errors, []);
	assert(loader.getExtensions().extensions.some((extension) => extension.commands.has("obsidian-setup")));
	assert(loader.getExtensions().extensions.some((extension) => extension.commands.has("zotero-setup")));
	assert.equal(loader.getSkills().skills.filter((skill) => skill.name === "research-vault").length, 1);
	assert.equal(loader.getSkills().skills.filter((skill) => skill.name === "zotero-literature").length, 1);
	const toolNames = loader.getExtensions().extensions.flatMap((extension) => [...extension.tools.keys()]);
	for (const name of manifest.requiredTools)
		assert(toolNames.includes(name), `Missing bundled tool: ${name}`);
	for (const name of manifest.skills)
		assert(
			loader.getSkills().skills.some((skill) => skill.name === name),
			`Missing bundled skill: ${name}`,
		);
	assert(
		!loader.getSkills().skills.some((skill) => skill.name === "show-me"),
		"ambient user skills were not required",
	);
	assert.equal(toolNames.length, new Set(toolNames).size, "duplicate bundled tool registration");
	const child = await import(pathToFileURL(join(resources, "extensions/subagent-mcp-readonly.mjs")));
	const tools = [];
	await child.makeSubagentReadonlyMcp(b)({ registerTool: (tool) => tools.push(tool.name), on: () => {} });
	assert(tools.includes("research_search_knowledge"));
	assert(!tools.includes("research_maintain_knowledge"));
	const lifecycleEvents = [];
	const lifecycleEventName = "drone:knowledge-worker-lifecycle/v1";
	const onLifecycle = (event) => lifecycleEvents.push(event);
	process.on(lifecycleEventName, onLifecycle);
	const service = await serviceModule.getKnowledgeService();
	const prepared = await service.prepare({ cwd: b, project: "project-b", query: "packagedmarker" });
	await service.request("reconcile");
	let result = await service.search(prepared.ticket, b, { query: "packagedmarker" });
	const settleStarted = Date.now();
	while (result.complete !== true && Date.now() - settleStarted < 5000) {
		await new Promise((resolve) => setTimeout(resolve, 200));
		result = await service.search(prepared.ticket, b, { query: "packagedmarker" });
	}
	assert(
		result.hits.some((hit) => hit.path === "Library/Papers/fixture.md"),
		`missing fixture hit: ${JSON.stringify({ hits: result.hits, complete: result.complete, coverage: result.coverage, problems: result.problems })}`,
	);
	assert.equal(
		result.complete,
		true,
		`incomplete search: ${JSON.stringify({ complete: result.complete, coverage: result.coverage, problems: result.problems })}`,
	);
	assert(
		lifecycleEvents.some((event) => event?.stage === "verified"),
		"Packaged knowledge worker did not report a verified lifecycle event",
	);
	process.off(lifecycleEventName, onLifecycle);
	console.log(
		JSON.stringify({
			passed: true,
			node: process.version,
			electron: process.versions.electron || null,
			packagedResources: true,
			actualBundle: suppliedResources !== null,
			unrelatedProject: true,
			sqliteWorker: true,
			readonlyChild: true,
			coreToolCount: toolNames.length,
			requiredCoreTools: manifest.requiredTools,
			bundledSkills: manifest.skills,
			noAmbientSkills: true,
			noPrivateConfig: true,
			rawMcpConnected: false,
			workerLifecycle: lifecycleEvents.map((event) => event.stage),
			workerIntegrity: workerManifest.outputSha256,
		}),
	);
} finally {
	await serviceModule?.closeKnowledgeServices();
	await rm(root, { recursive: true, force: true });
}
