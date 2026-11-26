import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import { DRONE_PLUGIN_PACKAGE_NAMES } from "@drone/shared";
import { expect, it, vi } from "vitest";
import { createFirstPartyReleaseResolver, type FirstPartyReleaseFetcher } from "./first-party-releases";

const catalogUrl = "https://api.github.com/repos/Gyoungwe/drone-plugins/releases";
const [first, second] = DRONE_PLUGIN_PACKAGE_NAMES;
if (!first || !second) throw new Error("Expected two catalog packages");
const name = first;
const other = second;

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

type Asset = { name: string; browser_download_url: string; digest?: string };

async function fixture(root: string) {
	const agentDir = join(root, "agent with spaces");
	const catalog: unknown[] = [];
	const routes = new Map<string, () => Response>([[catalogUrl, () => Response.json(catalog)]]);
	const fetcher = vi.fn<FirstPartyReleaseFetcher>(
		async (url) => routes.get(url)?.() ?? new Response(null, { status: 404 }),
	);
	const resolve = createFirstPartyReleaseResolver(agentDir, { fetcher });
	async function publish(name: string, version: string, identity = { name, version }) {
		const directory = await mkdtemp(join(root, "archive-"));
		const slug = name.split("/").at(-1);
		const tag = `${slug}-v${version}`;
		const filename = `gyoungwe-${slug}-${version}.tgz`;
		const archive = join(directory, filename);
		await mkdir(join(directory, "package"));
		await writeFile(join(directory, "package", "package.json"), JSON.stringify(identity));
		execFileSync("tar", ["-czf", archive, "-C", directory, "package"]);
		const bytes = await readFile(archive);
		const row = `${sha256(bytes)}  ${filename}\n`;
		const base = `https://github.com/Gyoungwe/drone-plugins/releases/download/${tag}`;
		const tarball: Asset = {
			name: filename,
			browser_download_url: `${base}/${filename}`,
			digest: `sha256:${sha256(bytes)}`,
		};
		const checksum: Asset = {
			name: "SHA256SUMS",
			browser_download_url: `${base}/SHA256SUMS`,
			digest: `sha256:${sha256(Buffer.from(row))}`,
		};
		const release = { tag_name: tag, draft: false, prerelease: false, assets: [tarball, checksum] };
		catalog.push(release);
		routes.set(tarball.browser_download_url, () => new Response(bytes));
		routes.set(checksum.browser_download_url, () => new Response(row));
		return { release, tarball, checksum, row, bytes };
	}
	return { agentDir, catalog, routes, fetcher, resolve, publish };
}

