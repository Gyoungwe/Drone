import { createHash } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { lstat, mkdir, mkdtemp, open, realpath, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import { compareVersions, DRONE_PLUGIN_PACKAGE_NAMES } from "@drone/shared";

const CATALOG_URL = "https://api.github.com/repos/Gyoungwe/drone-plugins/releases";
const RELEASE_HOSTS = new Set([
	"api.github.com",
	"github.com",
	"objects.githubusercontent.com",
	"release-assets.githubusercontent.com",
]);
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const CATALOG_TTL_MS = 60_000;
const CATALOG_LIMIT = 8 * 1024 * 1024;
const CHECKSUM_LIMIT = 8 * 1024;
const ARCHIVE_LIMIT = 64 * 1024 * 1024;
const EXPANDED_LIMIT = 256 * 1024 * 1024;
const STABLE_VERSION = /^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){2}$/u;

type ReleaseResponse = Pick<Response, "ok"> &
	Partial<Pick<Response, "status" | "headers" | "body" | "json" | "arrayBuffer">>;
export type FirstPartyReleaseFetcher = (
	url: string,
	init: { signal: AbortSignal; headers: Record<string, string>; redirect: "manual" },
) => Promise<ReleaseResponse>;
type ReleaseOptions = { fetcher?: FirstPartyReleaseFetcher; timeoutMs?: number };
type Asset = { url: URL; digest?: string };
type ReleaseIdentity = { name: string; version: string; sha256: string };
type Archive = ReleaseIdentity & { bytes: Buffer };
type Release = ReleaseIdentity & { slug: string; download(): Promise<Buffer> };
export type FirstPartyReleaseResolver = (
	name: string,
	version?: string,
) => Promise<Archive & { tarballPath: string; installSource: string }>;

export function isFirstPartyPackageName(name: string): boolean {
	return DRONE_PLUGIN_PACKAGE_NAMES.includes(name);
}

export function isInternalDroneScope(name: string): boolean {
	return name.toLowerCase().startsWith("@gyoungwe/");
}

function releaseError(code: "unavailable" | "operation-failed", message: string) {
	return Object.assign(new Error(message), { code });
}

function integrityError(message: string) {
	return releaseError("operation-failed", message);
}

function record(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function releaseUrl(value: string, base?: URL): URL {
	const url = URL.parse(value, base);
	if (
		url?.protocol !== "https:" ||
		!RELEASE_HOSTS.has(url.hostname) ||
		url.port ||
		url.username ||
		url.password
	)
		throw integrityError("Release asset URL is outside the allowed GitHub hosts");
	return url;
}

async function checkedResponse(
	fetcher: FirstPartyReleaseFetcher,
	start: URL,
	accept: string,
	signal: AbortSignal,
): Promise<ReleaseResponse> {
	let url = start;
	for (let redirects = 0; ; redirects++) {
		signal.throwIfAborted();
		const response = await fetcher(url.href, { signal, headers: { accept }, redirect: "manual" });
		if (!REDIRECTS.has(response.status ?? 0)) {
			if (!response.ok) throw releaseError("unavailable", "GitHub release could not be reached");
			return response;
		}
		const location = response.headers?.get("location");
		if (!location || redirects === 5) throw integrityError("Invalid release redirect");
		await response.body?.cancel();
		url = releaseUrl(location, url);
	}
}

async function readBytes(response: ReleaseResponse, limit: number): Promise<Buffer> {
	const overflow = () => integrityError("Release response exceeded its size limit");
	if (Number(response.headers?.get("content-length")) > limit) throw overflow();
	if (!response.body) {
		if (!response.arrayBuffer) throw integrityError("Release bytes are missing");
		const bytes = await response.arrayBuffer();
		if (bytes.byteLength > limit) throw overflow();
		return Buffer.from(bytes);
	}
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let length = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) return Buffer.concat(chunks, length);
			length += value.byteLength;
			if (length > limit) throw overflow();
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
}

function releaseClient({ fetcher = fetch, timeoutMs = 6000 }: ReleaseOptions) {
	return async <Result>(url: URL, accept: string, read: (response: ReleaseResponse) => Promise<Result>) => {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), timeoutMs);
		const deadline = new Promise<never>((_, reject) => {
			controller.signal.addEventListener(
				"abort",
				() => reject(releaseError("unavailable", "GitHub release request timed out")),
				{ once: true },
			);
		});
		try {
			return await Promise.race([
				checkedResponse(fetcher, url, accept, controller.signal).then(read),
				deadline,
			]);
		} catch (error) {
			if (
				error instanceof Error &&
				"code" in error &&
				(error.code === "operation-failed" || error.code === "unavailable")
			)
				throw error;
			throw releaseError("unavailable", "GitHub release response could not be read");
		} finally {
			clearTimeout(timeout);
			controller.abort();
		}
	};
}

