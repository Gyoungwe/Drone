#!/usr/bin/env node

import { execFileSync } from "node:child_process";
// Resolve the exact plugin source recorded in plugins.lock.json, build it, and
// unpack the verified npm artifact into the local vendor boundary. A local
// DRONE_PLUGINS_DIR is an explicit development override; it skips the lock
// hash so the host can iterate against an uncommitted plugin checkout.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lockPath = join(root, "plugins.lock.json");
const lock = JSON.parse(await readFile(lockPath, "utf8"));
if (lock.version !== 1 || !Array.isArray(lock.plugins) || lock.plugins.length === 0)
	throw new Error("plugins.lock.json must declare version 1 and at least one plugin");

const override = process.env.DRONE_PLUGINS_DIR ? resolve(process.env.DRONE_PLUGINS_DIR) : null;
const workspace = await mkdtemp(join(tmpdir(), "drone-plugin-fetch-"));
const checkouts = new Map();
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const cacheDir = join(root, "vendor/plugins/.tarballs");
const run = (command, args, cwd) => execFileSync(command, args, { cwd, stdio: "inherit" });
// Run npm through the npm that invoked this script (npm_execpath), so Windows needs no shell
// or npm.cmd shim; a direct `node scripts/fetch-plugins.mjs` falls back to npm on PATH.
const npm = (args, options) =>
	process.env.npm_execpath
		? execFileSync(process.execPath, [process.env.npm_execpath, ...args], options)
		: execFileSync("npm", args, options);

async function sourceCheckout(plugin) {
	if (override) {
		const source = join(override, plugin.path);
		if (!existsSync(join(source, "package.json")))
			throw new Error(`Plugin override is missing ${plugin.path}/package.json`);
		console.warn(
			`[fetch-plugins] DRONE_PLUGINS_DIR=${override}; lock commit/hash checks are bypassed for development`,
		);
		return source;
	}
	let checkout = checkouts.get(plugin.repo);
	if (!checkout) {
		checkout = join(workspace, `repo-${checkouts.size}`);
		// The lock already supplies the exact commit; repository-wide history is not a build input.
		run("git", ["init", "--quiet", checkout], workspace);
		run("git", ["remote", "add", "origin", plugin.repo], checkout);
		checkouts.set(plugin.repo, checkout);
	}
	run("git", ["fetch", "--depth=1", "origin", plugin.commit], checkout);
	run("git", ["checkout", "--detach", plugin.commit], checkout);
	return join(checkout, plugin.path);
}

try {
	for (const plugin of lock.plugins) {
		// A tarball this script already verified against the lock is reused after re-hashing it.
		// CI rebuilds from source once on Linux and hands the tarballs to the other platforms,
		// whose checkouts (CRLF line endings, .cmd shims) cannot reproduce the locked bytes.
		const cached = join(cacheDir, `${plugin.name.split("/").at(-1)}-${plugin.tarballSha256}.tgz`);
		let tarball;
		let digest;
		if (!override && existsSync(cached) && sha256(await readFile(cached)) === plugin.tarballSha256) {
			tarball = cached;
			digest = plugin.tarballSha256;
			console.log(`[fetch-plugins] ${plugin.name}: verified cached tarball ${digest}`);
		} else {
			const source = await sourceCheckout(plugin);
			const sourceRoot = resolve(source, "..");
			npm(["ci", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: sourceRoot, stdio: "inherit" });
			npm(["run", "build", "--workspace", plugin.name], { cwd: sourceRoot, stdio: "inherit" });
			const metadata = JSON.parse(
				npm(["pack", "--json", "--ignore-scripts", "--pack-destination", workspace], {
					cwd: source,
					encoding: "utf8",
				}),
			)[0];
			tarball = join(workspace, metadata.filename);
			digest = sha256(await readFile(tarball));
			if (!override && digest !== plugin.tarballSha256)
				throw new Error(
					`${plugin.name} tarball hash mismatch: expected ${plugin.tarballSha256}, got ${digest}`,
				);
			if (!override) {
				await mkdir(cacheDir, { recursive: true });
				await cp(tarball, cached);
			}
		}
		const target = join(root, "vendor/plugins", plugin.name.split("/").at(-1));
		await rm(target, { recursive: true, force: true });
		await mkdir(target, { recursive: true });
		run("tar", ["-xzf", tarball, "-C", target, "--strip-components=1"], root);
		const installed = JSON.parse(await readFile(join(target, "package.json"), "utf8"));
		if (installed.name !== plugin.name || installed.version !== plugin.version)
			throw new Error(`${plugin.name} package metadata does not match plugins.lock.json`);

		// TypeScript and native Pi smoke resolve the package through node_modules;
		// the shipped Electron resources use vendor/plugins directly.
		const nodeTarget = join(root, "node_modules", ...plugin.name.split("/"));
		await rm(nodeTarget, { recursive: true, force: true });
		await mkdir(dirname(nodeTarget), { recursive: true });
		await cp(target, nodeTarget, { recursive: true, dereference: true });
		if (plugin.name === "@gyoungwe/pi-knowledge") {
			const runtimeDir = join(root, ".pi/extensions");
			await mkdir(runtimeDir, { recursive: true });
			await cp(join(target, "lib/knowledge/runtime/worker.mjs"), join(runtimeDir, "knowledge-worker.mjs"));
			await cp(
				join(target, "lib/knowledge/runtime/.knowledge-worker-manifest.json"),
				join(runtimeDir, ".knowledge-worker-manifest.json"),
			);
		}
		await writeFile(
			join(target, ".drone-fetch.json"),
			`${JSON.stringify({ commit: plugin.commit, sha256: digest }, null, "\t")}\n`,
		);
		console.log(
			`[fetch-plugins] ${plugin.name}@${installed.version} -> vendor/plugins/${plugin.name.split("/").at(-1)} (${digest})`,
		);
	}
} finally {
	await rm(workspace, { recursive: true, force: true });
}
