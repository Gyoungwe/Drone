#!/usr/bin/env node
/**
 * PR-5 public-contract and migration gate.
 *
 * The check intentionally uses only Node built-ins. It validates the package
 * boundary, installs the packed tarball into a throwaway fixture, and inspects
 * the separately bound drone-plugins workspace for source-repository paths.
 * It never writes to the plugin repository or to a user's package manager
 * state.
 */
import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_DIR = join(ROOT, "packages", "plugin-api");
const PLUGIN_REPO_CANDIDATES = [
	process.env.DRONE_PLUGINS_DIR,
	join(homedir(), "Documents", "ChatGPT", "drone-plugins"),
	resolve(ROOT, "../drone-plugins"),
].filter(Boolean);

function readJson(path) {
	return JSON.parse(readFileSync(path, "utf8"));
}

function fail(message) {
	throw new Error(`[check:plugin-api] ${message}`);
}

function assert(condition, message) {
	if (!condition) fail(message);
}

function packageJson() {
	const path = join(PACKAGE_DIR, "package.json");
	assert(existsSync(path), "packages/plugin-api/package.json is missing");
	return readJson(path);
}

function checkPackageManifest() {
	const manifest = packageJson();
	assert(manifest.name === "@gyoungwe/plugin-api", `unexpected package name: ${manifest.name}`);
	assert(
		manifest.version === "1.0.0",
		`public API package must stay at 1.0.0 during v1: ${manifest.version}`,
	);
	assert(!manifest.private, "public plugin-api package must not be private");
	assert(manifest.types === "./dist/index.d.ts", "types must point at dist/index.d.ts");
	assert(
		manifest.exports?.["."]?.types === "./dist/index.d.ts",
		"exports.types must point at dist/index.d.ts",
	);
	assert(!manifest.dependencies && !manifest.devDependencies, "plugin-api must remain dependency-free");
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
	assert(existsSync(join(dist, "index.js")), "build output is missing dist/index.js");
	for (const name of readdirSync(dist)) {
		const path = join(dist, name);
		if (!name.endsWith(".js") && !name.endsWith(".d.ts")) continue;
		const output = readFileSync(path, "utf8");
		for (const pattern of [
			/from ["']electron["']/u,
			/@earendil-works\/pi-/u,
			/@drone\/(?:backend|desktop)/u,
			/(?:from|import\s*\()["']\.\.\/\.\./u,
		]) {
			assert(!pattern.test(output), `forbidden dependency in ${name}: ${pattern}`);
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
}

function checkPackageOnly() {
	checkPackageManifest();
	checkPackageSource();
	checkDist();
	checkHostPortContract();
}

function npmPack(packageDir, destination, env) {
	const output = execFileSync("npm", ["pack", "--silent", packageDir, "--pack-destination", destination], {
		cwd: ROOT,
		encoding: "utf8",
		env,
	})
		.trim()
		.split(/\r?\n/u)
		.at(-1);
	assert(output, `npm pack produced no tarball for ${packageDir}`);
	return join(destination, output);
}

function installedVersion(fixture, packageName) {
	const path = join(fixture, "node_modules", ...packageName.split("/"), "package.json");
	assert(existsSync(path), `${packageName} is not installed in the fixture`);
	return readJson(path).version;
}

function writeContractProbe(fixture) {
	writeFileSync(
		join(fixture, "contract-probe.mjs"),
		`import assert from "node:assert/strict";
import { PLUGIN_API_VERSION, RESULT_CONTRACT, negotiateCapabilities } from "@gyoungwe/plugin-api";
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

/**
 * Exercise the package lifecycle entirely from local tarballs. The sequence
 * intentionally upgrades and then rolls back the same fixture, so a passing
 * result proves that a failed upgrade can be recovered without touching the
 * user's global npm or Pi state.
 */
function checkLocalLifecycle() {
	const temp = mkdtempSync(join(tmpdir(), "drone-plugin-api-lifecycle-"));
	try {
		const env = {
			...process.env,
			npm_config_cache: join(temp, "npm-cache"),
			npm_config_logs: join(temp, "npm-logs"),
		};
		const currentTarball = npmPack(PACKAGE_DIR, temp, env);
		const rollbackTarball = createRollbackTarball(currentTarball, temp, env);
		const fixture = join(temp, "fixture");
		const fixtureManifest = {
			name: "drone-plugin-api-lifecycle-fixture",
			private: true,
			version: "0.0.0",
			type: "module",
			dependencies: { "@gyoungwe/plugin-api": `file:../${rollbackTarball.split("/").at(-1)}` },
		};
		const fixtureDir = fixture;
		mkdirSync(fixtureDir, { recursive: true });
		writeFileSync(join(fixtureDir, "package.json"), `${JSON.stringify(fixtureManifest, null, 2)}\n`);
		execFileSync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], {
			cwd: fixtureDir,
			stdio: "pipe",
			env,
		});
		writeContractProbe(fixtureDir);
		assert(
			installedVersion(fixtureDir, "@gyoungwe/plugin-api") === "0.9.0",
			"rollback tarball did not install at 0.9.0",
		);
		runContractProbe(fixtureDir);

		execFileSync(
			"npm",
			["install", "--save-exact", "--ignore-scripts", "--no-audit", "--no-fund", currentTarball],
			{
				cwd: fixtureDir,
				stdio: "pipe",
				env,
			},
		);
		assert(
			installedVersion(fixtureDir, "@gyoungwe/plugin-api") === "1.0.0",
			"current tarball did not upgrade to 1.0.0",
		);
		runContractProbe(fixtureDir);

		execFileSync(
			"npm",
			["install", "--save-exact", "--ignore-scripts", "--no-audit", "--no-fund", rollbackTarball],
			{
				cwd: fixtureDir,
				stdio: "pipe",
				env,
			},
		);
		assert(
			installedVersion(fixtureDir, "@gyoungwe/plugin-api") === "0.9.0",
			"rollback tarball did not restore 0.9.0",
		);
		runContractProbe(fixtureDir);

		execFileSync(
			"npm",
			["uninstall", "@gyoungwe/plugin-api", "--ignore-scripts", "--no-audit", "--no-fund"],
			{
				cwd: fixtureDir,
				stdio: "pipe",
				env,
			},
		);
		assert(
			!existsSync(join(fixtureDir, "node_modules", "@drone", "plugin-api")),
			"npm uninstall left plugin-api installed",
		);
		console.log(
			JSON.stringify({
				status: "PASS",
				mode: "local-pack-lifecycle",
				install: "0.9.0",
				upgrade: "1.0.0",
				rollback: "0.9.0",
				uninstall: "removed",
			}),
		);
	} finally {
		rmSync(temp, { recursive: true, force: true });
	}
}

function findPluginRepo() {
	return PLUGIN_REPO_CANDIDATES.find((candidate) => candidate && existsSync(join(candidate, "package.json")));
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

function checkDependencyValue(value, path) {
	if (typeof value !== "string") return;
	assert(!/^file:/u.test(value), `${path} uses a file: dependency (${value})`);
	assert(!/^workspace:/u.test(value), `${path} uses a workspace: dependency (${value})`);
	assert(!value.startsWith("/") && !value.startsWith("~/"), `${path} uses an absolute dependency (${value})`);
	assert(!/(^|\/)\.\.?\//u.test(value), `${path} uses a relative dependency (${value})`);
}

function checkPluginWorkspace(repo) {
	const rootManifestPath = join(repo, "package.json");
	const rootManifest = readJson(rootManifestPath);
	assert(
		Array.isArray(rootManifest.workspaces) && rootManifest.workspaces.includes("packages/*"),
		"drone-plugins must remain one workspace",
	);
	for (const path of walkPackageJson(repo)) {
		const manifest = readJson(path);
		for (const section of [
			"dependencies",
			"devDependencies",
			"optionalDependencies",
			"peerDependencies",
			"overrides",
		]) {
			for (const [name, value] of Object.entries(manifest[section] ?? {}))
				checkDependencyValue(value, `${path}:${section}.${name}`);
		}
	}
	const head = execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
	assert(/^[0-9a-f]{7,40}$/u.test(head), `unable to resolve drone-plugins HEAD: ${head}`);
	return { repo, head, packageJsonFiles: walkPackageJson(repo).length };
}

function checkTarballInstall() {
	const temp = mkdtempSync(join(tmpdir(), "drone-plugin-api-gate-"));
	try {
		const env = { ...process.env, npm_config_cache: join(temp, "npm-cache") };
		const tarball = execFileSync("npm", ["pack", "--silent", PACKAGE_DIR, "--pack-destination", temp], {
			cwd: ROOT,
			encoding: "utf8",
			env,
		})
			.trim()
			.split(/\r?\n/)
			.at(-1);
		assert(tarball, "npm pack did not produce a tarball name");
		const fixture = {
			name: "drone-plugin-api-install-fixture",
			private: true,
			version: "0.0.0",
			type: "module",
			dependencies: { "@gyoungwe/plugin-api": `file:./${tarball}` },
		};
		writeFileSync(join(temp, "package.json"), `${JSON.stringify(fixture, null, 2)}\n`);
		execFileSync("npm", ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"], {
			cwd: temp,
			stdio: "pipe",
			env,
		});
		const lock = readJson(join(temp, "package-lock.json"));
		assert(
			lock.packages?.["node_modules/@gyoungwe/plugin-api"],
			"tarball fixture did not resolve @gyoungwe/plugin-api",
		);
		return tarball;
	} finally {
		rmSync(temp, { recursive: true, force: true });
	}
}

const packageOnly = process.argv.includes("--package-only");
const migration = process.argv.includes("--migration") || !packageOnly;
const lifecycle = process.argv.includes("--lifecycle");
checkPackageOnly();
if (migration) {
	const tarball = checkTarballInstall();
	const repo = findPluginRepo();
	assert(repo, "bound drone-plugins repository not found; set DRONE_PLUGINS_DIR for CI");
	const plugin = checkPluginWorkspace(repo);
	console.log(
		`plugin-api package gate passed; tarball=${tarball}; pluginRepo=${plugin.repo}; head=${plugin.head}; manifests=${plugin.packageJsonFiles}`,
	);
} else {
	console.log("plugin-api package gate passed");
}
if (lifecycle) checkLocalLifecycle();
