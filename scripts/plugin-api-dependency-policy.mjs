import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { sha256, verifyPackageTarball } from "./fetch-plugins-release.mjs";

const apiName = "@gyoungwe/plugin-api";
const installPath = `node_modules/${apiName}`;
export const stableVersion = /^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){2}$/u;
const canonicalReleaseUrl =
	/^https:\/\/github\.com\/Gyoungwe\/Drone\/releases\/download\/plugin-api-v((?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){2})\/gyoungwe-plugin-api-\1\.tgz$/u;
const sha512Integrity = (bytes) => `sha512-${createHash("sha512").update(bytes).digest("base64")}`;

function assert(condition, message) {
	if (!condition) throw new Error(`[check:plugin-api] ${message}`);
}

function readJson(path) {
	return JSON.parse(readFileSync(path, "utf8"));
}

function compareSemver(left, right) {
	const leftParts = left.split(".").map(BigInt);
	const rightParts = right.split(".").map(BigInt);
	for (let index = 0; index < 3; index += 1) {
		if (leftParts[index] < rightParts[index]) return -1;
		if (leftParts[index] > rightParts[index]) return 1;
	}
	return 0;
}

function parseCompatibleReleasePin(value, hostVersion, releaseTarball) {
	const match = canonicalReleaseUrl.exec(value);
	assert(match, "plugin-api must use the canonical Release URL with matching tag and asset versions");
	const pinnedVersion = match[1];
	const pinnedMajor = pinnedVersion.split(".")[0];
	const hostMajor = hostVersion.split(".")[0];
	assert(
		pinnedMajor === hostMajor &&
			compareSemver(pinnedVersion, hostVersion) <= 0 &&
			(releaseTarball === undefined || pinnedVersion === hostVersion),
		"plugin-api pin must use a compatible canonical Release URL for the host version",
	);
	return { pinnedUrl: value, pinnedVersion };
}

function committedArtifact(root, path) {
	assert(
		realpathSync(join(root, "vendor")) === join(realpathSync(root), "vendor"),
		"candidate vendor directory must stay in its repository",
	);
	assert(lstatSync(join(root, path)).isFile(), `${path} must be a regular vendored artifact`);
	const committed = execFileSync("git", ["-C", root, "show", `HEAD:${path}`]);
	const bytes = readFileSync(join(root, path));
	assert(bytes.equals(committed), `${root}/${path} differs from its committed artifact`);
	return bytes;
}

/** Private plugin-api migration only; retire when the root dev dependency uses a public release. */
function checkCandidate(value, hostRoot, pluginRoot) {
	assert(
		/^file:vendor\/gyoungwe-plugin-api-2\.0\.0-[a-f0-9]{8}\.tgz$/u.test(value),
		"private API must use the fixed in-repository plugin-api 2.0.0 candidate path",
	);
	assert(readJson(join(pluginRoot, "package.json")).private === true, "candidate workspace must be private");
	const path = value.slice("file:".length);
	const bytes = committedArtifact(pluginRoot, path);
	assert(bytes.equals(committedArtifact(hostRoot, path)), "host and plugin API candidate bytes differ");
	const manifest = JSON.parse(
		execFileSync("tar", ["-xzOf", join(pluginRoot, path), "package/package.json"], { encoding: "utf8" }),
	);
	assert(
		manifest.name === apiName && manifest.version === "2.0.0",
		"vendored candidate package identity does not match plugin-api 2.0.0",
	);
	assert(
		readJson(join(hostRoot, "packages/plugin-api/package.json")).version === manifest.version,
		"vendored API version does not match the host contract",
	);
	const lock = readJson(join(pluginRoot, "package-lock.json"));
	const installed = lock.packages[installPath];
	assert(lock.packages[""].devDependencies[manifest.name] === value, "candidate root lock is stale");
	assert(
		installed.resolved === value && installed.version === manifest.version,
		"candidate install lock is stale",
	);
	assert(
		installed.integrity === sha512Integrity(bytes),
		"candidate lock integrity does not match its committed bytes",
	);
	return { path, version: manifest.version, sha256: sha256(bytes) };
}

