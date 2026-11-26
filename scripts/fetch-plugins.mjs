#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, realpathSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { BUILTIN_PACKAGES_DIR } from "./check-builtin-plugins.mjs";
import {
	acquireReleaseTarball,
	promoteReleaseStaging,
	sha256,
	unpackPackageTarball,
	validatePluginsLockV2,
	verifyPackageTarball,
} from "./fetch-plugins-release.mjs";
import { isMainModule } from "./is-main-module.mjs";

const hostRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const builtinPath = relative(hostRoot, BUILTIN_PACKAGES_DIR);
const vendorPath = "vendor/plugins";
const workerFiles = [
	["worker.mjs", "knowledge-worker.mjs"],
	[".knowledge-worker-manifest.json", ".knowledge-worker-manifest.json"],
];
const run = (command, args, cwd) => execFileSync(command, args, { cwd, stdio: "inherit" });
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const copyPackage = (source, target) => cp(source, target, { recursive: true, dereference: true });

function npm(args, options) {
	const windowsPath = join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
	const cli =
		process.env.npm_execpath ||
		(process.platform === "win32" && existsSync(windowsPath) ? windowsPath : null);
	return cli ? execFileSync(process.execPath, [cli, ...args], options) : execFileSync("npm", args, options);
}

async function sourceCheckout(plugin, { override, workspace, checkouts }) {
	if (override) {
		const source = join(override, plugin.path);
		assert(
			existsSync(join(source, "package.json")),
			`Plugin override is missing ${plugin.path}/package.json`,
		);
		console.warn(
			`[fetch-plugins] DRONE_PLUGINS_DIR=${override}; lock commit/hash checks are bypassed for development`,
		);
		return source;
	}
	let checkout = checkouts.get(plugin.repo);
	if (!checkout) {
		checkout = join(workspace, `repo-${checkouts.size}`);
		run("git", ["init", "--quiet", checkout], workspace);
		run("git", ["remote", "add", "origin", plugin.repo], checkout);
		checkouts.set(plugin.repo, checkout);
	}
	run("git", ["fetch", "--depth=1", "origin", plugin.commit], checkout);
	run("git", ["checkout", "--detach", plugin.commit], checkout);
	return join(checkout, plugin.path);
}

function buildAndPack(plugin, source, sourceRoot, workspace) {
	npm(["run", "build", "--workspace", plugin.name], { cwd: sourceRoot, stdio: "inherit" });
	const [metadata] = JSON.parse(
		npm(["pack", "--json", "--ignore-scripts", "--pack-destination", workspace], {
			cwd: source,
			encoding: "utf8",
		}),
	);
	return join(workspace, metadata.filename);
}

async function sourceTarball(plugin, sourceOptions, cached) {
	const source = await sourceCheckout(plugin, sourceOptions);
	const sourceRoot = resolve(source, "..");
	npm(["ci", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: sourceRoot, stdio: "inherit" });
	const tarball = buildAndPack(plugin, source, sourceRoot, sourceOptions.workspace);
	const digest = sha256(await readFile(tarball));
	if (!sourceOptions.override) {
		assert(
			digest === plugin.tarballSha256,
			`${plugin.name} tarball hash mismatch: expected ${plugin.tarballSha256}, got ${digest}`,
		);
		await mkdir(dirname(cached), { recursive: true });
		await cp(tarball, cached);
	}
	return { tarball, digest };
}

async function checkIdentity(directory, plugin) {
	const installed = await readJson(join(directory, "package.json"));
	assert(
		installed.name === plugin.name && installed.version === plugin.version,
		`${plugin.name} package metadata does not match plugins.lock.json`,
	);
}

async function writeReceipt(directory, commit, digest) {
	const receipt = { commit, sha256: digest };
	const path = join(directory, ".drone-fetch.json");
	await writeFile(path, `${JSON.stringify(receipt, null, "\t")}\n`);
	return { path, receipt };
}

async function copyWorker(packageDir, runtimeDir) {
	await mkdir(runtimeDir, { recursive: true });
	for (const [source, target] of workerFiles)
		await cp(join(packageDir, "lib/knowledge/runtime", source), join(runtimeDir, target));
}

