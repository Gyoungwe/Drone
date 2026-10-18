#!/usr/bin/env node

// Pack and install pi-analysis in a clean prefix, then load the installed
// extension through the real Pi resource loader. No model call or user state
// is used; the temporary directory is removed before the script exits.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const temp = mkdtempSync(join(tmpdir(), "drone-pi-analysis-smoke-"));
const packageDir = join(root, "packages/pi-analysis");
const installDir = join(temp, "install");
mkdirSync(installDir, { recursive: true });
try {
	const packOutput = execFileSync(
		"npm",
		["pack", "--workspace", "@gyoungwe/pi-analysis", "--pack-destination", temp],
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
	const packageJson = JSON.parse(
		readFileSync(join(installDir, "node_modules/@gyoungwe/pi-analysis/package.json"), "utf8"),
	);
	const extensionPath = join(installDir, "node_modules/@gyoungwe/pi-analysis", packageJson.pi.extensions[0]);
	const { DefaultResourceLoader, SettingsManager } = await import("@earendil-works/pi-coding-agent");
	const loader = new DefaultResourceLoader({
		cwd: installDir,
		agentDir: join(installDir, "agent"),
		settingsManager: SettingsManager.inMemory(),
		noExtensions: true,
		noSkills: true,
		additionalExtensionPaths: [extensionPath],
	});
	await loader.reload();
	const { extensions, errors } = loader.getExtensions();
	assert.deepEqual(errors, [], JSON.stringify(errors));
	const extension = extensions.find((item) => item.path === extensionPath);
	assert(extension, "installed pi-analysis extension was not discovered");
	assert.deepEqual([...extension.tools.keys()], ["analysis_list_adapters", "analysis_assess_readiness"]);
	console.log(`pi-analysis tarball install smoke passed (${packageDir}; ${extension.tools.size} tools)`);
} finally {
	rmSync(temp, { recursive: true, force: true });
}
