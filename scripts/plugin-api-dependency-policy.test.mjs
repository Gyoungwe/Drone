import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { checkPluginDependency } from "./plugin-api-dependency-policy.mjs";

const candidate = "vendor/gyoungwe-plugin-api-2.0.0-deadbeef.tgz";
const apiName = "@gyoungwe/plugin-api";
const releaseUrlFor = (version) =>
	`https://github.com/Gyoungwe/Drone/releases/download/plugin-api-v${version}/gyoungwe-plugin-api-${version}.tgz`;
const releaseUrl = releaseUrlFor("2.0.0");
let root, hostRoot, pluginRoot, location;
const json = (path, value) => writeFile(path, JSON.stringify(value));
const git = (directory, ...args) => execFileSync("git", ["-C", directory, ...args], { stdio: "pipe" });
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "drone-api-dependency-policy-"));
	hostRoot = join(root, "host");
	pluginRoot = join(root, "plugins");
	await mkdir(join(root, "archive/package"), { recursive: true });
	await json(join(root, "archive/package/package.json"), { name: "@gyoungwe/plugin-api", version: "2.0.0" });
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
	await json(join(hostRoot, "packages/plugin-api/package.json"), { name: apiName, version: "2.0.0" });
	await json(join(pluginRoot, "package.json"), { private: true });
	const value = `file:${candidate}`;
	const integrity = `sha512-${createHash("sha512")
		.update(await readFile(join(hostRoot, candidate)))
		.digest("base64")}`;
	await json(join(pluginRoot, "package-lock.json"), {
		packages: {
			"": { devDependencies: { "@gyoungwe/plugin-api": value } },
			"node_modules/@gyoungwe/plugin-api": { version: "2.0.0", resolved: value, integrity },
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

async function releaseFixture({ hostVersion = "2.0.0", pinnedVersion = hostVersion } = {}) {
	const tarball = join(hostRoot, candidate);
	const bytes = await readFile(tarball);
	const sha256 = createHash("sha256").update(bytes).digest("hex");
	const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
	const url = releaseUrlFor(pinnedVersion);
	await json(join(hostRoot, "packages/plugin-api/package.json"), { name: apiName, version: hostVersion });
	const manifest = {
		private: true,
		devDependencies: { [apiName]: url },
		dronePluginApiSha256: sha256,
	};
	const workspace = "packages/example";
	const manifestPath = join(pluginRoot, workspace, "package.json");
	const leaf = { dependencies: { [apiName]: url } };
	const installed = { version: pinnedVersion, resolved: url, integrity };
	const lock = {
		packages: {
			"": { devDependencies: manifest.devDependencies },
			[workspace]: leaf,
			[`node_modules/${apiName}`]: installed,
		},
	};
	const lockPath = join(pluginRoot, "package-lock.json");
	await mkdir(join(pluginRoot, workspace), { recursive: true });
	await json(location.manifestPath, manifest);
	await json(manifestPath, leaf);
	await json(lockPath, lock);
	return { tarball, bytes, sha256, url, manifest, manifestPath, lock, lockPath, installed, workspace };
}

test("accepts release URL pins when root, workspace, lock and verified bytes agree", async () => {
	const { tarball, bytes, manifestPath, sha256 } = await releaseFixture();
	const pin = { url: releaseUrl, version: "2.0.0", sha256 };
	assert.deepEqual(checkPluginDependency(releaseUrl, { ...location, releaseTarball: tarball }), pin);
	assert.deepEqual(
		checkPluginDependency(releaseUrl, {
			...location,
			manifestPath,
			section: "dependencies",
			releaseTarball: bytes,
		}),
		pin,
	);
});

test("accepts an older same-major release pin before the host release", async () => {
	const { url, sha256 } = await releaseFixture({ hostVersion: "2.1.0", pinnedVersion: "2.0.0" });
	assert.deepEqual(checkPluginDependency(url, location), { url, version: "2.0.0", sha256 });
});

test("rejects cross-major and host-ahead release pins", async () => {
	for (const pinnedVersion of ["1.2.0", "3.0.0", "2.1.1", "2.2.0"]) {
		const { url } = await releaseFixture({ hostVersion: "2.1.0", pinnedVersion });
		assert.throws(() => checkPluginDependency(url, location), /canonical Release URL/u, pinnedVersion);
	}
});

test("rejects a workspace release pin that differs from the root pin", async () => {
	const { manifestPath, workspace, lock, lockPath } = await releaseFixture({
		hostVersion: "2.1.0",
		pinnedVersion: "2.0.0",
	});
	const workspaceUrl = releaseUrlFor("2.1.0");
	lock.packages[workspace].dependencies[apiName] = workspaceUrl;
	await json(lockPath, lock);
	await json(manifestPath, { dependencies: { [apiName]: workspaceUrl } });
	const workspaceDependency = { ...location, manifestPath, section: "dependencies" };
	assert.throws(
		() => checkPluginDependency(workspaceUrl, workspaceDependency),
		/root dev dependency must use the Release URL/u,
	);
});

test("requires the host version when verifying an explicit release tarball", async () => {
	const { url, bytes } = await releaseFixture({ hostVersion: "2.1.0", pinnedVersion: "2.0.0" });
	assert.throws(
		() => checkPluginDependency(url, { ...location, releaseTarball: bytes }),
		/canonical Release URL/u,
	);
});

test("rejects bogus release hosts, repositories, tags and asset filenames", async () => {
	await releaseFixture();
	for (const value of [
		releaseUrl.replace("github.com", "github.com.example.invalid"),
		releaseUrl.replace("https:", "http:"),
		releaseUrl.replace("Gyoungwe/Drone", "Gyoungwe/drone-plugins"),
		releaseUrl.replace("plugin-api-v2.0.0", "plugin-api-v2.0.1"),
		releaseUrl.replace("gyoungwe-plugin-api-2.0.0.tgz", "plugin-api.tgz"),
		`${releaseUrl}?candidate=1`,
	])
		assert.throws(() => checkPluginDependency(value, location), /canonical Release URL/u);
});

test("requires a private release-pinned root with a lowercase SHA-256", async () => {
	const { manifest } = await releaseFixture();
	await json(location.manifestPath, { ...manifest, private: false });
	assert.throws(() => checkPluginDependency(releaseUrl, location), /workspace must be private/u);
	await json(location.manifestPath, { ...manifest, dronePluginApiSha256: "A".repeat(64) });
	assert.throws(() => checkPluginDependency(releaseUrl, location), /dronePluginApiSha256/u);
	await json(location.manifestPath, { ...manifest, devDependencies: {} });
	assert.throws(() => checkPluginDependency(releaseUrl, location), /root dev dependency/u);
});

test("verifies supplied release bytes against SHA-256, SHA-512 and package identity", async () => {
	const { bytes, tarball, lock, lockPath, installed, manifest } = await releaseFixture();
	assert.throws(
		() =>
			checkPluginDependency(releaseUrl, {
				...location,
				releaseTarball: Buffer.concat([bytes, Buffer.from("other")]),
			}),
		/SHA-256 mismatch/u,
	);
	installed.integrity = `sha512-${createHash("sha512").update("other").digest("base64")}`;
	await json(lockPath, lock);
	assert.throws(
		() => checkPluginDependency(releaseUrl, { ...location, releaseTarball: tarball }),
		/SHA-512 integrity mismatch/u,
	);
	await json(join(root, "archive/package/package.json"), { name: apiName, version: "3.0.0" });
	const wrong = execFileSync("tar", ["-czf", "-", "-C", join(root, "archive"), "package"]);
	await json(location.manifestPath, {
		...manifest,
		dronePluginApiSha256: createHash("sha256").update(wrong).digest("hex"),
	});
	installed.integrity = `sha512-${createHash("sha512").update(wrong).digest("base64")}`;
	await json(lockPath, lock);
	assert.throws(
		() => checkPluginDependency(releaseUrl, { ...location, releaseTarball: wrong }),
		/package identity/u,
	);
});

test("requires root and workspace lock specs to equal the release pin", async () => {
	const { installed, lock, lockPath, manifestPath, workspace } = await releaseFixture();
	lock.packages[""].devDependencies[apiName] = "2.0.0";
	await json(lockPath, lock);
	assert.throws(() => checkPluginDependency(releaseUrl, location), /root lock is stale/u);
	lock.packages[""].devDependencies[apiName] = releaseUrl;
	lock.packages[workspace].dependencies[apiName] = "2.0.0";
	await json(lockPath, lock);
	const leaf = { ...location, manifestPath, section: "dependencies" };
	assert.throws(() => checkPluginDependency(releaseUrl, leaf), /workspace lock is stale/u);
	assert.throws(() => checkPluginDependency("2.0.0", leaf), /canonical Release URL/u);
	installed.version = "1.3.0";
	await json(lockPath, lock);
	assert.throws(() => checkPluginDependency(releaseUrl, location), /lock version is stale/u);
});

test("checks nested lock resolutions and permits bundled entries without a resolved URL", async () => {
	const { bytes, lock, lockPath, installed } = await releaseFixture();
	const nested = `node_modules/parent/node_modules/${apiName}`;
	lock.packages[nested] = { version: "2.0.0", inBundle: true };
	await json(lockPath, lock);
	assert.equal(checkPluginDependency(releaseUrl, { ...location, releaseTarball: bytes }).url, releaseUrl);
	const registry = "https://registry.npmjs.org/@gyoungwe/plugin-api/-/plugin-api-2.0.0.tgz";
	for (const inBundle of [false, true]) {
		lock.packages[nested] = { ...installed, inBundle, resolved: registry };
		await json(lockPath, lock);
		assert.throws(() => checkPluginDependency(releaseUrl, location), /lock resolved must equal/u);
	}
	lock.packages[nested] = { ...installed, integrity: "sha1-stale" };
	await json(lockPath, lock);
	assert.throws(() => checkPluginDependency(releaseUrl, location), /requires SHA-512 integrity/u);
});

test("release-only mode rejects the otherwise valid committed file candidate", () => {
	assert.throws(
		() => checkPluginDependency(`file:${candidate}`, { ...location, releaseOnly: true }),
		/release-only/u,
	);
});

test("accepts only the same committed API package with an exact clean-install lock", () => {
	assert.deepEqual(checkPluginDependency(`file:${candidate}`, location), {
		path: candidate,
		version: "2.0.0",
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
	await json(join(root, "archive/package/package.json"), { name: "wrong-package", version: "2.0.0" });
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
