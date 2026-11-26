#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
	checkPluginDependency,
	stableVersion,
	verifyPluginApiTarball,
} from "./plugin-api-dependency-policy.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_DIR = join(ROOT, "packages", "plugin-api");
const apiName = "@gyoungwe/plugin-api";

function execNpm(args, options = {}) {
	return execFileSync("npm", args, { shell: process.platform === "win32", ...options });
}
const PLUGIN_REPO_CANDIDATES = [
	join(homedir(), "Documents", "ChatGPT", "drone-plugins"),
	resolve(ROOT, "../drone-plugins"),
];

function readJson(path) {
	return JSON.parse(readFileSync(path, "utf8"));
}

function assert(condition, message) {
	if (!condition) throw new Error(`[check:plugin-api] ${message}`);
}

function checkPackageManifest() {
	const manifest = readJson(join(PACKAGE_DIR, "package.json"));
	assert(manifest.name === apiName, `unexpected package name: ${manifest.name}`);
	assert(
		typeof manifest.version === "string" && stableVersion.test(manifest.version),
		`public API package must use a stable version: ${manifest.version}`,
	);
	assert(
		manifest.exports?.["./runtime"]?.types === "./dist/runtime.d.ts",
		"runtime types subpath must be published",
	);
	assert(!manifest.private, "public plugin-api package must not be private");
	assert(manifest.types === "./dist/index.d.ts", "types must point at dist/index.d.ts");
	assert(
		manifest.exports?.["."]?.types === "./dist/index.d.ts",
		"exports.types must point at dist/index.d.ts",
	);
	assert(!manifest.dependencies && !manifest.devDependencies, "plugin-api must remain dependency-free");
	return manifest.version;
}

function checkPackageSource() {
	const source = readFileSync(join(PACKAGE_DIR, "src", "index.ts"), "utf8");
	for (const specifier of ["electron", "@earendil-works/pi-", "@drone/backend", "@drone/desktop"]) {
		assert(
			!source.includes(specifier),
			`public contract imports forbidden implementation dependency: ${specifier}`,
		);
	}
}

