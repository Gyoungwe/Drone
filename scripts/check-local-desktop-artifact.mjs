#!/usr/bin/env node
/**
 * Verify the local Electron build as a deterministic artifact.
 *
 * This deliberately does not launch Electron or claim a visual screenshot. It
 * checks the files that `npm run build` emits, the resources copied by the
 * desktop package, and the source/compiled markers for the four planned
 * viewport routes. Use `--strict` after staging package resources to turn
 * optional staged-resource checks into hard failures.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const getArg = (name) => {
	const index = args.indexOf(name);
	return index === -1 ? undefined : args[index + 1];
};
const repoRoot = resolve(getArg("--root") ?? ROOT);
const strict = args.includes("--strict");
const desktopRoot = join(repoRoot, "packages", "desktop");
const outRoot = join(desktopRoot, "out");
const defaultReport = join(repoRoot, ".local", "desktop-artifact-acceptance.json");
const reportPath = resolve(getArg("--out") ?? defaultReport);

const report = {
	schema: 1,
	kind: "desktop-local-build-artifact",
	mode: "local-build-artifact",
	realDesktop: false,
	screenshots: false,
	strict,
	repoRoot,
	checks: [],
	viewports: [],
	startedAt: new Date().toISOString(),
};

function addCheck(id, status, detail, evidence = {}) {
	const normalized = status === "PASS" || status === "NOT_RUN" ? status : "FAIL";
	const entry = { id, status: normalized, detail, ...evidence };
	report.checks.push(entry);
	return entry;
}

async function exists(path) {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

async function readText(path) {
	return readFile(path, "utf8");
}

async function requireFile(rel, id, detail = rel) {
	const path = join(repoRoot, rel);
	const ok = await exists(path);
	addCheck(id, ok ? "PASS" : "FAIL", ok ? detail : `missing ${rel}`, { paths: [rel] });
	return ok;
}

async function listFiles(root, prefix = "") {
	if (!(await exists(root))) return [];
	const entries = await readdir(root, { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		const rel = join(prefix, entry.name);
		if (entry.isDirectory()) files.push(...(await listFiles(join(root, entry.name), rel)));
		else if (entry.isFile()) files.push(rel);
	}
	return files;
}

async function artifactSnapshot() {
	const files = (await listFiles(outRoot)).sort();
	const hash = createHash("sha256");
	for (const file of files) {
		const bytes = await readFile(join(outRoot, file));
		hash.update(file).update("\0").update(bytes);
	}
	return { files, sha256: hash.digest("hex") };
}

const sourcePath = (repoRoot, rel) => join(repoRoot, rel);

async function run() {
	assert(await exists(outRoot), `desktop build output is missing: ${outRoot}`);
	const snapshot = await artifactSnapshot();
	report.artifact = {
		root: relative(repoRoot, outRoot),
		fileCount: snapshot.files.length,
		sha256: snapshot.sha256,
	};

	for (const rel of [
		"packages/desktop/out/main/index.js",
		"packages/desktop/out/preload/index.cjs",
		"packages/desktop/out/renderer/index.html",
	])
		await requireFile(rel, "build-output", "required Electron output present");
	const rendererFiles = snapshot.files.filter(
		(file) => file.startsWith("renderer/assets/") && /\.(?:js|css)$/u.test(file),
	);
	addCheck(
		"build-assets",
		rendererFiles.length > 1 ? "PASS" : "FAIL",
		rendererFiles.length > 1
			? `renderer emitted ${rendererFiles.length} JS/CSS assets`
			: "renderer asset graph is incomplete",
		{ paths: rendererFiles.slice(0, 12) },
	);

	const html = await readText(join(outRoot, "renderer/index.html"));
	const htmlContract = [
		["root mount", /<div id="root"><\/div>/u],
		["CSP", /Content-Security-Policy/u],
		["module entry", /<script type="module"[^>]+src="\.\/assets\//u],
		["stylesheet", /<link rel="stylesheet"[^>]+href="\.\/assets\//u],
	];
	addCheck(
		"renderer-shell",
		htmlContract.every(([, pattern]) => pattern.test(html)) ? "PASS" : "FAIL",
		"renderer index has root, CSP, module entry and stylesheet contracts",
		{ markers: htmlContract.map(([name]) => name) },
	);

	const compiledPaths = snapshot.files.filter((file) => /\.(?:js|cjs|css|html)$/u.test(file));
	const compiledText = (await Promise.all(compiledPaths.map((file) => readText(join(outRoot, file))))).join(
		"\n",
	);
	const sourceTextCache = new Map();
	const sourceText = async (rel) => {
		if (!sourceTextCache.has(rel))
			sourceTextCache.set(rel, await readText(sourcePath(repoRoot, rel)).catch(() => ""));
		return sourceTextCache.get(rel);
	};

	const viewportSpecs = [
		{
			id: "home",
			width: 1440,
			height: 900,
			sources: ["packages/desktop/src/renderer/src/components/chat/HomeCards.tsx"],
			markers: ["home-cards", "home-workspace-summary"],
		},
		{
			id: "knowledge",
			width: 1440,
			height: 900,
			sources: [
				"packages/desktop/src/renderer/src/components/knowledge/KnowledgeHome.tsx",
				"packages/desktop/src/renderer/src/components/knowledge/KnowledgePanel.tsx",
			],
			markers: ["knowledge-panel", "knowledge"],
		},
		{
			id: "skills-connections",
			width: 1280,
			height: 800,
			sources: ["packages/desktop/src/renderer/src/components/workbench/SkillsConnectionsView.tsx"],
			markers: ["skills-connections-view", "uiPluginsSetPluginEnabled"],
		},
		{
			id: "hosts-right-panel",
			width: 1280,
			height: 800,
			sources: [
				"packages/desktop/src/renderer/src/components/panel/ComputePane.tsx",
				"packages/desktop/src/renderer/src/components/workbench/WorkbenchNav.tsx",
			],
			markers: ["compute-pane", "overview-pane", "listHosts"],
		},
	];
	for (const viewport of viewportSpecs) {
		const sourceOk = (
			await Promise.all(
				viewport.sources.map(
					async (rel) => (await exists(sourcePath(repoRoot, rel))) && (await sourceText(rel)).length > 0,
				),
			)
		).every(Boolean);
		const compiledMarkers = viewport.markers.filter((marker) => compiledText.includes(marker));
		const ok = sourceOk && compiledMarkers.length === viewport.markers.length;
		const evidence = {
			id: viewport.id,
			width: viewport.width,
			height: viewport.height,
			verification: "static-route-contract",
			sourcePaths: viewport.sources,
			compiledMarkers,
			screenshot: null,
		};
		report.viewports.push({ ...evidence, status: ok ? "PASS" : "FAIL" });
		addCheck(
			`viewport:${viewport.id}`,
			ok ? "PASS" : "FAIL",
			ok
				? `${viewport.width}x${viewport.height} route source and compiled markers verified; no GUI launched`
				: "viewport source or compiled route marker missing",
			evidence,
		);
	}

	const manifests = [
		"packages/desktop/resources/ui-plugins/builtin/ds-whale-maid-q/plugin.json",
		"packages/desktop/resources/ui-plugins/builtin/ds-whale-maid/plugin.json",
		"packages/desktop/resources/ui-plugins/builtin/voice-alerts/plugin.json",
		"packages/desktop/resources/ui-plugins/examples/overlay-pet/plugin.json",
		"packages/desktop/resources/ui-plugins/examples/terminal-tool-card/plugin.json",
		"packages/desktop/resources/ui-plugins/examples/token-meter/plugin.json",
	];
	const pluginNames = [];
	let pluginManifestOk = true;
	for (const rel of manifests) {
		try {
			const manifest = JSON.parse(await readText(sourcePath(repoRoot, rel)));
			const valid =
				typeof manifest.name === "string" &&
				/^[a-z0-9][a-z0-9-]*$/u.test(manifest.name) &&
				manifest.version === "0.1.0" &&
				manifest.droneUi === 1 &&
				typeof manifest.main === "string" &&
				(manifest.headless === true ||
					typeof manifest.contributions === "object" ||
					typeof manifest.slots === "object");
			pluginManifestOk &&= valid;
			if (valid) pluginNames.push(manifest.name);
		} catch {
			pluginManifestOk = false;
		}
	}
	const pluginSourcePaths = [
		"packages/desktop/src/main/ui-plugins/config-merge.ts",
		"packages/desktop/src/main/ipc/ui-plugins.ts",
		"packages/desktop/src/renderer/src/stores/ui-plugins.ts",
		"packages/desktop/src/renderer/src/plugins/Slot.tsx",
		"packages/desktop/src/renderer/src/plugins/PluginRegions.tsx",
	];
	const pluginSource = (await Promise.all(pluginSourcePaths.map(sourceText))).join("\n");
	const pluginMarkers = ["setMaster", "setPluginEnabled", "uiPluginsSetEnabled", "uiPluginsSetPluginEnabled"];
	const pluginCompiledMarkers = ["uiPluginsSetEnabled", "uiPluginsSetPluginEnabled", "uiPluginsAssignSlot"];
	const pluginOk =
		pluginManifestOk &&
		(await exists(sourcePath(repoRoot, "packages/desktop/resources/ui-plugins/SPEC.md"))) &&
		(await exists(sourcePath(repoRoot, "packages/desktop/resources/ui-plugins/drone-ui.d.ts"))) &&
		pluginMarkers.every((marker) => pluginSource.includes(marker)) &&
		pluginCompiledMarkers.every((marker) => compiledText.includes(marker));
	addCheck(
		"ui-plugin-toggle-contract",
		pluginOk ? "PASS" : "FAIL",
		pluginOk
			? `validated ${pluginNames.length} plugin manifests plus master/per-plugin enable IPC in source and preload`
			: "UI plugin manifest, resource, source or compiled toggle contract is incomplete",
		{ pluginNames, sourcePaths: pluginSourcePaths, markers: pluginMarkers.concat(pluginCompiledMarkers) },
	);

	const workbenchManifestPath = ".pi/extensions/workbench-manifest.json";
	const workbenchManifest = JSON.parse(await readText(sourcePath(repoRoot, workbenchManifestPath)));
	const skillPaths = [
		"packages/desktop/resources/skills/channel-pickup/SKILL.md",
		"packages/desktop/resources/skills/design-handoff/SKILL.md",
		"packages/desktop/resources/ui-plugins/skills/drone-ui-plugin/SKILL.md",
		...(Array.isArray(workbenchManifest.skills)
			? workbenchManifest.skills.map((name) => `.pi/skills/${name}/SKILL.md`)
			: []),
	];
	const skillExistence = (
		await Promise.all(skillPaths.map((rel) => exists(sourcePath(repoRoot, rel))))
	).every(Boolean);
	const skillSourcePaths = [
		"packages/desktop/src/renderer/src/components/settings/SkillsPanel.tsx",
		"packages/desktop/src/renderer/src/components/workbench/SkillsConnectionsView.tsx",
		"packages/desktop/src/renderer/src/stores/settings.ts",
	];
	const skillSource = (await Promise.all(skillSourcePaths.map(sourceText))).join("\n");
	const skillOk =
		skillExistence &&
		skillSource.includes("getLoadedResources") &&
		compiledText.includes("getLoadedResources");
	addCheck(
		"skills-resource-contract",
		skillOk ? "PASS" : "FAIL",
		skillOk
			? `verified ${skillPaths.length} shipped skill files and loaded-resource projection`
			: "skill resource or loaded-resource contract is incomplete",
		{ paths: skillPaths, sourcePaths: skillSourcePaths, manifest: workbenchManifestPath },
	);

	const bundleManifestPath = "packages/desktop/pi-packages/package.json";
	const bundleManifest = JSON.parse(await readText(sourcePath(repoRoot, bundleManifestPath)));
	const bundleSourcePaths = [
		"packages/desktop/src/main/research-bundle.ts",
		"packages/desktop/src/main/index.ts",
		workbenchManifestPath,
	];
	const bundleSource = (await Promise.all(bundleSourcePaths.map(sourceText))).join("\n");
	const mcpVersion = workbenchManifest.bundledPackages?.find((item) => item.role === "mcp-runtime")?.version;
	const mcpContractOk =
		bundleManifest.dependencies?.["pi-mcp-adapter"] === mcpVersion &&
		bundleSource.includes("mcpRuntimePath") &&
		compiledText.includes("mcpRuntimePath");
	addCheck(
		"mcp-resource-contract",
		mcpContractOk ? "PASS" : "FAIL",
		mcpContractOk
			? "MCP runtime package declaration, manifest pin and host runtime path are present"
			: "MCP runtime contract is incomplete",
		{ sourcePaths: bundleSourcePaths, package: "pi-mcp-adapter" },
	);
	const stagedMcp = await exists(
		join(desktopRoot, "pi-packages", "node_modules", "pi-mcp-adapter", "package.json"),
	);
	addCheck(
		"mcp-staged-runtime",
		stagedMcp ? "PASS" : strict ? "FAIL" : "NOT_RUN",
		stagedMcp
			? "staged pi-mcp-adapter package is present"
			: "npm run build does not stage pi packages; run npm run stage:pi-packages or npm run dist for this optional check",
		{ path: "packages/desktop/pi-packages/node_modules/pi-mcp-adapter/package.json" },
	);

	const connectorSourcePaths = [
		"packages/desktop/src/renderer/src/components/workbench/SkillsConnectionsView.tsx",
		"packages/backend/src/knowledge/webdav.ts",
		"packages/backend/src/knowledge/webdav-sync.ts",
		"packages/backend/src/services/zotero.ts",
		"packages/shared/src/research-skill-sources.json",
	];
	const connectorSource = (await Promise.all(connectorSourcePaths.map(sourceText))).join("\n");
	const connectorMarkers = [
		"connector:webdav",
		"connector:zotero",
		"protocolsio-integration",
		"readOnlyScope",
	];
	const connectorOk =
		connectorSourcePaths.every((rel) => sourceTextCache.has(rel) && sourceTextCache.get(rel).length > 0) &&
		connectorMarkers.every((marker) => connectorSource.includes(marker));
	addCheck(
		"connector-readonly-contract",
		connectorOk ? "PASS" : "FAIL",
		connectorOk
			? "WebDAV/Zotero/Protocols.io read-only capability routes and source declarations are present"
			: "connector UI or source declaration is incomplete",
		{ sourcePaths: connectorSourcePaths, markers: connectorMarkers },
	);

	const memorySourcePaths = [
		"packages/desktop/src/renderer/src/components/settings/MemorySettingsRow.tsx",
		"packages/desktop/src/renderer/src/components/chat/MemoryCitationRow.tsx",
		"packages/backend/src/project/memory.ts",
		"packages/pi-core/src/tools/memory-save.ts",
	];
	const memorySource = (await Promise.all(memorySourcePaths.map(sourceText))).join("\n");
	const memoryOk =
		memorySourcePaths.every((rel) => sourceTextCache.has(rel) && sourceTextCache.get(rel).length > 0) &&
		["memoryGetStatus", "memoryList", "memoryPromote", "memory-settings", "memory-citations"].every(
			(marker) => memorySource.includes(marker) || compiledText.includes(marker),
		);
	addCheck(
		"memory-resource-contract",
		memoryOk ? "PASS" : "FAIL",
		memoryOk
			? "memory settings, citations, backend store and pi-core save tool are represented in the build"
			: "memory UI/backend/plugin contract is incomplete",
		{ sourcePaths: memorySourcePaths },
	);

	const redlineSourcePaths = [
		"packages/desktop/src/renderer/src/components/chat/RunInspector.tsx",
		"packages/desktop/src/renderer/src/components/knowledge/KnowledgeFlowCard.tsx",
		"packages/shared/src/analysis-orchestration.ts",
		"packages/shared/src/transcript/run-inspector.ts",
	];
	const redlineSource = (await Promise.all(redlineSourcePaths.map(sourceText))).join("\n");
	const redlineOk =
		redlineSourcePaths.every((rel) => sourceTextCache.has(rel) && sourceTextCache.get(rel).length > 0) &&
		redlineSource.includes("publication") &&
		compiledText.includes("publication") &&
		compiledText.includes("evidence");
	addCheck(
		"result-redline-contract",
		redlineOk ? "PASS" : "FAIL",
		redlineOk
			? "publication/evidence redline source and renderer projection are present"
			: "result redline source or compiled projection is incomplete",
		{ sourcePaths: redlineSourcePaths, markers: ["publication", "evidence"] },
	);

	const failCount = report.checks.filter((item) => item.status === "FAIL").length;
	report.status = failCount === 0 ? "PASS" : "FAIL";
	report.completedAt = new Date().toISOString();
	report.summary = {
		pass: report.checks.filter((item) => item.status === "PASS").length,
		notRun: report.checks.filter((item) => item.status === "NOT_RUN").length,
		fail: failCount,
		viewportCount: report.viewports.length,
	};
	await mkdir(dirname(reportPath), { recursive: true });
	await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
	console.log(JSON.stringify(report, null, 2));
	if (report.status !== "PASS") process.exitCode = 1;
}

await run();
