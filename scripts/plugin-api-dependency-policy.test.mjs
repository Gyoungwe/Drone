import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { checkPluginDependency } from "./plugin-api-dependency-policy.mjs";

const candidate = "vendor/gyoungwe-plugin-api-1.3.0-deadbeef.tgz";
let root, hostRoot, pluginRoot, location;
const json = (path, value) => writeFile(path, JSON.stringify(value));
const git = (directory, ...args) => execFileSync("git", ["-C", directory, ...args], { stdio: "pipe" });
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "drone-api-candidate-policy-"));
	hostRoot = join(root, "host");
	pluginRoot = join(root, "plugins");
	await mkdir(join(root, "archive/package"), { recursive: true });
	await json(join(root, "archive/package/package.json"), { name: "@gyoungwe/plugin-api", version: "1.3.0" });
	for (const directory of [hostRoot, pluginRoot]) {
		await mkdir(join(directory, "vendor"), { recursive: true });
		git(directory, "init", "--quiet");
	}
	execFileSync("tar", ["-czf", join(hostRoot, candidate), "-C", join(root, "archive"), "package"]);
	await copyFile(join(hostRoot, candidate), join(pluginRoot, candidate));
	for (const directory of [hostRoot, pluginRoot]) {
		git(directory, "add", candidate);
		git(
			directory,
			"-c",
			"user.name=Test",
			"-c",
			"user.email=test@example.invalid",
			"commit",
			"--quiet",
			"-m",
			"candidate",
		);
	}
	await mkdir(join(hostRoot, "packages/plugin-api"), { recursive: true });
	await json(join(hostRoot, "packages/plugin-api/package.json"), { version: "1.3.0" });
	await json(join(pluginRoot, "package.json"), { private: true });
	const value = `file:${candidate}`;
	const integrity = `sha512-${createHash("sha512")
		.update(await readFile(join(hostRoot, candidate)))
		.digest("base64")}`;
	await json(join(pluginRoot, "package-lock.json"), {
		packages: {
			"": { devDependencies: { "@gyoungwe/plugin-api": value } },
			"node_modules/@gyoungwe/plugin-api": { version: "1.3.0", resolved: value, integrity },
		},
	});
	location = {
		hostRoot,
		pluginRoot,
		manifestPath: join(pluginRoot, "package.json"),
		section: "devDependencies",
		name: "@gyoungwe/plugin-api",
	};
});
afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

test("accepts only the same committed API package with an exact clean-install lock", () => {
	assert.deepEqual(checkPluginDependency(`file:${candidate}`, location), {
		path: candidate,
		version: "1.3.0",
		sha256: createHash("sha256")
			.update(execFileSync("git", ["-C", hostRoot, "show", `HEAD:${candidate}`]))
			.digest("hex"),
	});
});

test("does not exempt published package, runtime, peer, override or unrelated file dependencies", () => {
	for (const override of [
		{ manifestPath: join(pluginRoot, "packages/plugin/package.json") },
		{ section: "dependencies" },
		{ section: "peerDependencies" },
		{ section: "overrides" },
		{ name: "other-package" },
	])
		assert.throws(
			() => checkPluginDependency(`file:${candidate}`, { ...location, ...override }),
			/file: dependency/u,
		);
	for (const value of ["workspace:*", "../Drone/packages/plugin-api", "/tmp/plugin-api", "~/plugin-api"])
		assert.throws(() => checkPluginDependency(value, location), /dependency/u);
});

test("rejects arbitrary, cross-repository and uncommitted candidate paths", async () => {
	for (const value of [
		"file:../Drone/vendor/api.tgz",
		"file:vendor/api.tgz",
		"file:vendor/gyoungwe-plugin-api-1.2.0-deadbeef.tgz",
	])
		assert.throws(() => checkPluginDependency(value, location), /fixed in-repository/u);
	await writeFile(join(pluginRoot, candidate), "changed archive");
	assert.throws(() => checkPluginDependency(`file:${candidate}`, location), /committed artifact/u);
});

test("rejects mismatched committed artifacts and symlinked candidate files", async () => {
	await writeFile(join(pluginRoot, candidate), "different committed archive");
	git(pluginRoot, "add", candidate);
	git(
		pluginRoot,
		"-c",
		"user.name=Test",
		"-c",
		"user.email=test@example.invalid",
		"commit",
		"--quiet",
		"-m",
		"different",
	);
	assert.throws(() => checkPluginDependency(`file:${candidate}`, location), /candidate bytes differ/u);
	await rm(join(pluginRoot, candidate));
	await symlink(join(hostRoot, candidate), join(pluginRoot, candidate));
	assert.throws(() => checkPluginDependency(`file:${candidate}`, location), /regular vendored artifact/u);
});

test("rejects stale or forged lock integrity and nonprivate workspaces", async () => {
	const path = join(pluginRoot, "package-lock.json"),
		lock = JSON.parse(await readFile(path, "utf8"));
	lock.packages["node_modules/@gyoungwe/plugin-api"].integrity = "sha512-forged";
	await json(path, lock);
	assert.throws(() => checkPluginDependency(`file:${candidate}`, location), /lock integrity/u);
	await json(join(pluginRoot, "package.json"), { private: false });
	assert.throws(() => checkPluginDependency(`file:${candidate}`, location), /workspace must be private/u);
});

test("rejects another package disguised as the private API artifact", async () => {
	await json(join(root, "archive/package/package.json"), { name: "wrong-package", version: "1.3.0" });
	execFileSync("tar", ["-czf", join(hostRoot, candidate), "-C", join(root, "archive"), "package"]);
	await copyFile(join(hostRoot, candidate), join(pluginRoot, candidate));
	for (const directory of [hostRoot, pluginRoot]) {
		git(directory, "add", candidate);
		git(
			directory,
			"-c",
			"user.name=Test",
			"-c",
			"user.email=test@example.invalid",
			"commit",
			"--quiet",
			"-m",
			"wrong identity",
		);
	}
	assert.throws(() => checkPluginDependency(`file:${candidate}`, location), /package identity/u);
});
