import { gunzipSync } from "node:zlib";
import {
	createFirstPartyReleaseDiscovery,
	type FirstPartyReleaseFetcher,
	isFirstPartyPackageName,
	isInternalDroneScope,
} from "@drone/backend";
import type { PiPluginPackageKind, RegistryPluginMetadata } from "@drone/shared";

const NAME = /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/iu;

type Fetcher = (
	url: string,
	init: { signal: AbortSignal; headers: Record<string, string> },
) => Promise<{
	ok: boolean;
	json: () => Promise<unknown>;
}>;

type MetadataFetcher = (
	url: string,
	init: { signal: AbortSignal; headers: Record<string, string> },
) => Promise<{
	ok: boolean;
	json: () => Promise<unknown>;
	arrayBuffer: () => Promise<ArrayBuffer>;
}>;

type PackageManifest = {
	name?: unknown;
	version?: unknown;
	description?: unknown;
	capabilities?: unknown;
	hosts?: unknown;
	permissions?: unknown;
	tools?: unknown;
};

function stringList(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string" && item.length > 0)
		: [];
}

function readTarEntries(bytes: Uint8Array): Map<string, string> {
	const entries = new Map<string, string>();
	for (let offset = 0; offset + 512 <= bytes.length; ) {
		const header = bytes.subarray(offset, offset + 512);
		if (header.every((value) => value === 0)) break;
		const name = new TextDecoder().decode(header.subarray(0, 100)).replace(/\0.*$/u, "");
		const sizeText = new TextDecoder().decode(header.subarray(124, 136)).replace(/\0.*$/u, "").trim();
		const size = sizeText ? Number.parseInt(sizeText, 8) : 0;
		if (!name || !Number.isFinite(size) || size < 0) break;
		const start = offset + 512;
		const end = start + size;
		if (end > bytes.length) break;
		entries.set(name, new TextDecoder().decode(bytes.subarray(start, end)));
		offset = start + Math.ceil(size / 512) * 512;
	}
	return entries;
}

function readJson(entries: Map<string, string>, name: string): PackageManifest | undefined {
	const text = entries.get(name);
	if (!text) return undefined;
	try {
		const parsed: unknown = JSON.parse(text);
		return parsed && typeof parsed === "object" ? (parsed as PackageManifest) : undefined;
	} catch {
		return undefined;
	}
}

function metadataFromArchive(
	archive: Uint8Array,
	packument: PackageManifest & { dist?: unknown },
): RegistryPluginMetadata | null {
	const entries = readTarEntries(gunzipSync(archive));
	const packageJson = readJson(entries, "package/package.json");
	if (!packageJson || typeof packageJson.name !== "string") return null;
	const manifest =
		readJson(entries, "package/plugin.manifest.json") ?? readJson(entries, "package/ui/plugin.json");
	const manifestDeclared = Boolean(manifest);
	const packageKind: PiPluginPackageKind =
		entries.has("package/ui/plugin.json") && !entries.has("package/plugin.manifest.json")
			? "desktop-ui"
			: "pi";
	return {
		name: packageJson.name,
		version: typeof packageJson.version === "string" ? packageJson.version : undefined,
		description:
			typeof packageJson.description === "string"
				? packageJson.description
				: typeof packument.description === "string"
					? packument.description
					: undefined,
		capabilities: stringList(manifest?.capabilities),
		tools: stringList(manifest?.tools),
		permissions: manifest?.permissions,
		hosts: stringList(manifest?.hosts),
		packageKind,
		manifestDeclared,
	};
}

async function discoverPackages<Value>(
	names: readonly string[],
	options: { fetcher: FirstPartyReleaseFetcher; timeoutMs: number },
	fromRelease: (release: { version: string; bytes: Uint8Array }) => Value | null,
	fromRegistry: (name: string) => Promise<Value | null>,
): Promise<Record<string, Value | null>> {
	const discoverRelease = createFirstPartyReleaseDiscovery(options);
	const unique = [...new Set(names.filter((name) => NAME.test(name)))].slice(0, 50);
	const entries = await Promise.all(
		unique.map(async (name) => {
			if (isFirstPartyPackageName(name))
				return [
					name,
					await discoverRelease(name)
						.then(fromRelease)
						.catch(() => null),
				] as const;
			return [name, isInternalDroneScope(name) ? null : await fromRegistry(name)] as const;
		}),
	);
	return Object.fromEntries(entries);
}

/**
 * Latest published version for each npm package, so the plugin page can say "up to date" or
 * "update available" instead of a bare "installed". Failures (offline, unknown package, timeout) map to null.
 */
export async function latestPackageVersions(
	names: readonly string[],
	fetcher: Fetcher = fetch,
	timeoutMs = 6000,
): Promise<Record<string, string | null>> {
	return discoverPackages(
		names,
		{ fetcher, timeoutMs },
		({ version }) => version,
		async (name) => {
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), timeoutMs);
			try {
				const url = `https://registry.npmjs.org/${name.replace("/", "%2F")}/latest`;
				const response = await fetcher(url, {
					signal: controller.signal,
					headers: { accept: "application/json" },
				});
				if (!response.ok) return null;
				const body = (await response.json()) as { version?: unknown };
				return typeof body.version === "string" ? body.version : null;
			} catch {
				return null;
			} finally {
				clearTimeout(timer);
			}
		},
	);
}

/**
 * Read the declaration metadata shipped in an npm package before installation.
 * A missing manifest is a valid result for generic Pi packages and is surfaced
 * to the UI as `manifestDeclared: false` rather than being replaced by fallback
 * permissions. Network and archive failures return null for that package.
 */
export async function registryPluginMetadata(
	names: readonly string[],
	fetcher: MetadataFetcher = fetch,
	timeoutMs = 6000,
): Promise<Record<string, RegistryPluginMetadata | null>> {
	return discoverPackages(
		names,
		{ fetcher, timeoutMs },
		({ bytes }) => metadataFromArchive(bytes, {}),
		async (name) => {
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), timeoutMs);
			try {
				const encodedName = name.replace("/", "%2F");
				const packumentResponse = await fetcher(`https://registry.npmjs.org/${encodedName}`, {
					signal: controller.signal,
					headers: { accept: "application/json" },
				});
				if (!packumentResponse.ok) return null;
				const packument = (await packumentResponse.json()) as {
					name?: unknown;
					description?: unknown;
					"dist-tags"?: { latest?: unknown };
					versions?: Record<string, { dist?: { tarball?: unknown } }>;
				};
				const versions = packument.versions ?? {};
				const latest =
					typeof packument["dist-tags"]?.latest === "string"
						? packument["dist-tags"].latest
						: Object.keys(versions).sort().at(-1);
				const tarball = latest ? versions[latest]?.dist?.tarball : undefined;
				if (typeof tarball !== "string") return null;
				const archiveResponse = await fetcher(tarball, {
					signal: controller.signal,
					headers: { accept: "application/octet-stream" },
				});
				if (!archiveResponse.ok) return null;
				return metadataFromArchive(new Uint8Array(await archiveResponse.arrayBuffer()), {
					name: packument.name,
					description: packument.description,
				});
			} catch {
				return null;
			} finally {
				clearTimeout(timer);
			}
		},
	);
}
