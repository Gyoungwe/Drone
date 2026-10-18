#!/usr/bin/env node

// Pack and install pi-connectors in a clean prefix, then load it through the
// real Pi resource loader. No network connector, credential or external write
// is used; all state is removed before the script exits.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const temp = mkdtempSync(join(tmpdir(), "drone-pi-connectors-smoke-"));
const packageDir = join(root, "packages/pi-connectors");
const installDir = join(temp, "install");
mkdirSync(installDir, { recursive: true });
try {
	const packOutput = execFileSync(
		"npm",
		["pack", "--workspace", "@gyoungwe/pi-connectors", "--pack-destination", temp],
		{ cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
	);
	const tarballName = packOutput.trim().split(/\r?\n/u).at(-1);
	assert(tarballName, "npm pack did not return a tarball name");
	const tarball = join(temp, tarballName);
	execFileSync(
		"npm",
		["install", "--prefix", installDir, "--ignore-scripts", "--no-audit", "--no-fund", tarball],
		{ cwd: root, stdio: "ignore" },
	);
	const installedRoot = join(installDir, "node_modules/@gyoungwe/pi-connectors");
	const packageJson = JSON.parse(readFileSync(join(installedRoot, "package.json"), "utf8"));
	assert(existsSync(join(installedRoot, "plugin.manifest.json")), "plugin manifest missing from tarball");
	const installed = await import(pathToFileURL(join(installedRoot, "dist/index.mjs")).href);
	const registry = installed.createConnectorRegistry();
	assert.deepEqual(
		registry.list().map((descriptor) => descriptor.id),
		["browser", "generic-mcp", "institutional", "search", "webdav", "zotero"],
	);
	const tools = [];
	const registration = installed.registerPiConnectors({ registerTool: (tool) => tools.push(tool) });
	assert.deepEqual(registration.tools, ["connector_list", "connector_get"]);
	assert.deepEqual(packageJson.pi.extensions, ["./dist/index.mjs"]);

	const { DefaultResourceLoader, SettingsManager } = await import("@earendil-works/pi-coding-agent");
	const loader = new DefaultResourceLoader({
		cwd: installDir,
		agentDir: join(installDir, "agent"),
		settingsManager: SettingsManager.inMemory(),
		noExtensions: true,
		noSkills: true,
		additionalExtensionPaths: [join(installedRoot, packageJson.pi.extensions[0])],
	});
	await loader.reload();
	const { extensions, errors } = loader.getExtensions();
	assert.deepEqual(errors, [], JSON.stringify(errors));
	const extension = extensions.find((item) => item.path === join(installedRoot, "dist/index.mjs"));
	assert(extension, "installed pi-connectors extension was not discovered");
	assert.deepEqual([...extension.tools.keys()], ["connector_list", "connector_get"]);

	execFileSync(
		"npm",
		[
			"uninstall",
			"--prefix",
			installDir,
			"--ignore-scripts",
			"--no-audit",
			"--no-fund",
			"@gyoungwe/pi-connectors",
		],
		{ cwd: root, stdio: "ignore" },
	);
	assert.equal(existsSync(installedRoot), false, "tarball install was not removed");
	console.log(`pi-connectors tarball install smoke passed (${packageDir}; ${extension.tools.size} tools)`);
} finally {
	rmSync(temp, { recursive: true, force: true });
}