async function stageV1Plugin(root, plugin, slug, { tarball, digest }) {
	const target = join(root, vendorPath, slug);
	await rm(target, { recursive: true, force: true });
	await mkdir(target, { recursive: true });
	run("tar", ["-xzf", tarball, "-C", target, "--strip-components=1"], root);
	await checkIdentity(target, plugin);
	const nodeTarget = join(root, "node_modules", plugin.name);
	await rm(nodeTarget, { recursive: true, force: true });
	await mkdir(dirname(nodeTarget), { recursive: true });
	await copyPackage(target, nodeTarget);
	if (plugin.name === "@gyoungwe/pi-knowledge") await copyWorker(target, join(root, ".pi/extensions"));
	await writeReceipt(target, plugin.commit, digest);
	if (plugin.builtin === true) {
		const staged = join(root, builtinPath, plugin.name);
		await rm(staged, { recursive: true, force: true });
		await mkdir(dirname(staged), { recursive: true });
		await copyPackage(target, staged);
	}
	console.log(`[fetch-plugins] ${plugin.name}@${plugin.version} -> vendor/plugins/${slug} (${digest})`);
}

async function findV1Cache(plugin, path) {
	if (existsSync(path) && sha256(await readFile(path)) === plugin.tarballSha256) {
		console.log(`[fetch-plugins] ${plugin.name}: verified cached tarball ${plugin.tarballSha256}`);
		return { tarball: path, digest: plugin.tarballSha256 };
	}
	return null;
}

async function fetchV1(root, plugins, { override, offline, cacheDir }) {
	assert(!offline || !override, "--offline requires a locked cache with no worktree override");
	const jobs = plugins.map((plugin) => {
		const slug = plugin.name.split("/").at(-1);
		return { plugin, slug, cached: join(cacheDir, `${slug}-${plugin.tarballSha256}.tgz`) };
	});
	if (offline) {
		for (const job of jobs) {
			job.artifact = await findV1Cache(job.plugin, job.cached);
			assert(job.artifact, `${job.plugin.name}: verified tarball missing or corrupt in offline cache`);
		}
	}
	const workspace = await mkdtemp(join(tmpdir(), "drone-plugin-fetch-"));
	const sourceOptions = { override, workspace, checkouts: new Map() };
	try {
		await rm(join(root, builtinPath), { recursive: true, force: true });
		for (const { plugin, slug, cached, artifact } of jobs) {
			const available = artifact ?? (override ? null : await findV1Cache(plugin, cached));
			await stageV1Plugin(
				root,
				plugin,
				slug,
				available ?? (await sourceTarball(plugin, sourceOptions, cached)),
			);
		}
	} finally {
		await rm(workspace, { recursive: true, force: true });
	}
}

async function matchesPackedFiles(source, target) {
	if (!lstatSync(target, { throwIfNoEntry: false })?.isDirectory()) return false;
	for (const entry of await readdir(source, { withFileTypes: true })) {
		const from = join(source, entry.name);
		const to = join(target, entry.name);
		if (entry.isDirectory()) {
			if (!(await matchesPackedFiles(from, to))) return false;
		} else if (
			!lstatSync(to, { throwIfNoEntry: false })?.isFile() ||
			!(await readFile(from)).equals(await readFile(to))
		) {
			return false;
		}
	}
	return true;
}

async function stageV2Plugin(root, stage, moves, plugin, { bytes, commit, digest }) {
	const target = join(root, vendorPath, plugin.slug);
	const source = join(stage, "vendor", plugin.slug);
	await mkdir(source, { recursive: true });
	unpackPackageTarball(bytes, source);
	await checkIdentity(source, plugin);
	moves.push({ source, target });
	const nodeTarget = join(root, "node_modules", plugin.name);
	if (!(await matchesPackedFiles(source, nodeTarget))) {
		const nodeSource = join(stage, "npm", plugin.slug);
		await copyPackage(source, nodeSource);
		moves.push({ source: nodeSource, target: nodeTarget });
	}
	if (plugin.name === "@gyoungwe/pi-knowledge") {
		const runtime = join(stage, "worker");
		await copyWorker(source, runtime);
		for (const [, name] of workerFiles) {
			moves.push({ source: join(runtime, name), target: join(root, ".pi/extensions", name) });
		}
	}
	const { path, receipt } = await writeReceipt(source, commit, digest);
	assert.deepEqual(await readJson(path), receipt, `${plugin.name}: fetch receipt failed readback`);
	if (plugin.builtin) await copyPackage(source, join(stage, "builtins", plugin.name));
}

