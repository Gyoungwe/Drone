// Stage the pi packages the desktop installer ships (packages/desktop/pi-packages).
//
//   node scripts/stage-pi-packages.mjs           install from the committed lockfile (idempotent)
//   node scripts/stage-pi-packages.mjs --check   verify the staged tree only (no network)
//
// electron-builder copies pi-packages/node_modules to <resources>/pi-packages/node_modules and the
// desktop main process loads pi-mcp-adapter from there as the MCP runtime extension.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const PI_PACKAGES_DIR = join(root, "packages/desktop/pi-packages");
const modules = join(PI_PACKAGES_DIR, "node_modules");
const marker = join(modules, ".drone-staged.json");
/** Dropped after install: Java fallback for recheck (native binaries cover shipped platforms; adapter degrades gracefully). */
const PRUNE = ["recheck-jar", ".bin"];

function readJson(path) {
	return JSON.parse(readFileSync(path, "utf8"));
}

function lockHash() {
	return createHash("sha256")
		.update(readFileSync(join(PI_PACKAGES_DIR, "package.json")))
		.update(readFileSync(join(PI_PACKAGES_DIR, "package-lock.json")))
		.digest("hex");
}

function npm(args, cwd) {
	const windows = process.platform === "win32";
	execFileSync(windows ? "npm.cmd" : "npm", args, { cwd, stdio: "inherit", shell: windows });
}

function findSymlinks(dir, found = []) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isSymbolicLink()) found.push(relative(modules, path));
		else if (entry.isDirectory()) findSymlinks(path, found);
	}
	return found;
}

/** Throws when the staged tree is missing, stale or not shippable. Returns the staged package versions. */
export function verifyStaged(nodeModules = modules) {
	const manifest = readJson(join(PI_PACKAGES_DIR, "package.json"));
	const lock = readJson(join(PI_PACKAGES_DIR, "package-lock.json"));
	const versions = {};
	for (const [name, pinned] of Object.entries(manifest.dependencies)) {
		if (!/^\d+\.\d+\.\d+$/.test(pinned))
			throw new Error(`${name} must be pinned to an exact version, got ${pinned}`);
		const pkgPath = join(nodeModules, name, "package.json");
		if (!existsSync(pkgPath))
			throw new Error(
				`Bundled pi package ${name} is not staged at ${pkgPath}. Run: npm run stage:pi-packages`,
			);
		const staged = readJson(pkgPath);
		if (staged.version !== pinned)
			throw new Error(`Bundled ${name} is ${staged.version}, expected ${pinned}`);
		for (const entry of staged.pi?.extensions ?? [])
			if (!existsSync(join(nodeModules, name, entry)))
				throw new Error(`${name} extension entry missing: ${entry}`);
		versions[name] = staged.version;
	}
	// Every non-optional locked dependency must be present (optional ones are platform natives).
	for (const [key, info] of Object.entries(lock.packages)) {
		if (!key.startsWith("node_modules/") || info.optional || info.dev) continue;
		const name = key.slice("node_modules/".length);
		if (PRUNE.includes(name)) continue;
		if (!existsSync(join(nodeModules, name, "package.json")))
			throw new Error(`Bundled dependency missing: ${key}`);
	}
	const links = findSymlinks(nodeModules);
	if (links.length) throw new Error(`Bundled pi packages must not contain symlinks: ${links.join(", ")}`);
	return versions;
}

/**
 * macOS releases build arm64 and x64 apps from one runner, but npm only installs the host's
 * optional native packages. Add the other darwin natives from the lockfile (integrity-checked).
 */
function addDarwinNatives(lock) {
	const temp = mkdtempSync(join(tmpdir(), "drone-pi-natives-"));
	try {
		for (const [key, info] of Object.entries(lock.packages)) {
			if (!info.optional || !info.os?.includes("darwin") || existsSync(join(PI_PACKAGES_DIR, key))) continue;
			const name = key.slice("node_modules/".length);
			npm(["pack", `${name}@${info.version}`, "--pack-destination", temp, "--silent"], PI_PACKAGES_DIR);
			const tarball = readdirSync(temp).find((file) => file.endsWith(".tgz"));
			if (!tarball) throw new Error(`npm pack produced no tarball for ${name}`);
			const data = readFileSync(join(temp, tarball));
			const [algorithm, expected] = info.integrity.split("-");
			if (createHash(algorithm).update(data).digest("base64") !== expected)
				throw new Error(`Integrity mismatch for ${name}@${info.version}`);
			const target = join(PI_PACKAGES_DIR, key);
			mkdirSync(target, { recursive: true });
			execFileSync("tar", ["-xzf", join(temp, tarball), "-C", target, "--strip-components=1"], {
				stdio: "inherit",
			});
			rmSync(join(temp, tarball));
			console.log(`[stage-pi-packages] added ${name}@${info.version} for the other macOS architecture`);
		}
	} finally {
		rmSync(temp, { recursive: true, force: true });
	}
}

export function stage({ force = false } = {}) {
	const hash = lockHash();
	if (
		!force &&
		existsSync(marker) &&
		readJson(marker).hash === hash &&
		readJson(marker).platform === process.platform
	) {
		try {
			return verifyStaged();
		} catch {
			// fall through and reinstall
		}
	}
	rmSync(modules, { recursive: true, force: true });
	npm(
		["ci", "--omit=dev", "--ignore-scripts", "--legacy-peer-deps", "--no-audit", "--no-fund"],
		PI_PACKAGES_DIR,
	);
	if (process.platform === "darwin") addDarwinNatives(readJson(join(PI_PACKAGES_DIR, "package-lock.json")));
	for (const name of PRUNE) rmSync(join(modules, name), { recursive: true, force: true });
	const versions = verifyStaged();
	writeFileSync(marker, `${JSON.stringify({ hash, platform: process.platform, versions }, null, 2)}\n`);
	return versions;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const versions = process.argv.includes("--check")
		? verifyStaged()
		: stage({ force: process.argv.includes("--force") });
	console.log(
		`[stage-pi-packages] ${Object.entries(versions)
			.map(([name, version]) => `${name}@${version}`)
			.join(", ")}`,
	);
}
