#!/usr/bin/env node

// Official Pi package format conformance (2026-10-29 user revision: native Pi CLI use is not
// a product scenario, but every plugin must stay an ordinary Pi package).
//
// For each package directory, Pi's own package manager resolves it as a source exactly like
// `pi -e <dir>`: it reads package.json `pi` (or the conventional directories), loads the
// declared extensions through the real loader and discovers the declared skills. No Drone
// manifest, host, loader or Electron is involved. The check fails when an extension does not
// load, when declared skills are not found, or when a tool the package's Drone manifest declares
// is not registered by the official entry once the package is configured. Packages may register
// tools only after their own setup (pi-knowledge waits for a knowledge directory and offers
// /drone-init first); `--configure-dir-env=NAME` points that variable at an empty temporary
// directory for the configured pass. It does not exercise domain behavior.

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";

const packages = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const configureEnv = process.argv
	.slice(2)
	.find((arg) => arg.startsWith("--configure-dir-env="))
	?.slice("--configure-dir-env=".length);
if (packages.length === 0) packages.push("node_modules/@gyoungwe/pi-knowledge");

const inside = (root, path) => {
	const rel = relative(root, path);
	return rel === "" || (!rel.startsWith("..") && !rel.startsWith(sep) && !/^[A-Za-z]:/.test(rel));
};

async function check(packageArg) {
	const root = await realpath(resolve(packageArg));
	const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
	const conventional = ["extensions", "skills", "prompts", "themes"].filter((dir) =>
		existsSync(join(root, dir)),
	);
	assert(
		pkg.pi || conventional.length,
		`${pkg.name}: no package.json "pi" field and no conventional Pi directories`,
	);
	const manifestPath = join(root, "plugin.manifest.json");
	const droneTools = existsSync(manifestPath)
		? (JSON.parse(await readFile(manifestPath, "utf8")).tools ?? [])
		: [];

	const unconfigured = await load(root, pkg, conventional, undefined);
	const configured = configureEnv ? await load(root, pkg, conventional, configureEnv) : unconfigured;
	const missing = droneTools.filter((tool) => !configured.tools.includes(tool));
	assert.deepEqual(
		missing,
		[],
		`${pkg.name}: tools declared in plugin.manifest.json are not registered by the official entry`,
	);
	return { package: pkg.name, version: pkg.version, unconfigured, ...(configureEnv ? { configured } : {}) };
}

async function load(root, pkg, conventional, envName) {
	const work = await mkdtemp(join(tmpdir(), "pi-package-format-"));
	const previous = envName ? process.env[envName] : undefined;
	if (envName) process.env[envName] = join(work, "configured");
	try {
		const loader = new DefaultResourceLoader({
			cwd: work,
			agentDir: work,
			settingsManager: SettingsManager.inMemory(),
			noExtensions: true,
			noSkills: true,
			noPromptTemplates: true,
			additionalExtensionPaths: [root],
		});
		await loader.reload();
		const loaded = loader.getExtensions();
		assert.deepEqual(
			loaded.errors,
			[],
			`${pkg.name}: extension load errors ${JSON.stringify(loaded.errors)}`,
		);
		const extensions = loaded.extensions.filter((extension) =>
			inside(root, extension.resolvedPath ?? extension.path),
		);
		const declaresExtensions = Boolean(pkg.pi?.extensions?.length) || conventional.includes("extensions");
		if (declaresExtensions) assert(extensions.length > 0, `${pkg.name}: declared extensions were not loaded`);
		const skills = loader
			.getSkills()
			.skills.filter((skill) => inside(root, skill.filePath ?? skill.path ?? ""));
		const declaresSkills = Boolean(pkg.pi?.skills?.length) || conventional.includes("skills");
		if (declaresSkills) assert(skills.length > 0, `${pkg.name}: declared skills were not discovered`);
		return {
			extensions: extensions.length,
			tools: [...new Set(extensions.flatMap((extension) => [...extension.tools.keys()]))].sort(),
			commands: [...new Set(extensions.flatMap((extension) => [...extension.commands.keys()]))].sort(),
			skills: skills.map((skill) => skill.name).sort(),
		};
	} finally {
		if (envName) {
			if (previous === undefined) delete process.env[envName];
			else process.env[envName] = previous;
		}
		await rm(work, { recursive: true, force: true });
	}
}

const results = [];
for (const packageArg of packages) results.push(await check(packageArg));
console.log(JSON.stringify({ status: "PASS", check: "official-pi-package-format", results }, null, 2));
