import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const pluginRepo = "https://github.com/Gyoungwe/drone-plugins";
const commitPattern = /^[0-9a-f]{40}$/u;
const releaseHosts = new Set([
	"github.com",
	"objects.githubusercontent.com",
	"release-assets.githubusercontent.com",
]);
const redirectStatuses = new Set([301, 302, 303, 307, 308]);
const maxRedirects = 5;
const timeoutMs = 30_000;
const maxArchiveBytes = 128 * 1024 * 1024;
const maxChecksumBytes = 4096;

export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function validatePluginsLockV2(lock) {
	assert(lock?.version === 2, "plugins.lock.json must declare version 2");
	assert(
		typeof lock.consumerCommit === "string" && commitPattern.test(lock.consumerCommit),
		"invalid consumerCommit",
	);
	assert(
		Array.isArray(lock.plugins) && lock.plugins.length > 0,
		"plugins.lock.json must declare at least one plugin",
	);
	const slugs = new Set();
	return lock.plugins.map((plugin) => {
		assert(
			typeof plugin?.name === "string" && /^@gyoungwe\/[a-z0-9-]+$/u.test(plugin.name),
			"invalid plugin name",
		);
		const slug = plugin.name.slice("@gyoungwe/".length);
		assert(!slugs.has(slug), `duplicate plugin name/slug: ${plugin.name}`);
		slugs.add(slug);
		assert(plugin.repo === `${pluginRepo}.git`, `${plugin.name}: invalid repo`);
		assert(plugin.path === `packages/${slug}`, `${plugin.name}: invalid path`);
		assert(
			typeof plugin.version === "string" && /^\d+\.\d+\.\d+$/u.test(plugin.version),
			`${plugin.name}: invalid version`,
		);
		assert(
			typeof plugin.commit === "string" && commitPattern.test(plugin.commit),
			`${plugin.name}: invalid commit`,
		);
		assert(
			typeof plugin.tarballSha256 === "string" && /^[0-9a-f]{64}$/u.test(plugin.tarballSha256),
			`${plugin.name}: invalid tarballSha256`,
		);
		assert(
			plugin.builtin === undefined || typeof plugin.builtin === "boolean",
			`${plugin.name}: invalid builtin`,
		);
		const tag = `${slug}-v${plugin.version}`;
		const asset = `gyoungwe-${slug}-${plugin.version}.tgz`;
		const base = `${pluginRepo}/releases/download/${tag}`;
		return { ...plugin, slug, tag, asset, tarballUrl: `${base}/${asset}`, checksumUrl: `${base}/SHA256SUMS` };
	});
}

function isReleaseUrl(url) {
	return (
		url.protocol === "https:" && !url.port && !url.username && !url.password && releaseHosts.has(url.hostname)
	);
}

async function readResponse(response, limit) {
	if (Number(response.headers.get("content-length")) > limit) {
		await response.body.cancel();
		throw new Error(`release download exceeds ${limit} bytes`);
	}
	const chunks = [];
	let length = 0;
	for await (const chunk of response.body) {
		length += chunk.byteLength;
		assert(length <= limit, `release download exceeds ${limit} bytes`);
		chunks.push(chunk);
	}
	return Buffer.concat(chunks, length);
}

async function download(url, limit, { fetchImpl, checkRedirect }) {
	const signal = AbortSignal.timeout(timeoutMs);
	let current = new URL(url);
	for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
		assert(checkRedirect(current), `release URL is not allowed: ${current.origin}`);
		const response = await fetchImpl(current.href, { redirect: "manual", signal });
		if (response.status === 200 && response.body) return readResponse(response, limit);
		await response.body?.cancel();
		assert(redirectStatuses.has(response.status), `release download failed with HTTP ${response.status}`);
		const location = response.headers.get("location");
		assert(location, "release redirect is missing Location");
		current = new URL(location, current);
	}
	throw new Error(`release download exceeded ${maxRedirects} redirects`);
}

function tar(bytes, args) {
	return execFileSync("tar", args, {
		input: bytes,
		encoding: "utf8",
		env: { ...process.env, TAR_OPTIONS: "" },
		timeout: timeoutMs,
		maxBuffer: 8 * 1024 * 1024,
	});
}

