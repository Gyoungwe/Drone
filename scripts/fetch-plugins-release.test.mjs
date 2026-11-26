import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { rmSync } from "node:fs";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import { verifyBuiltinPackages } from "./check-builtin-plugins.mjs";
import { fetchPlugins } from "./fetch-plugins.mjs";
import { acquireReleaseTarball, validatePluginsLockV2 } from "./fetch-plugins-release.mjs";

const releaseBase = "https://github.com/Gyoungwe/drone-plugins/releases/download";
const row = {
	name: "@gyoungwe/pi-core",
	version: "0.2.0",
	repo: "https://github.com/Gyoungwe/drone-plugins.git",
	commit: "a".repeat(40),
	path: "packages/pi-core",
	tarballSha256: "b".repeat(64),
	builtin: true,
};
const lockFor = (...plugins) => ({ version: 2, consumerCommit: "c".repeat(40), plugins });
const extensions = ".pi/extensions";
const builtins = "packages/desktop/plugin-packages/node_modules";
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const noNetwork = () => assert.fail("unexpected network request");

test("v2 locks derive the exact GitHub release tag and assets", () => {
	const [plugin] = validatePluginsLockV2(lockFor(row));
	assert.equal(plugin.slug, "pi-core");
	assert.equal(plugin.tag, "pi-core-v0.2.0");
	assert.equal(plugin.asset, "gyoungwe-pi-core-0.2.0.tgz");
	assert.equal(plugin.tarballUrl, `${releaseBase}/pi-core-v0.2.0/gyoungwe-pi-core-0.2.0.tgz`);
	assert.equal(plugin.checksumUrl, `${releaseBase}/pi-core-v0.2.0/SHA256SUMS`);
});

test("v2 locks reject invalid rows and colliding destinations", () => {
	for (const [field, value] of Object.entries({
		name: "@gyoungwe/../../core",
		repo: `${row.repo}/`,
		path: "packages/pi-other",
		version: "0.2.0-rc.1",
		commit: "a".repeat(39),
		tarballSha256: "B".repeat(64),
		builtin: 1,
	})) {
		assert.throws(() => validatePluginsLockV2(lockFor({ ...row, [field]: value })), new RegExp(field, "u"));
	}
	assert.throws(() => validatePluginsLockV2(lockFor(row, { ...row, version: "0.2.1" })), /duplicate/u);
	assert.throws(() => validatePluginsLockV2(lockFor()), /at least one/u);
	assert.throws(() => validatePluginsLockV2({ ...lockFor(row), version: 1 }), /version 2/u);
	assert.throws(
		() => validatePluginsLockV2({ ...lockFor(row), consumerCommit: "C".repeat(40) }),
		/consumerCommit/u,
	);
});

function tarEntry(path, content, type = "0", link = "") {
	const bytes = Buffer.from(content);
	const header = Buffer.alloc(512);
	header.write(path, 0, 100);
	header.write("0000644\0", 100);
	header.write("0000000\0", 108);
	header.write("0000000\0", 116);
	header.write(`${bytes.length.toString(8).padStart(11, "0")}\0`, 124);
	header.write("00000000000\0", 136);
	header.fill(32, 148, 156);
	header.write(type, 156);
	header.write(link, 157, 100);
	header.write("ustar\0", 257);
	header.write("00", 263);
	const sum = header.reduce((total, byte) => total + byte, 0);
	header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
	return [header, bytes, Buffer.alloc((512 - (bytes.length % 512)) % 512)];
}

function release(plugin = row, { manifest = plugin, entries = [] } = {}) {
	const bytes = gzipSync(
		Buffer.concat([
			...tarEntry("package/package.json", JSON.stringify({ name: manifest.name, version: manifest.version })),
			...tarEntry("package/index.js", "export default 42;\n"),
			...entries.flatMap((entry) => tarEntry(...entry)),
			Buffer.alloc(1024),
		]),
	);
	const locked = { ...plugin, tarballSha256: digest(bytes) };
	const [asset] = validatePluginsLockV2(lockFor(locked));
	return { locked, asset, bytes, checksum: `${locked.tarballSha256}  ${asset.asset}\n` };
}

