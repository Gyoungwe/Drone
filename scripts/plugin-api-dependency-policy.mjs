import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";

function assert(condition, message) {
	if (!condition) throw new Error(`[check:plugin-api] ${message}`);
}

function readJson(path) {
	return JSON.parse(readFileSync(path, "utf8"));
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

/** Private plugin-api 1.3.0 migration only; retire when the root dev dependency uses public 1.3.0. */
function checkCandidate(value, hostRoot, pluginRoot) {
	assert(
		/^file:vendor\/gyoungwe-plugin-api-1\.3\.0-[a-f0-9]{8}\.tgz$/u.test(value),
		"private API must use the fixed in-repository plugin-api 1.3.0 candidate path",
	);
	assert(readJson(join(pluginRoot, "package.json")).private === true, "candidate workspace must be private");
	const path = value.slice("file:".length);
	const bytes = committedArtifact(pluginRoot, path);
	assert(bytes.equals(committedArtifact(hostRoot, path)), "host and plugin API candidate bytes differ");
	const manifest = JSON.parse(
		execFileSync("tar", ["-xzOf", join(pluginRoot, path), "package/package.json"], { encoding: "utf8" }),
	);
	assert(
		manifest.name === "@gyoungwe/plugin-api" && manifest.version === "1.3.0",
		"vendored candidate package identity does not match plugin-api 1.3.0",
	);
	assert(
		readJson(join(hostRoot, "packages/plugin-api/package.json")).version === manifest.version,
		"vendored API version does not match the host contract",
	);
	const lock = readJson(join(pluginRoot, "package-lock.json"));
	const installed = lock.packages["node_modules/@gyoungwe/plugin-api"];
	assert(lock.packages[""].devDependencies[manifest.name] === value, "candidate root lock is stale");
	assert(
		installed.resolved === value && installed.version === manifest.version,
		"candidate install lock is stale",
	);
	assert(
		installed.integrity === `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
		"candidate lock integrity does not match its committed bytes",
	);
	return { path, version: manifest.version, sha256: createHash("sha256").update(bytes).digest("hex") };
}

export function checkPluginDependency(value, { hostRoot, pluginRoot, manifestPath, section, name }) {
	if (typeof value !== "string") return;
	const path = `${manifestPath}:${section}.${name}`;
	if (
		manifestPath === join(pluginRoot, "package.json") &&
		section === "devDependencies" &&
		name === "@gyoungwe/plugin-api" &&
		value.startsWith("file:")
	)
		return checkCandidate(value, hostRoot, pluginRoot);
	assert(!/^file:/u.test(value), `${path} uses a file: dependency (${value})`);
	assert(!/^workspace:/u.test(value), `${path} uses a workspace: dependency (${value})`);
	assert(!value.startsWith("/") && !value.startsWith("~/"), `${path} uses an absolute dependency (${value})`);
	assert(!/(^|\/)\.\.?\//u.test(value), `${path} uses a relative dependency (${value})`);
}