function archiveEntries(bytes) {
	const names = tar(bytes, ["-tzf", "-"]).split(/\r?\n/u).slice(0, -1);
	const types = tar(bytes, ["-tvzf", "-"]).split(/\r?\n/u).slice(0, -1);
	assert.equal(names.length, types.length, "invalid tar entry listing");
	const seen = new Set();
	for (const [index, name] of names.entries()) {
		const type = types[index][0];
		assert(type === "-" || type === "d", `unsafe tar entry type: ${name}`);
		const parts = (type === "d" ? name.replace(/\/$/u, "") : name).split("/");
		assert(
			parts[0] === "package" &&
				(parts.length > 1 || type === "d") &&
				parts.every((part) => part && !/[\\:"<>|?*\p{Cc}\uFFFD]|[. ]$/u.test(part)),
			`unsafe tar entry path: ${name}`,
		);
		const key = parts.join("/").normalize("NFC").toLowerCase();
		assert(!seen.has(key), `duplicate tar entry path: ${name}`);
		seen.add(key);
	}
}

export function verifyPackageTarball(bytes, { name, version }) {
	archiveEntries(bytes);
	const manifest = JSON.parse(tar(bytes, ["-xzOf", "-", "package/package.json"]));
	assert(
		manifest.name === name && manifest.version === version,
		`${name}: tarball package identity does not match ${version}`,
	);
}

export function unpackPackageTarball(bytes, target) {
	tar(bytes, ["-xzf", "-", "-C", target, "--strip-components=1", "--no-same-owner", "--no-same-permissions"]);
}

export async function acquireReleaseTarball(
	plugin,
	{ cacheDir, offline, fetchImpl = fetch, checkRedirect = isReleaseUrl },
) {
	const tarball = join(cacheDir, `${plugin.slug}-${plugin.tarballSha256}.tgz`);
	const info = lstatSync(tarball, { throwIfNoEntry: false });
	if (info?.isFile() && info.size <= maxArchiveBytes) {
		const bytes = await readFile(tarball);
		if (sha256(bytes) === plugin.tarballSha256) {
			verifyPackageTarball(bytes, plugin);
			return { tarball, bytes };
		}
	}
	assert(!offline, `${plugin.name}: verified tarball missing or corrupt in offline cache`);
	const transport = { fetchImpl, checkRedirect };
	const checksum = (await download(plugin.checksumUrl, maxChecksumBytes, transport)).toString("utf8");
	const expected = `${plugin.tarballSha256}  ${plugin.asset}`;
	assert(
		checksum === expected || checksum === `${expected}\n`,
		`${plugin.name}: SHA256SUMS does not match the locked asset`,
	);
	const downloaded = await download(plugin.tarballUrl, maxArchiveBytes, transport);
	await mkdir(cacheDir, { recursive: true });
	const temp = await mkdtemp(join(cacheDir, ".download-"));
	try {
		const staged = join(temp, plugin.asset);
		await writeFile(staged, downloaded);
		const bytes = await readFile(staged);
		assert.equal(sha256(bytes), plugin.tarballSha256, `${plugin.name}: downloaded tarball SHA-256 mismatch`);
		verifyPackageTarball(bytes, plugin);
		await rename(staged, tarball);
		return { tarball, bytes };
	} finally {
		await rm(temp, { recursive: true, force: true });
	}
}

export async function promoteReleaseStaging(vendorDir, moves) {
	const backups = await mkdtemp(join(vendorDir, ".backup-"));
	const applied = [];
	try {
		for (const { source, target } of moves) {
			await mkdir(dirname(target), { recursive: true });
			const backup = lstatSync(target, { throwIfNoEntry: false }) && join(backups, String(applied.length));
			if (backup) await rename(target, backup);
			const move = { target, backup, installed: false };
			applied.push(move);
			await rename(source, target);
			move.installed = true;
		}
	} catch (error) {
		const failures = [];
		for (const { target, backup, installed } of applied.reverse()) {
			try {
				if (installed) await rm(target, { recursive: true, force: true });
				if (backup) await rename(backup, target);
			} catch (failure) {
				failures.push(failure);
			}
		}
		if (failures.length)
			throw new AggregateError(
				[error, ...failures],
				`plugin staging rollback failed; backups are in ${backups}`,
			);
		await rm(backups, { recursive: true, force: true });
		throw error;
	}
	await rm(backups, { recursive: true, force: true });
}