async function prepareCheckout(override, checkout) {
	const source = realpathSync(override);
	const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: source, encoding: "utf8" }).trim();
	assert(/^[0-9a-f]{40}$/u.test(commit), "worktree must resolve to a Git commit");
	await cp(source, checkout, {
		recursive: true,
		filter: (path) => ![".git", "node_modules"].includes(basename(path)),
	});
	console.warn(`[fetch-plugins] building an explicit development snapshot of ${override}`);
	npm(["ci", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: checkout, stdio: "inherit" });
	return { path: realpathSync(checkout), commit };
}

async function packWorktree(plugin, checkout, stage) {
	const source = join(checkout, plugin.path);
	assert(realpathSync(source) === source, `${plugin.name}: worktree package must stay inside the snapshot`);
	const tarball = buildAndPack(plugin, source, checkout, stage);
	assert.equal(tarball, join(stage, plugin.asset), "unexpected worktree archive filename");
	const bytes = await readFile(tarball);
	verifyPackageTarball(bytes, plugin);
	return bytes;
}

async function stageV2(root, plugins, options) {
	const stage = join(root, vendorPath, ".fetching");
	await mkdir(dirname(stage), { recursive: true });
	await mkdir(stage);
	try {
		const checkout = options.override && (await prepareCheckout(options.override, join(stage, "checkout")));
		const moves = [];
		const builtins = join(stage, "builtins");
		await mkdir(builtins);
		for (const plugin of plugins) {
			const bytes = checkout
				? await packWorktree(plugin, checkout.path, stage)
				: (await acquireReleaseTarball(plugin, options)).bytes;
			await stageV2Plugin(root, stage, moves, plugin, {
				bytes,
				commit: checkout?.commit ?? plugin.commit,
				digest: checkout ? sha256(bytes) : plugin.tarballSha256,
			});
		}
		moves.push({ source: builtins, target: join(root, builtinPath) });
		await promoteReleaseStaging(dirname(stage), moves);
		console.log(`[fetch-plugins] staged ${plugins.length} ${checkout ? "worktree" : "Release"} plugins`);
	} finally {
		await rm(stage, { recursive: true, force: true });
	}
}

async function prefetchRelease(root, plugins, options, npmCache) {
	const cacheArgs = npmCache ? ["--cache", resolve(npmCache)] : [];
	for (const plugin of plugins) {
		const { tarball } = await acquireReleaseTarball(plugin, options);
		npm(["cache", "add", tarball, "--offline", "--ignore-scripts", ...cacheArgs], {
			cwd: root,
			stdio: "inherit",
		});
	}
}

export async function fetchPlugins({
	root = hostRoot,
	args = process.argv.slice(2),
	env = process.env,
	fetchImpl,
	checkRedirect,
} = {}) {
	const { values } = parseArgs({
		args,
		options: {
			prefetch: { type: "boolean" },
			offline: { type: "boolean" },
			worktree: { type: "boolean" },
			"npm-cache": { type: "string" },
		},
	});
	const { prefetch, offline, worktree, "npm-cache": npmCache } = values;
	const local = env.DRONE_PLUGINS_DIR;
	assert(
		!prefetch || (!worktree && !local),
		"--prefetch cannot be combined with --worktree or DRONE_PLUGINS_DIR",
	);
	assert(npmCache === undefined || (prefetch && npmCache), "--npm-cache requires --prefetch and a directory");
	assert(!worktree || local, "--worktree requires DRONE_PLUGINS_DIR");
	assert(!worktree || !offline, "--worktree cannot be combined with --offline");
	const lock = await readJson(join(root, "plugins.lock.json"));
	const cacheDir = join(root, vendorPath, ".tarballs");
	if (lock?.version === 2) {
		const plugins = validatePluginsLockV2(lock);
		const options = {
			cacheDir,
			offline,
			fetchImpl,
			checkRedirect,
			override: worktree ? resolve(local) : null,
		};
		if (prefetch) await prefetchRelease(root, plugins, options, npmCache);
		else await stageV2(root, plugins, options);
		return;
	}
	assert(
		lock?.version === 1 && Array.isArray(lock.plugins) && lock.plugins.length > 0,
		"plugins.lock.json must declare version 1 or 2 and at least one plugin",
	);
	assert(!prefetch, "--prefetch requires a version 2 lock");
	await fetchV1(root, lock.plugins, { override: local ? resolve(local) : null, offline, cacheDir });
}

if (isMainModule(import.meta.url)) await fetchPlugins();
