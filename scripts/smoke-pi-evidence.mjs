#!/usr/bin/env node

// Pack/install in a throwaway prefix and exercise only the read-only extension.
// No HOME, Pi agent directory, model, filesystem input or persistent state is used.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const temp = mkdtempSync(join(tmpdir(), "drone-pi-evidence-smoke-"));
const installDir = join(temp, "install");
mkdirSync(installDir, { recursive: true });
try {
	const packed = execFileSync(
		"npm",
		["pack", "--workspace", "@gyoungwe/pi-evidence", "--pack-destination", temp],
		{ cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
	);
	const tarballName = packed.trim().split(/\r?\n/u).at(-1);
	assert(tarballName, "npm pack did not return a tarball name");
	const tarball = join(temp, tarballName);
	execFileSync(
		"npm",
		[
			"install",
			"--prefix",
			installDir,
			"--ignore-scripts",
			"--omit=peer",
			"--no-audit",
			"--no-fund",
			tarball,
		],
		{ cwd: root, stdio: "ignore" },
	);
	const packageRoot = join(installDir, "node_modules/@gyoungwe/pi-evidence");
	const packageJson = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
	assert.equal(packageJson.pi.extensions[0], "./dist/index.mjs");
	const extension = await import(`file://${join(packageRoot, packageJson.pi.extensions[0])}`);
	const tools = new Map();
	const registration = extension.default({
		registerTool(tool) {
			tools.set(tool.name, tool);
		},
	});
	assert.deepEqual(registration.tools, [
		"evidence_validate_manifest",
		"evidence_validate_capsule",
		"evidence_verify_replay",
	]);
	assert.equal(tools.size, 3);
	assert([...tools.values()].every((tool) => tool.drone?.readOnly === true));
	const result = await tools.get("evidence_validate_manifest").execute("smoke", {
		manifest: {
			version: 1,
			entries: [
				{
					artifactId: "smoke",
					versionId: "smoke-v1",
					path: "smoke.txt",
					bytes: 5,
					sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
					role: "input",
					parentVersionIds: [],
				},
			],
		},
	});
	assert.equal(result.details.valid, true);
	console.log(`pi-evidence clean tarball install smoke passed (${tools.size} read-only tools)`);
} finally {
	rmSync(temp, { recursive: true, force: true });
}