export function verifyPluginApiTarball(input, version, digest) {
	if (typeof input === "string") assert(lstatSync(input).isFile(), "release tarball must be a regular file");
	const bytes = typeof input === "string" ? readFileSync(input) : input;
	assert(sha256(bytes) === digest, "release tarball SHA-256 mismatch");
	verifyPackageTarball(bytes, { name: apiName, version });
	return bytes;
}

function checkReleaseInstalls(packages, version, url, integrity) {
	assert(packages[installPath] && !packages[installPath].inBundle, "plugin-api root install lock is missing");
	for (const [path, entry] of Object.entries(packages)) {
		if (path !== installPath && !path.endsWith(`/${installPath}`) && entry.name !== apiName) continue;
		assert(
			entry.resolved === url || (entry.inBundle === true && entry.resolved === undefined),
			`${path}: plugin-api lock resolved must equal the Release URL`,
		);
		if (entry.inBundle === true) continue;
		assert(entry.version === version, `${path}: plugin-api lock version is stale`);
		assert(
			typeof entry.integrity === "string" && entry.integrity.startsWith("sha512-"),
			`${path}: plugin-api lock requires SHA-512 integrity`,
		);
		if (integrity)
			assert(entry.integrity === integrity, `${path}: release tarball SHA-512 integrity mismatch`);
	}
}

function checkRelease(value, options, rootManifest, workspace) {
	const { hostRoot, pluginRoot, releaseTarball } = options;
	const { name, version: hostVersion } = readJson(join(hostRoot, "packages/plugin-api/package.json"));
	assert(
		name === apiName && typeof hostVersion === "string" && stableVersion.test(hostVersion),
		"invalid host plugin-api package identity",
	);
	const { pinnedUrl, pinnedVersion } = parseCompatibleReleasePin(value, hostVersion, releaseTarball);
	assert(rootManifest.private === true, "release workspace must be private");
	assert(
		rootManifest.devDependencies?.[apiName] === pinnedUrl,
		"plugin-api root dev dependency must use the Release URL",
	);
	const digest = rootManifest.dronePluginApiSha256;
	assert(typeof digest === "string" && /^[0-9a-f]{64}$/u.test(digest), "invalid root dronePluginApiSha256");
	const { packages } = readJson(join(pluginRoot, "package-lock.json"));
	assert(packages?.[""]?.devDependencies?.[apiName] === pinnedUrl, "plugin-api root lock is stale");
	if (workspace) {
		assert(
			packages[workspace]?.dependencies?.[apiName] === pinnedUrl,
			`${workspace}: plugin-api workspace lock is stale`,
		);
	}
	const integrity =
		releaseTarball === undefined
			? undefined
			: sha512Integrity(verifyPluginApiTarball(releaseTarball, pinnedVersion, digest));
	checkReleaseInstalls(packages, pinnedVersion, pinnedUrl, integrity);
	return { url: pinnedUrl, version: pinnedVersion, sha256: digest };
}

export function checkPluginDependency(value, options) {
	if (typeof value !== "string") return;
	const { hostRoot, pluginRoot, manifestPath, section, name, releaseOnly } = options;
	const path = `${manifestPath}:${section}.${name}`;
	const rootPath = join(pluginRoot, "package.json");
	const rootDev = manifestPath === rootPath && section === "devDependencies";
	const workspace = relative(pluginRoot, dirname(manifestPath)).split(sep).join("/");
	if (name === apiName && (rootDev || (section === "dependencies" && /^packages\/[^/]+$/u.test(workspace)))) {
		assert(
			!releaseOnly || !value.startsWith("file:"),
			"release-only mode rejects file: plugin-api dependencies",
		);
		const rootManifest = readJson(rootPath);
		if (
			releaseOnly ||
			/^https?:/iu.test(value) ||
			rootManifest.devDependencies?.[apiName]?.startsWith("https://")
		)
			return checkRelease(value, options, rootManifest, workspace);
		if (rootDev && value.startsWith("file:")) return checkCandidate(value, hostRoot, pluginRoot);
	}
	assert(!/^file:/u.test(value), `${path} uses a file: dependency (${value})`);
	assert(!/^workspace:/u.test(value), `${path} uses a workspace: dependency (${value})`);
	assert(!value.startsWith("/") && !value.startsWith("~/"), `${path} uses an absolute dependency (${value})`);
	assert(!/(^|\/)\.\.?\//u.test(value), `${path} uses a relative dependency (${value})`);
}