async function fixture(t) {
	const root = await mkdtemp(join(tmpdir(), "drone-release-fetch-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	return { root, cacheDir: join(root, "vendor/plugins/.tarballs") };
}

function mockReleases(...releases) {
	const responses = new Map(
		releases.flatMap(({ asset, bytes, checksum }) => [
			[asset.checksumUrl, checksum],
			[asset.tarballUrl, bytes],
		]),
	);
	return (url, options) => {
		assert.equal(options.redirect, "manual");
		assert(responses.has(url), `unexpected request to ${url}`);
		return new Response(responses.get(url));
	};
}

test("downloads, reuses and repairs verified digest-keyed cache entries", async (t) => {
	const { cacheDir } = await fixture(t);
	const item = release();
	const options = { cacheDir, fetchImpl: mockReleases(item) };
	const { tarball } = await acquireReleaseTarball(item.asset, options);
	assert.equal(tarball, join(cacheDir, `pi-core-${item.locked.tarballSha256}.tgz`));
	assert.deepEqual(await readFile(tarball), item.bytes);
	await acquireReleaseTarball(item.asset, { cacheDir, fetchImpl: noNetwork });
	await acquireReleaseTarball(item.asset, { cacheDir, offline: true, fetchImpl: noNetwork });
	await writeFile(tarball, "corrupt");
	await assert.rejects(
		acquireReleaseTarball(item.asset, { cacheDir, offline: true, fetchImpl: noNetwork }),
		/offline cache/u,
	);
	await acquireReleaseTarball(item.asset, options);
	assert.deepEqual(await readFile(tarball), item.bytes);
});

test("offline cache miss fails without fetching or creating a cache", async (t) => {
	const { cacheDir } = await fixture(t);
	await assert.rejects(
		acquireReleaseTarball(release().asset, { cacheDir, offline: true, fetchImpl: noNetwork }),
		/offline cache/u,
	);
	await assert.rejects(access(cacheDir), { code: "ENOENT" });
});

test("follows allowed GitHub asset redirects and caps redirect chains at five", async (t) => {
	const { cacheDir } = await fixture(t);
	const item = release();
	const hosts = ["objects.githubusercontent.com", "release-assets.githubusercontent.com"];
	const fetchImpl = (url, options) => {
		assert.equal(options.redirect, "manual");
		if (url === item.asset.checksumUrl) return new Response(item.checksum);
		const index = url === item.asset.tarballUrl ? 0 : Number(new URL(url).pathname.slice(1));
		return index === 5
			? new Response(item.bytes)
			: Response.redirect(`https://${hosts[index % 2]}/${index + 1}`);
	};
	await acquireReleaseTarball(item.asset, { cacheDir, fetchImpl });
	const loopingFetch = () => Response.redirect("https://release-assets.githubusercontent.com/loop");
	await assert.rejects(
		acquireReleaseTarball(item.asset, { cacheDir: join(cacheDir, "empty"), fetchImpl: loopingFetch }),
		/exceeded 5 redirects/u,
	);
});

test("blocks foreign hosts and non-HTTPS redirects before requesting them", async (t) => {
	const { cacheDir } = await fixture(t);
	const item = release();
	for (const location of [
		"https://github.com.example.invalid/file",
		"http://objects.githubusercontent.com/file",
	]) {
		await assert.rejects(
			acquireReleaseTarball(item.asset, {
				cacheDir,
				fetchImpl(url) {
					assert.equal(url, item.asset.checksumUrl);
					return Response.redirect(location);
				},
			}),
			/release URL is not allowed/u,
		);
	}
});

test("requires one exact matching checksum row and the corresponding compressed bytes", async (t) => {
	const { cacheDir } = await fixture(t);
	const item = release();
	for (const checksum of [
		item.checksum.repeat(2),
		item.checksum.replace("  ", " "),
		item.checksum.replace(item.asset.asset, "other.tgz"),
		item.checksum.replace(item.locked.tarballSha256, "0".repeat(64)),
	]) {
		await assert.rejects(
			acquireReleaseTarball(item.asset, { cacheDir, fetchImpl: mockReleases({ ...item, checksum }) }),
			/SHA256SUMS/u,
		);
	}
	await assert.rejects(
		acquireReleaseTarball(item.asset, {
			cacheDir,
			fetchImpl: mockReleases({ ...item, bytes: Buffer.from("substituted") }),
		}),
		/tarball SHA-256 mismatch/u,
	);
	await assert.rejects(access(join(cacheDir, `pi-core-${item.locked.tarballSha256}.tgz`)), {
		code: "ENOENT",
	});
});

test("rejects oversized checksum bodies before requesting the archive", async (t) => {
	const { cacheDir } = await fixture(t);
	const item = release();
	await assert.rejects(
		acquireReleaseTarball(item.asset, {
			cacheDir,
			fetchImpl: mockReleases({ ...item, checksum: "x".repeat(4097) }),
		}),
		/exceeds 4096 bytes/u,
	);
});

test("rejects a hash-matching tarball with a different name or version", async (t) => {
	const { cacheDir } = await fixture(t);
	for (const manifest of [
		{ ...row, name: "@gyoungwe/other" },
		{ ...row, version: "0.2.1" },
	]) {
		const item = release(row, { manifest });
		await assert.rejects(
			acquireReleaseTarball(item.asset, { cacheDir, fetchImpl: mockReleases(item) }),
			/package identity/u,
		);
	}
});

test("rejects traversal, absolute paths, symlinks and hardlinks in verified bytes", async (t) => {
	const { cacheDir } = await fixture(t);
	for (const entry of [
		["package/../outside", "bad"],
		["/outside", "bad"],
		["package/link", "", "2", "../../outside"],
		["package/link", "", "1", "../../outside"],
	]) {
		const item = release(row, { entries: [entry] });
		await assert.rejects(
			acquireReleaseTarball(item.asset, { cacheDir, fetchImpl: mockReleases(item) }),
			/unsafe tar entry/u,
		);
	}
});

async function put(root, path, content) {
	const target = join(root, path);
	await mkdir(dirname(target), { recursive: true });
	await writeFile(target, content);
	return target;
}

function knowledgeRelease() {
	return release(
		{ ...row, name: "@gyoungwe/pi-knowledge", path: "packages/pi-knowledge", builtin: false },
		{
			entries: [
				["package/lib/knowledge/runtime/worker.mjs", "verified worker"],
				["package/lib/knowledge/runtime/.knowledge-worker-manifest.json", "{}"],
			],
		},
	);
}

test("preserves all prior staging when a later Release asset fails verification", async (t) => {
	const { root } = await fixture(t);
	const knowledge = knowledgeRelease();
	const core = release();
	await put(root, "plugins.lock.json", JSON.stringify(lockFor(knowledge.locked, core.locked)));
	const oldFiles = [
		"vendor/plugins/pi-knowledge/index.js",
		"node_modules/@gyoungwe/pi-knowledge/index.js",
		`${extensions}/knowledge-worker.mjs`,
		`${extensions}/.knowledge-worker-manifest.json`,
		`${builtins}/@gyoungwe/pi-core/index.js`,
	];
	for (const path of oldFiles) await put(root, path, "previous generation");
	await assert.rejects(
		fetchPlugins({
			root,
			args: [],
			env: {},
			fetchImpl: mockReleases(knowledge, { ...core, checksum: "bad" }),
		}),
		/SHA256SUMS/u,
	);
	for (const path of oldFiles) assert.equal(await readFile(join(root, path), "utf8"), "previous generation");
});

test("publishes verified vendor packages, built-ins and the knowledge worker together", async (t) => {
	const { root } = await fixture(t);
	const knowledge = knowledgeRelease();
	const core = release();
	await put(root, "plugins.lock.json", JSON.stringify(lockFor(knowledge.locked, core.locked)));
	await put(root, `${builtins}/@gyoungwe/retired/index.js`, "old built-in");
	await fetchPlugins({
		root,
		args: [],
		env: { DRONE_PLUGINS_DIR: join(root, "unavailable") },
		fetchImpl: mockReleases(knowledge, core),
	});
	assert.equal(await readFile(join(root, `${extensions}/knowledge-worker.mjs`), "utf8"), "verified worker");
	assert.equal(await readFile(join(root, `${extensions}/.knowledge-worker-manifest.json`), "utf8"), "{}");
	assert.equal(
		await readFile(join(root, "node_modules/@gyoungwe/pi-core/index.js"), "utf8"),
		"export default 42;\n",
	);
	assert.deepEqual(verifyBuiltinPackages(join(root, builtins), root), { [row.name]: row.version });
	const dependency = await put(
		root,
		"node_modules/@gyoungwe/pi-core/node_modules/local-dep/index.js",
		"npm-installed dependency",
	);
	await fetchPlugins({ root, args: ["--offline"], env: {}, fetchImpl: noNetwork });
	assert.equal(await readFile(dependency, "utf8"), "npm-installed dependency");
});

test("rolls back a vendor replacement if promotion of another output fails", async (t) => {
	const { root } = await fixture(t);
	const core = release();
	await put(root, "plugins.lock.json", JSON.stringify(lockFor(core.locked)));
	const vendor = await put(root, "vendor/plugins/pi-core/index.js", "previous generation");
	const installed = await put(root, "node_modules/@gyoungwe/pi-core/index.js", "previous install");
	const obstruction = await put(root, dirname(builtins), "obstruction");
	await assert.rejects(
		fetchPlugins({ root, args: [], env: {}, fetchImpl: mockReleases(core) }),
		/EEXIST|ENOTDIR/u,
	);
	assert.equal(await readFile(vendor, "utf8"), "previous generation");
	assert.equal(await readFile(installed, "utf8"), "previous install");
	assert.equal(await readFile(obstruction, "utf8"), "obstruction");
});

test("prefetch seeds npm's cache without staging plugins", async (t) => {
	const { root, cacheDir } = await fixture(t);
	const core = release();
	await put(root, "plugins.lock.json", JSON.stringify(lockFor(core.locked)));
	const npmCache = join(root, "npm-cache");
	const vendor = await put(root, "vendor/plugins/pi-core/index.js", "previous generation");
	await fetchPlugins({
		root,
		args: ["--prefetch", "--npm-cache", npmCache],
		env: {},
		fetchImpl: mockReleases(core),
	});
	const filename = `pi-core-${core.locked.tarballSha256}.tgz`;
	assert.deepEqual(await readFile(join(cacheDir, filename)), core.bytes);
	const cached = execFileSync("npm", ["cache", "ls", "--offline", "--cache", npmCache], {
		cwd: root,
		encoding: "utf8",
	});
	assert(cached.includes(filename));
	assert.equal(await readFile(vendor, "utf8"), "previous generation");
	await assert.rejects(access(join(root, "node_modules")), { code: "ENOENT" });
	await assert.rejects(access(join(root, builtins)), { code: "ENOENT" });
});

test("rejects prefetch with worktree overrides and requires explicit worktree inputs", async (t) => {
	const { root } = await fixture(t);
	await put(root, "plugins.lock.json", JSON.stringify(lockFor(row)));
	await assert.rejects(
		fetchPlugins({ root, args: ["--prefetch"], env: { DRONE_PLUGINS_DIR: root }, fetchImpl: noNetwork }),
		/--prefetch/u,
	);
	await assert.rejects(
		fetchPlugins({ root, args: ["--prefetch", "--worktree"], env: {}, fetchImpl: noNetwork }),
		/--prefetch/u,
	);
	await assert.rejects(
		fetchPlugins({ root, args: ["--worktree"], env: {}, fetchImpl: noNetwork }),
		/DRONE_PLUGINS_DIR/u,
	);
});

test("a v1 lock still stages a source-build tarball from the digest cache", async (t) => {
	const { root } = await fixture(t);
	const core = release();
	await put(root, "plugins.lock.json", JSON.stringify({ version: 1, plugins: [core.locked] }));
	await put(root, `vendor/plugins/.tarballs/pi-core-${core.locked.tarballSha256}.tgz`, core.bytes);
	await fetchPlugins({ root, args: ["--offline"], env: {}, fetchImpl: noNetwork });
	assert.deepEqual(verifyBuiltinPackages(join(root, builtins), root), { [row.name]: row.version });
});