async function readCatalog(response: ReleaseResponse): Promise<unknown[]> {
	const value: unknown = response.body
		? JSON.parse((await readBytes(response, CATALOG_LIMIT)).toString("utf8"))
		: await response.json?.();
	if (!Array.isArray(value)) throw integrityError("Invalid GitHub release index");
	return value;
}

function selectRelease(releases: unknown[], slug: string, expectedVersion?: string) {
	const prefix = `${slug}-v`;
	let selected: { version: string; assets: unknown } | undefined;
	for (const value of releases) {
		const entry = record(value);
		if (entry?.draft !== false || entry.prerelease !== false || typeof entry.tag_name !== "string") continue;
		if (!entry.tag_name.startsWith(prefix)) continue;
		const version = entry.tag_name.slice(prefix.length);
		if (
			!STABLE_VERSION.test(version) ||
			!version.split(".").every((part) => Number.isSafeInteger(Number(part)))
		)
			continue;
		if (expectedVersion !== undefined && version !== expectedVersion) continue;
		if (!selected || compareVersions(version, selected.version) > 0)
			selected = { version, assets: entry.assets };
	}
	if (!selected) throw releaseError("unavailable", "No matching stable first-party release is available");
	return selected;
}

function releaseAsset(assets: unknown, filename: string): Asset {
	const matches = (Array.isArray(assets) ? assets : [])
		.map(record)
		.filter((asset) => asset?.name === filename);
	const asset = matches[0];
	if (!asset) throw releaseError("unavailable", "A required GitHub release asset is missing");
	if (matches.length !== 1 || typeof asset.browser_download_url !== "string")
		throw integrityError("Invalid GitHub release asset");
	const url = releaseUrl(asset.browser_download_url);
	if (asset.digest == null) return { url };
	const digest =
		typeof asset.digest === "string" ? /^sha256:([0-9a-f]{64})$/iu.exec(asset.digest)?.[1] : undefined;
	if (!digest) throw integrityError("Invalid GitHub release asset digest");
	return { url, digest: digest.toLowerCase() };
}