function testRelease(label: string, test: (state: Awaited<ReturnType<typeof fixture>>) => Promise<void>) {
	it(label, async () => {
		const root = await mkdtemp(join(tmpdir(), "drone-releases-"));
		try {
			await test(await fixture(root));
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
}

testRelease(
	"shares the release index and stages exact stable versions in the digest cache",
	async (state) => {
		const older = await state.publish(name, "1.9.0");
		const latest = await state.publish(name, "1.10.0");
		await state.publish(other, "2.1.3");
		(await state.publish(name, "4.0.0")).release.draft = true;
		(await state.publish(name, "3.0.0")).release.prerelease = true;
		await state.publish(name, "7.0.0-beta.1");
		await state.publish(name, "01.11.0");
		const [selected, peer, rollback] = await Promise.all([
			state.resolve(name),
			state.resolve(other),
			state.resolve(name, "1.9.0"),
		]);
		expect(selected).toMatchObject({
			name,
			version: "1.10.0",
			sha256: sha256(latest.bytes),
			bytes: latest.bytes,
		});
		expect(peer).toMatchObject({ name: other, version: "2.1.3" });
		expect(rollback).toMatchObject({ version: "1.9.0", bytes: older.bytes });
		expect(fileURLToPath(selected.installSource.slice(`npm:${name}@`.length))).toBe(selected.tarballPath);
		expect(basename(selected.tarballPath)).toBe(`${name.split("/").at(-1)}-1.10.0-${selected.sha256}.tgz`);
		expect(await readFile(selected.tarballPath)).toEqual(latest.bytes);
		if (process.platform !== "win32") {
			expect((await stat(selected.tarballPath)).mode & 0o777).toBe(0o600);
			expect((await stat(join(state.agentDir, "release-cache"))).mode & 0o777).toBe(0o700);
		}
		expect(await readdir(join(state.agentDir, "release-cache"))).toHaveLength(3);
		expect(state.fetcher.mock.calls.filter(([url]) => url === catalogUrl)).toHaveLength(1);
		await expect(state.resolve(name, "2.0.0")).rejects.toMatchObject({ code: "unavailable" });
	},
);

testRelease(
	"rehashes a cache hit and rejects corrupt bytes without replacing the cached file",
	async (state) => {
		const { tarball } = await state.publish(name, "1.0.0");
		const first = await state.resolve(name);
		await expect(state.resolve(name)).resolves.toEqual(first);
		await writeFile(first.tarballPath, "corrupt");
		await expect(state.resolve(name)).rejects.toMatchObject({ code: "operation-failed" });
		expect(await readFile(first.tarballPath, "utf8")).toBe("corrupt");
		expect(state.fetcher.mock.calls.filter(([url]) => url === tarball.browser_download_url)).toHaveLength(1);
	},
);

testRelease("rejects a redirected cache directory", async (state) => {
	await state.publish(name, "1.0.0");
	await mkdir(state.agentDir);
	const elsewhere = await mkdtemp(join(state.agentDir, "elsewhere-"));
	await symlink(elsewhere, join(state.agentDir, "release-cache"), "junction");
	await expect(state.resolve(name)).rejects.toMatchObject({ code: "operation-failed" });
	expect(await readdir(elsewhere)).toEqual([]);
});

testRelease("checks the optional GitHub digests and the single exact checksum row", async (state) => {
	const { tarball, checksum, row, bytes } = await state.publish(name, "1.0.0");
	const resolve = () => createFirstPartyReleaseResolver(state.agentDir, { fetcher: state.fetcher })(name);
	tarball.digest = "sha1:malformed";
	await expect(resolve()).rejects.toMatchObject({ code: "operation-failed" });
	tarball.digest = `sha256:${"0".repeat(64)}`;
	await expect(resolve()).rejects.toMatchObject({ code: "operation-failed" });
	tarball.digest = `sha256:${sha256(bytes)}`;
	for (const badRow of [row.repeat(2), row.replace(tarball.name, `./${tarball.name}`)]) {
		checksum.digest = `sha256:${sha256(Buffer.from(badRow))}`;
		state.routes.set(checksum.browser_download_url, () => new Response(badRow));
		await expect(resolve()).rejects.toMatchObject({ code: "operation-failed" });
	}
	state.routes.set(checksum.browser_download_url, () => new Response(row));
	await expect(resolve()).rejects.toMatchObject({ code: "operation-failed" });
	expect(state.fetcher.mock.calls.some(([url]) => url === tarball.browser_download_url)).toBe(false);
});

testRelease("accepts an absent GitHub digest only if the archive agrees with SHA256SUMS", async (state) => {
	const { checksum, tarball, bytes } = await state.publish(name, "1.0.0");
	delete tarball.digest;
	delete checksum.digest;
	state.routes.set(tarball.browser_download_url, () => new Response("tampered bytes"));
	await expect(state.resolve(name)).rejects.toMatchObject({ code: "operation-failed" });
	state.routes.set(tarball.browser_download_url, () => new Response(bytes));
	await expect(state.resolve(name)).resolves.toMatchObject({ version: "1.0.0" });
});

testRelease("rejects a verified tarball with the wrong package name or version", async (state) => {
	await state.publish(name, "1.0.0", { name: other, version: "1.0.0" });
	await state.publish(name, "2.0.0", { name, version: "1.0.0" });
	for (const version of ["1.0.0", "2.0.0"]) {
		await expect(state.resolve(name, version)).rejects.toMatchObject({ code: "operation-failed" });
	}
});

testRelease("rejects an invalid tar header even when the download checksums agree", async (state) => {
	const { tarball, checksum, bytes } = await state.publish(name, "1.0.0");
	const contents = gunzipSync(bytes);
	contents.fill(0, 148, 156);
	const broken = gzipSync(contents);
	const digest = sha256(broken);
	const row = `${digest}  ${tarball.name}\n`;
	tarball.digest = `sha256:${digest}`;
	checksum.digest = `sha256:${sha256(Buffer.from(row))}`;
	state.routes.set(tarball.browser_download_url, () => new Response(broken));
	state.routes.set(checksum.browser_download_url, () => new Response(row));
	await expect(state.resolve(name)).rejects.toMatchObject({ code: "operation-failed" });
});

testRelease("requires the exact release asset names with no ambiguity", async (state) => {
	const { release, tarball, checksum } = await state.publish(name, "1.0.0");
	release.assets = [{ ...tarball, name: `extra-${tarball.name}` }, checksum];
	await expect(state.resolve(name)).rejects.toMatchObject({ code: "unavailable" });
	release.assets = [tarball, checksum, checksum];
	const resolve = createFirstPartyReleaseResolver(state.agentDir, { fetcher: state.fetcher });
	await expect(resolve(name)).rejects.toMatchObject({ code: "operation-failed" });
});

testRelease(
	"checks each redirect before requesting and permits only the known release hosts",
	async (state) => {
		const { tarball, bytes } = await state.publish(name, "1.0.0");
		const object = "https://objects.githubusercontent.com/fixture";
		const asset = "https://release-assets.githubusercontent.com/fixture";
		const foreign = "https://github.com.example.org/fixture";
		state.routes.set(tarball.browser_download_url, () => Response.redirect(object));
		state.routes.set(object, () => Response.redirect(foreign));
		await expect(state.resolve(name)).rejects.toMatchObject({ code: "operation-failed" });
		expect(state.fetcher.mock.calls.some(([url]) => url === foreign)).toBe(false);
		state.routes.set(object, () => Response.redirect(asset));
		state.routes.set(asset, () => new Response(bytes));
		await expect(state.resolve(name)).resolves.toMatchObject({ version: "1.0.0" });
		expect(state.fetcher.mock.calls.every(([, init]) => init.redirect === "manual")).toBe(true);
	},
);

testRelease("bounds announced and streamed asset sizes", async (state) => {
	const { tarball, checksum, row } = await state.publish(name, "1.0.0");
	state.routes.set(
		tarball.browser_download_url,
		() => new Response(null, { headers: { "content-length": "999999999" } }),
	);
	const overflow = { code: "operation-failed", message: "Release response exceeded its size limit" };
	await expect(state.resolve(name)).rejects.toMatchObject(overflow);
	state.routes.set(checksum.browser_download_url, () => new Response(row.repeat(1000)));
	await expect(state.resolve(name)).rejects.toMatchObject(overflow);
});

testRelease(
	"fails closed for unoffered names, rate limits, missing releases and hung requests",
	async (state) => {
		await expect(state.resolve("@gyoungwe/not-in-the-inventory")).rejects.toMatchObject({
			code: "unavailable",
		});
		expect(state.fetcher).not.toHaveBeenCalled();
		for (const status of [404, 429]) {
			state.routes.set(catalogUrl, () => new Response(null, { status }));
			const resolve = createFirstPartyReleaseResolver(state.agentDir, { fetcher: state.fetcher });
			await expect(resolve(name)).rejects.toMatchObject({ code: "unavailable" });
		}
		const stalled = vi.fn<FirstPartyReleaseFetcher>(() => new Promise(() => undefined));
		const resolve = createFirstPartyReleaseResolver(state.agentDir, { fetcher: stalled, timeoutMs: 15 });
		await expect(resolve(name)).rejects.toMatchObject({ code: "unavailable" });
		expect(stalled.mock.calls[0]?.[1].signal.aborted).toBe(true);
	},
);