function checkDist() {
	const dist = join(PACKAGE_DIR, "dist");
	assert(existsSync(join(dist, "index.d.ts")), "build output is missing dist/index.d.ts");
	assert(existsSync(join(dist, "runtime.d.ts")), "build output is missing dist/runtime.d.ts");
	assert(existsSync(join(dist, "runtime.js")), "build output is missing dist/runtime.js");
	assert(existsSync(join(dist, "index.js")), "build output is missing dist/index.js");
	const outputs = (directory, prefix = "") =>
		readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
			entry.isDirectory()
				? outputs(join(directory, entry.name), `${prefix}${entry.name}/`)
				: [`${prefix}${entry.name}`],
		);
	for (const name of outputs(dist)) {
		const path = join(dist, name);
		if (!name.endsWith(".js") && !name.endsWith(".d.ts")) continue;
		const output = readFileSync(path, "utf8");
		if (!name.startsWith("node/")) {
			assert(!/from ["']node:/u.test(output), `Node implementation leaked into ${name}`);
			assert(!/from ["'][^"']*\bnode\//u.test(output), `Node subpath leaked into ${name}`);
		}
		// Only the opt-in native declaration may reference the official SDK's type.
		// Keep the ban on every runtime output and on all other public subpaths.
		const dependencies =
			name === "native.d.ts"
				? output.replace(
						/^import type \{ ExtensionFactory \} from "@earendil-works\/pi-coding-agent";$/mu,
						"",
					)
				: output;
		for (const pattern of [
			/from ["']electron["']/u,
			/@earendil-works\/pi-/u,
			/@drone\/(?:backend|desktop)/u,
			/(?:from|import\s*\()["']\.\.\/\.\./u,
		]) {
			assert(!pattern.test(dependencies), `forbidden dependency in ${name}: ${pattern}`);
		}
	}
}

function checkHostPortContract() {
	const declarations = readFileSync(join(PACKAGE_DIR, "dist", "index.d.ts"), "utf8");
	assert(/\binterface DroneHostPort\s*\{/u.test(declarations), "dist/index.d.ts must expose DroneHostPort");
	for (const method of [
		"capabilities",
		"readSource",
		"searchKnowledge",
		"persistRun",
		"runCompute",
		"requestAuthorization",
	]) {
		assert(new RegExp(`\\b${method}\\s*\\(`, "u").test(declarations), `DroneHostPort is missing ${method}()`);
	}
	for (const type of ["AnalysisAdapterRegistryPort", "AnalysisHostPort", "AnalysisHostLoader"]) {
		assert(
			new RegExp(`\\binterface ${type}\\s*\\{`, "u").test(declarations),
			`analysis host contract is missing ${type}`,
		);
	}
}

function npmPack(packageDir, destination, env) {
	const args = ["pack", "--silent", "--ignore-scripts", packageDir, "--pack-destination", destination];
	const output = execNpm(args, { cwd: ROOT, encoding: "utf8", env }).trim().split(/\r?\n/u).at(-1);
	assert(output, `npm pack produced no tarball for ${packageDir}`);
	return join(destination, output);
}

function installTarball(tarball, version, options) {
	execNpm(["install", "--save-exact", "--ignore-scripts", "--no-audit", "--no-fund", tarball], options);
	const manifest = readJson(join(options.cwd, "node_modules", "@gyoungwe", "plugin-api", "package.json"));
	assert(
		manifest.name === apiName && manifest.version === version,
		`expected installed @gyoungwe/plugin-api@${version}, found ${manifest.name}@${manifest.version}`,
	);
	runContractProbe(options.cwd);
}

function writeContractProbe(fixture) {
	writeFileSync(
		join(fixture, "contract-probe.mjs"),
		`import assert from "node:assert/strict";
import { PLUGIN_API_VERSION, RESULT_CONTRACT, negotiateCapabilities } from "@gyoungwe/plugin-api";
await import("@gyoungwe/plugin-api/runtime");
assert.equal(PLUGIN_API_VERSION, 1);
assert.equal(RESULT_CONTRACT, "drone-result/v3");
const result = negotiateCapabilities(
  { pluginApi: 1, hosts: ["native-pi"], capabilities: ["requestAuthorization"] },
  { host: "native-pi", hostVersion: "1.1.0", pluginApiVersion: 1, capabilities: ["requestAuthorization"] },
);
assert.equal(result.status, "compatible");
console.log(JSON.stringify({ status: result.status, pluginApi: PLUGIN_API_VERSION, resultContract: RESULT_CONTRACT }));
`,
	);
}

function runContractProbe(fixture) {
	const output = execFileSync("node", ["contract-probe.mjs"], {
		cwd: fixture,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	assert(
		output.includes('"status":"compatible"'),
		"DroneHostPort contract probe did not negotiate compatible",
	);
}

function createRollbackTarball(currentTarball, destination, env) {
	const unpack = mkdtempSync(join(destination, "plugin-api-rollback-src-"));
	execFileSync("tar", ["-xzf", currentTarball, "-C", unpack, "--strip-components=1"], {
		stdio: "pipe",
	});
	const manifestPath = join(unpack, "package.json");
	const manifest = readJson(manifestPath);
	manifest.version = "0.9.0";
	writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
	return npmPack(unpack, destination, env);
}

function checkLocalInstall(version, archive, lifecycle) {
	const temp = mkdtempSync(join(tmpdir(), "drone-plugin-api-lifecycle-"));
	try {
		const env = {
			...process.env,
			npm_config_cache: join(temp, "npm-cache"),
			npm_config_logs: join(temp, "npm-logs"),
			npm_config_offline: "true",
		};
		const currentTarball = archive
			? join(temp, `gyoungwe-plugin-api-${version}.tgz`)
			: npmPack(PACKAGE_DIR, temp, env);
		if (archive) writeFileSync(currentTarball, archive);
		const fixture = join(temp, "fixture");
		const options = { cwd: fixture, stdio: "pipe", env };
		mkdirSync(fixture);
		writeFileSync(join(fixture, "package.json"), JSON.stringify({ private: true }));
		writeContractProbe(fixture);
		if (lifecycle) {
			const rollbackTarball = createRollbackTarball(currentTarball, temp, env);
			installTarball(rollbackTarball, "0.9.0", options);
			installTarball(currentTarball, version, options);
			installTarball(rollbackTarball, "0.9.0", options);
			execNpm(["uninstall", apiName, "--ignore-scripts", "--no-audit", "--no-fund"], options);
			assert(!existsSync(join(fixture, "node_modules", apiName)), "npm uninstall left plugin-api installed");
		} else {
			installTarball(currentTarball, version, options);
		}
		return basename(currentTarball);
	} finally {
		rmSync(temp, { recursive: true, force: true });
	}
}

function findPluginRepo(explicit) {
	const bound = explicit ?? process.env.DRONE_PLUGINS_DIR;
	if (bound !== undefined) {
		assert(bound && existsSync(join(bound, "package.json")), `invalid drone-plugins checkout: ${bound}`);
		return realpathSync(bound);
	}
	const found = PLUGIN_REPO_CANDIDATES.find((candidate) => existsSync(join(candidate, "package.json")));
	assert(found, "bound drone-plugins repository not found; pass --plugins-dir for CI");
	return realpathSync(found);
}

function walkPackageJson(dir, out = []) {
	if (!existsSync(dir)) return out;
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.name === "node_modules" || entry.name === ".git") continue;
		const path = join(dir, entry.name);
		if (entry.isDirectory()) walkPackageJson(path, out);
		else if (entry.name === "package.json") out.push(path);
	}
	return out;
}

function checkPluginWorkspace(repo, options) {
	const { releaseTarball, digest, releaseOnly } = options;
	const rootManifestPath = join(repo, "package.json");
	const rootManifest = readJson(rootManifestPath);
	assert(
		Array.isArray(rootManifest.workspaces) && rootManifest.workspaces.includes("packages/*"),
		"drone-plugins must remain one workspace",
	);
	const paths = walkPackageJson(repo);
	let pin;
	for (const path of paths) {
		const manifest = readJson(path);
		for (const section of [
			"dependencies",
			"devDependencies",
			"optionalDependencies",
			"peerDependencies",
			"overrides",
		]) {
			for (const [name, value] of Object.entries(manifest[section] ?? {})) {
				const dependency = checkPluginDependency(value, {
					hostRoot: ROOT,
					pluginRoot: repo,
					manifestPath: path,
					section,
					name,
					releaseTarball,
					releaseOnly,
				});
				if (path === rootManifestPath && dependency) pin = dependency;
			}
		}
	}
	if (releaseOnly) assert(pin?.url, "release-only mode requires the root plugin-api Release URL");
	if (releaseTarball)
		assert(pin?.sha256 === digest, "supplied tarball does not match the consumer plugin-api pin");
	const gitRoot = execFileSync("git", ["-C", repo, "rev-parse", "--show-toplevel"], {
		encoding: "utf8",
	}).trim();
	assert(realpathSync(gitRoot) === repo, "--plugins-dir must point to the checkout root");
	const head = execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
	return { repo, head, packageJsonFiles: paths.length, pin };
}

const { values } = parseArgs({
	options: {
		"package-only": { type: "boolean" },
		migration: { type: "boolean" },
		lifecycle: { type: "boolean" },
		"plugins-dir": { type: "string" },
		"release-only": { type: "boolean" },
		"release-tarball": { type: "string" },
		sha256: { type: "string" },
	},
});
const { lifecycle, "release-tarball": releaseTarball, sha256, "release-only": releaseOnly } = values;
const migration = values.migration || !values["package-only"];
if (releaseTarball !== undefined || sha256 !== undefined) {
	assert(
		(migration || lifecycle) && releaseTarball && /^[0-9a-f]{64}$/u.test(sha256),
		"use --migration or --package-only --lifecycle with both --release-tarball and --sha256",
	);
}
const version = checkPackageManifest();
checkPackageSource();
checkDist();
checkHostPortContract();
const archive = releaseTarball ? verifyPluginApiTarball(resolve(releaseTarball), version, sha256) : undefined;
const plugin = migration
	? checkPluginWorkspace(findPluginRepo(values["plugins-dir"]), {
			releaseTarball: archive,
			releaseOnly,
			digest: sha256,
		})
	: undefined;
const tarball = migration || lifecycle ? checkLocalInstall(version, archive, lifecycle) : undefined;
const migrationDetails = plugin
	? `; tarball=${tarball}; pluginRepo=${plugin.repo}; head=${plugin.head}; manifests=${plugin.packageJsonFiles}`
	: "";
console.log(`plugin-api package gate passed${migrationDetails}`);
const pin = plugin?.pin;
if (pin) console.log(JSON.stringify({ mode: pin.url ? "release-api" : "private-vendored-dev-api", ...pin }));
if (lifecycle) {
	console.log(
		JSON.stringify({
			status: "PASS",
			mode: archive ? "release-tarball-lifecycle" : "local-pack-lifecycle",
			install: "0.9.0",
			upgrade: version,
			rollback: "0.9.0",
			uninstall: "removed",
		}),
	);
}
