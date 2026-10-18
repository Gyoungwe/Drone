#!/usr/bin/env node
/**
 * Run the native Pi extension registration smoke against the supported host
 * matrix.  The locked host (1.1.0) and the npm `latest` tag are required;
 * `next` is probed when published and is reported as NOT_PUBLISHED otherwise.
 *
 * Every matrix cell gets a throwaway npm prefix and a fresh Pi resource
 * loader.  No user HOME, ~/.pi state, model call, or session is touched.
 *
 *   node scripts/check-pi-compat.mjs
 *   node scripts/check-pi-compat.mjs --targets locked,latest
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const HOST_PACKAGE = "@earendil-works/pi-coding-agent";
const LOCKED_VERSION = "1.1.0";
const LOCKED_HOST_FAMILY = [
	"chord",
	"pi-agent-core",
	"pi-ai",
	"pi-codemode",
	"pi-coding-agent",
	"pi-mcp",
	"pi-telemetry",
	"pi-tui",
];
const PLUGIN_PACKAGES = [
	"pi-core",
	"pi-knowledge",
	"pi-research",
	"pi-analysis",
	"pi-evidence",
	"pi-connectors",
];
const PLUGIN_DIST = {
	"pi-core": resolve(ROOT, "packages/pi-core/dist/index.mjs"),
	"pi-knowledge": resolve(ROOT, "node_modules/@gyoungwe/pi-knowledge/dist/index.mjs"),
	"pi-research": resolve(ROOT, "packages/pi-research/dist/index.mjs"),
	"pi-analysis": resolve(ROOT, "node_modules/@gyoungwe/pi-analysis/dist/index.mjs"),
	"pi-evidence": resolve(ROOT, "node_modules/@gyoungwe/pi-evidence/dist/index.mjs"),
	"pi-connectors": resolve(ROOT, "node_modules/@gyoungwe/pi-connectors/dist/index.mjs"),
};

function fail(message) {
	throw new Error(`[check:pi-compat] ${message}`);
}

function assert(condition, message) {
	if (!condition) fail(message);
}

function run(command, args, options = {}) {
	return execFileSync(command, args, {
		encoding: "utf8",
		maxBuffer: 16 * 1024 * 1024,
		stdio: ["ignore", "pipe", "pipe"],
		...options,
	});
}

function packageVersion(prefix) {
	const path = join(prefix, "node_modules", ...HOST_PACKAGE.split("/"), "package.json");
	assert(existsSync(path), `${HOST_PACKAGE} was not installed in ${prefix}`);
	return JSON.parse(readFileSync(path, "utf8")).version;
}

function hostFamilyVersions(prefix) {
	return Object.fromEntries(
		LOCKED_HOST_FAMILY.map((name) => {
			const path = join(prefix, "node_modules", "@earendil-works", name, "package.json");
			return [name, existsSync(path) ? JSON.parse(readFileSync(path, "utf8")).version : null];
		}),
	);
}

function npmDistTag(tag) {
	try {
		const output = run("npm", ["view", HOST_PACKAGE, "dist-tags", "--json"], { cwd: ROOT });
		const tags = JSON.parse(output);
		return typeof tags?.[tag] === "string" ? tags[tag] : null;
	} catch {
		return null;
	}
}

function targetSelection() {
	const index = process.argv.indexOf("--targets");
	if (index < 0) return ["locked", "latest", "next"];
	const value = process.argv[index + 1];
	if (!value || value.startsWith("--")) fail("--targets requires a comma-separated list");
	const requested = value
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);
	for (const item of requested)
		if (!["locked", "latest", "next"].includes(item)) fail(`unknown target ${item}`);
	return [...new Set(requested)];
}

function writeProbe(prefix, extensionPath) {
	writeFileSync(
		join(prefix, "compat-probe.mjs"),
		`import assert from "node:assert/strict";
import { DefaultResourceLoader, SettingsManager } from "${HOST_PACKAGE}";
const loader = new DefaultResourceLoader({
  cwd: ${JSON.stringify(prefix)},
  agentDir: ${JSON.stringify(join(prefix, "agent"))},
  settingsManager: SettingsManager.inMemory(),
  noExtensions: true,
  noSkills: true,
  additionalExtensionPaths: [${JSON.stringify(extensionPath)}],
});
await loader.reload();
const loaded = loader.getExtensions();
assert.deepEqual(loaded.errors, [], JSON.stringify(loaded.errors));
const extension = loaded.extensions.find((entry) => entry.path === ${JSON.stringify(extensionPath)});
assert(extension, "extension was not loaded");
assert(extension.tools.size > 0, "extension registered no tools");
console.log(JSON.stringify({ tools: [...extension.tools.keys()], commands: [...extension.commands.keys()] }));
`,
	);
}

function checkTarget(target, version, required) {
	if (!version) {
		return {
			target,
			status: "NOT_PUBLISHED",
			required,
			package: HOST_PACKAGE,
		};
	}
	const prefix = mkdtempSync(join(tmpdir(), `drone-pi-compat-${target}-`));
	try {
		writeFileSync(
			join(prefix, "package.json"),
			`${JSON.stringify(
				{
					name: `drone-pi-compat-${target}`,
					private: true,
					version: "0.0.0",
					type: "module",
					dependencies:
						version === LOCKED_VERSION
							? Object.fromEntries(LOCKED_HOST_FAMILY.map((name) => [`@earendil-works/${name}`, version]))
							: { [HOST_PACKAGE]: version },
				},
				null,
				2,
			)}\n`,
		);
		const env = {
			...process.env,
			npm_config_cache: join(prefix, "npm-cache"),
			npm_config_logs: join(prefix, "npm-logs"),
		};
		run(
			"npm",
			[
				"install",
				"--prefix",
				prefix,
				"--ignore-scripts",
				"--no-audit",
				"--no-fund",
				`${HOST_PACKAGE}@${version}`,
			],
			{ cwd: ROOT, env },
		);
		assert(
			packageVersion(prefix) === version,
			`${target} resolved ${version} but installed ${packageVersion(prefix)}`,
		);
		const family = version === LOCKED_VERSION ? hostFamilyVersions(prefix) : undefined;
		if (family) {
			for (const [name, installed] of Object.entries(family))
				assert(
					installed === version,
					`locked host family ${name} resolved ${installed ?? "missing"}, expected ${version}`,
				);
		}
		const packages = [];
		for (const packageName of PLUGIN_PACKAGES) {
			const extensionPath = PLUGIN_DIST[packageName];
			assert(
				existsSync(extensionPath),
				`${packageName} dist/index.mjs is missing; build packages before the matrix`,
			);
			writeProbe(prefix, extensionPath);
			const output = run("node", ["compat-probe.mjs"], { cwd: prefix, env });
			const probe = JSON.parse(output.trim().split(/\r?\n/u).at(-1));
			packages.push({ package: packageName, tools: probe.tools.length, commands: probe.commands.length });
		}
		return {
			target,
			status: "PASS",
			required,
			package: HOST_PACKAGE,
			version,
			...(family ? { hostFamily: family } : {}),
			packages,
		};
	} catch (error) {
		return {
			target,
			status: "FAIL",
			required,
			package: HOST_PACKAGE,
			version,
			error: error instanceof Error ? error.message : String(error),
		};
	} finally {
		rmSync(prefix, { recursive: true, force: true });
	}
}

const requested = targetSelection();
const resolved = {
	locked: LOCKED_VERSION,
	latest: npmDistTag("latest"),
	next: npmDistTag("next"),
};
const results = requested.map((target) => checkTarget(target, resolved[target], target !== "next"));
for (const result of results) console.log(JSON.stringify(result));
const failures = results.filter((result) => result.required && result.status !== "PASS");
if (failures.length) fail(`${failures.length} required compatibility target(s) failed`);
console.log(
	`[check:pi-compat] ${results.filter((result) => result.status === "PASS").length} passed; ${results.filter((result) => result.status === "NOT_PUBLISHED").length} not published`,
);
