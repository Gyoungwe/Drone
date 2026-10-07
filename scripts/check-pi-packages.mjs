// Verify the bundled pi packages (MCP runtime) end up loadable in the desktop app.
//
//   node scripts/check-pi-packages.mjs                    config mapping + staged tree + load smoke
//   node scripts/check-pi-packages.mjs --packaged <dist>  the same against every packaged app in <dist>
//                                                         (e.g. dist/linux-unpacked/resources, *.app/Contents/Resources)
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { PI_PACKAGES_DIR, verifyStaged } from "./stage-pi-packages.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RUNTIME = "pi-mcp-adapter";

function builderMapping() {
	const config = parse(readFileSync(join(root, "packages/desktop/electron-builder.yml"), "utf8"));
	const entry = config.extraResources.find((item) => item.from === "pi-packages/node_modules");
	assert(entry, "electron-builder.yml must copy pi-packages/node_modules into extraResources");
	assert.equal(
		entry.to,
		"pi-packages/node_modules",
		"desktop main loads <resources>/pi-packages/node_modules",
	);
	assert(entry.filter?.includes("**/*"), "pi-packages extraResources filter must include **/*");
	const main = readFileSync(join(root, "packages/desktop/src/main/index.ts"), "utf8");
	assert.match(
		main,
		/join\(process\.resourcesPath, "pi-packages", "node_modules"\)/,
		"main must resolve the shipped path",
	);
	const manifest = JSON.parse(readFileSync(join(root, ".pi/lib/workbench-manifest.json"), "utf8"));
	const declared = manifest.bundledPackages?.find((item) => item.package === RUNTIME);
	const pinned = JSON.parse(readFileSync(join(PI_PACKAGES_DIR, "package.json"), "utf8")).dependencies[
		RUNTIME
	];
	assert.equal(
		declared?.version,
		pinned,
		"workbench-manifest bundledPackages must match pi-packages/package.json",
	);
	const shared = readFileSync(join(root, "packages/shared/src/mcp.ts"), "utf8");
	assert(
		shared.includes(`MCP_RUNTIME_VERSION = "${pinned}"`),
		"MCP_RUNTIME_VERSION must match the pinned adapter",
	);
}

async function loadSmoke(nodeModules) {
	const { DefaultResourceLoader, SettingsManager } = await import("@earendil-works/pi-coding-agent");
	const pkg = JSON.parse(readFileSync(join(nodeModules, RUNTIME, "package.json"), "utf8"));
	const entry = join(nodeModules, RUNTIME, pkg.pi.extensions[0]);
	const temp = mkdtempSync(join(tmpdir(), "drone-pi-packages-"));
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = join(temp, "agent");
	try {
		const loader = new DefaultResourceLoader({
			cwd: temp,
			agentDir: join(temp, "agent"),
			settingsManager: SettingsManager.inMemory(),
			noExtensions: true,
			noSkills: true,
			additionalExtensionPaths: [entry],
		});
		await loader.reload();
		const { extensions, errors } = loader.getExtensions();
		assert.deepEqual(errors, [], `bundled ${RUNTIME} failed to load`);
		const runtime = extensions.find((extension) => extension.path === entry);
		assert(runtime, `bundled ${RUNTIME} extension not loaded from ${entry}`);
		assert(runtime.tools.has("mcp"), `bundled ${RUNTIME} did not register the mcp proxy tool`);
		assert(runtime.commands.has("mcp"), `bundled ${RUNTIME} did not register /mcp`);
	} finally {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
		rmSync(temp, { recursive: true, force: true });
	}
}

function packagedResources(dir, depth = 0, found = []) {
	if (depth > 5 || !existsSync(dir)) return found;
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
		const path = join(dir, entry.name);
		if (/^resources$/i.test(entry.name) && existsSync(join(path, "app.asar"))) found.push(path);
		else if (!entry.name.endsWith(".asar.unpacked") && entry.name !== "node_modules")
			packagedResources(path, depth + 1, found);
	}
	return found;
}

const packagedArg = process.argv.indexOf("--packaged");
builderMapping();
if (packagedArg >= 0) {
	const dist = resolve(process.argv[packagedArg + 1] ?? "");
	const targets = packagedResources(dist);
	assert(targets.length > 0, `no packaged app resources found under ${dist}`);
	for (const resources of targets) {
		const nodeModules = join(resources, "pi-packages", "node_modules");
		const versions = verifyStaged(nodeModules);
		await loadSmoke(nodeModules);
		console.log(`[check-pi-packages] ${resources}: ${JSON.stringify(versions)}`);
	}
} else {
	const nodeModules = join(PI_PACKAGES_DIR, "node_modules");
	const versions = verifyStaged(nodeModules);
	await loadSmoke(nodeModules);
	console.log(`[check-pi-packages] staged ${JSON.stringify(versions)}`);
}