function sha256(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

function checksumDigest(bytes: Buffer, filename: string, tarball: Asset, checksum: Asset): string {
	if (checksum.digest && sha256(bytes) !== checksum.digest)
		throw integrityError("Release checksum asset digest did not match");
	const row = /^([0-9a-f]{64}) {2}([^\r\n]+)\r?\n?$/iu.exec(bytes.toString("utf8"));
	const digest = row?.[1]?.toLowerCase();
	if (!digest || row?.[2] !== filename || (tarball.digest && tarball.digest !== digest))
		throw integrityError("Release checksum did not match the exact archive asset");
	return digest;
}

function tarField(header: Buffer, start: number, end: number): string {
	return header.toString("utf8", start, end).split("\0", 1)[0] ?? "";
}

function packageManifest(bytes: Buffer): unknown {
	const tar = gunzipSync(bytes, { maxOutputLength: EXPANDED_LIMIT });
	let manifest: unknown;
	for (let offset = 0; offset + 512 <= tar.length; ) {
		const header = tar.subarray(offset, offset + 512);
		if (header.every((byte) => byte === 0)) break;
		const checksum = header.reduce((sum, byte, index) => sum + (index < 148 || index >= 156 ? byte : 32), 0);
		if (checksum !== Number.parseInt(tarField(header, 148, 156).trim(), 8))
			throw integrityError("Invalid release archive header checksum");
		const sizeField = tarField(header, 124, 136).trim();
		if (!/^[0-7]+$/u.test(sizeField)) throw integrityError("Invalid release archive header");
		const size = Number.parseInt(sizeField, 8);
		const start = offset + 512;
		const end = start + size;
		if (end > tar.length) throw integrityError("Truncated release archive entry");
		const name = tarField(header, 0, 100);
		if (name === "package/package.json" && !tarField(header, 345, 500)) {
			if (manifest !== undefined || (header[156] !== 0 && header[156] !== 48))
				throw integrityError("Ambiguous release archive package manifest");
			manifest = JSON.parse(tar.toString("utf8", start, end));
		}
		offset = start + Math.ceil(size / 512) * 512;
	}
	return manifest;
}

function verifyArchive(bytes: Buffer, release: ReleaseIdentity): Buffer {
	if (bytes.length > ARCHIVE_LIMIT || sha256(bytes) !== release.sha256)
		throw integrityError("Release archive SHA-256 did not match");
	let identity: Record<string, unknown> | undefined;
	try {
		identity = record(packageManifest(bytes));
	} catch {
		throw integrityError("Release archive package manifest could not be read");
	}
	if (identity?.name !== release.name || identity.version !== release.version)
		throw integrityError("Release archive package identity did not match");
	return bytes;
}

function createReleaseLookup(options: ReleaseOptions) {
	const request = releaseClient(options);
	const download = ({ url }: Asset, limit: number) =>
		request(url, "application/octet-stream", (response) => readBytes(response, limit));
	const index: { expiresAt: number; releases?: Promise<unknown[]> } = { expiresAt: 0 };
	return async (name: string, expectedVersion?: string): Promise<Release> => {
		const slug = name.split("/")[1];
		if (!slug || !isFirstPartyPackageName(name))
			throw releaseError("unavailable", "No first-party release source is offered for this package");
		if (!index.releases || Date.now() >= index.expiresAt) {
			index.expiresAt = Date.now() + CATALOG_TTL_MS;
			index.releases = request(new URL(CATALOG_URL), "application/json", readCatalog);
		}
		const { version, assets } = selectRelease(await index.releases, slug, expectedVersion);
		const filename = `gyoungwe-${slug}-${version}.tgz`;
		const tarball = releaseAsset(assets, filename);
		const checksum = releaseAsset(assets, "SHA256SUMS");
		const sha256 = checksumDigest(await download(checksum, CHECKSUM_LIMIT), filename, tarball, checksum);
		return { name, version, sha256, slug, download: () => download(tarball, ARCHIVE_LIMIT) };
	};
}

function isPrivate(stat: Stats): boolean {
	return process.platform === "win32" || ((stat.mode & 0o077) === 0 && stat.uid === process.getuid?.());
}

async function cachedArchive(path: string, release: ReleaseIdentity): Promise<Buffer | undefined> {
	const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch(
		(error: NodeJS.ErrnoException) => {
			if (error.code === "ENOENT") return undefined;
			throw integrityError("Release cache archive could not be opened");
		},
	);
	if (!file) return undefined;
	try {
		const stat = await file.stat();
		if (!stat.isFile() || !isPrivate(stat) || stat.size > ARCHIVE_LIMIT)
			throw integrityError("Invalid release cache archive");
		return verifyArchive(await file.readFile(), release);
	} finally {
		await file.close();
	}
}

async function stageArchive(directory: string, path: string, release: Release): Promise<Buffer> {
	const bytes = await release.download();
	const staging = await mkdtemp(join(directory, ".stage-"));
	const temporary = join(staging, "archive.tgz");
	try {
		await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
		const verified = await cachedArchive(temporary, release);
		if (!verified) throw integrityError("Staged release archive could not be verified");
		await rename(temporary, path);
		return verified;
	} finally {
		await rm(staging, { recursive: true, force: true });
	}
}

export function createFirstPartyReleaseDiscovery(options: ReleaseOptions = {}) {
	const lookup = createReleaseLookup(options);
	return async (name: string): Promise<Archive> => {
		const release = await lookup(name);
		const { version, sha256 } = release;
		return { name, version, sha256, bytes: verifyArchive(await release.download(), release) };
	};
}

export function createFirstPartyReleaseResolver(
	agentDir: string,
	options: ReleaseOptions = {},
): FirstPartyReleaseResolver {
	const lookup = createReleaseLookup(options);
	return async (name, expectedVersion) => {
		const release = await lookup(name, expectedVersion);
		await mkdir(agentDir, { recursive: true, mode: 0o700 });
		const directory = join(await realpath(agentDir), "release-cache");
		await mkdir(directory, { recursive: true, mode: 0o700 });
		const stat = await lstat(directory);
		if (!stat.isDirectory() || !isPrivate(stat))
			throw integrityError("Release cache is not a private directory");
		const { slug, version, sha256 } = release;
		const tarballPath = join(directory, `${slug}-${version}-${sha256}.tgz`);
		const bytes =
			(await cachedArchive(tarballPath, release)) ?? (await stageArchive(directory, tarballPath, release));
		return {
			name,
			version,
			sha256,
			tarballPath,
			installSource: `npm:${name}@${pathToFileURL(tarballPath).href}`,
			bytes,
		};
	};
}
