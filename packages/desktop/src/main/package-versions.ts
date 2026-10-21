import { gunzipSync } from "node:zlib";
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
	archive: ArrayBuffer,
	packument: PackageManifest & { dist?: unknown },
): RegistryPluginMetadata | null {
	const entries = readTarEntries(gunzipSync(new Uint8Array(archive)));
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

/**
 * Latest published version for each npm package, so the plugin page can say "up to date" or
 * "update available" instead of a bare "installed". Failures (offline, unknown package, timeout) map to null.
 */
export async function latestPackageVersions(
	names: readonly string[],
	fetcher: Fetcher = fetch as unknown as Fetcher,
	timeoutMs = 6000,
): Promise<Record<string, string | null>> {
	const unique = [...new Set(names.filter((name) => NAME.test(name)))].slice(0, 50);
	const entries = await Promise.all(
		unique.map(async (name) => {
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), timeoutMs);
			try {
				const url = `https://registry.npmjs.org/${name.replace("/", "%2F")}/latest`;
				const response = await fetcher(url, {
					signal: controller.signal,
					headers: { accept: "application/json" },
				});
				if (!response.ok) return [name, null] as const;
				const body = (await response.json()) as { version?: unknown };
				return [name, typeof body.version === "string" ? body.version : null] as const;
			} catch {
				return [name, null] as const;
			} finally {
				clearTimeout(timer);
			}
		}),
	);
	return Object.fromEntries(entries);
}

/**
 * Read the declaration metadata shipped in an npm package before installation.
 * A missing manifest is a valid result for generic Pi packages and is surfaced
 * to the UI as `manifestDeclared: false` rather than being replaced by fallback
 * permissions. Network and archive failures return null for that package.
 */
export async function registryPluginMetadata(
	names: readonly string[],
	fetcher: MetadataFetcher = fetch as unknown as MetadataFetcher,
	timeoutMs = 6000,
): Promise<Record<string, RegistryPluginMetadata | null>> {
	const unique = [...new Set(names.filter((name) => NAME.test(name)))].slice(0, 50);
	const entries = await Promise.all(
		unique.map(async (name) => {
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), timeoutMs);
			try {
				const encodedName = name.replace("/", "%2F");
				const packumentResponse = await fetcher(`https://registry.npmjs.org/${encodedName}`, {
					signal: controller.signal,
					headers: { accept: "application/json" },
				});
				if (!packumentResponse.ok) return [name, null] as const;
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
				if (typeof tarball !== "string") return [name, null] as const;
				const archiveResponse = await fetcher(tarball, {
					signal: controller.signal,
					headers: { accept: "application/octet-stream" },
				});
				if (!archiveResponse.ok) return [name, null] as const;
				const metadata = metadataFromArchive(await archiveResponse.arrayBuffer(), {
					name: packument.name,
					description: packument.description,
				});
				return [name, metadata] as const;
			} catch {
				return [name, null] as const;
			} finally {
				clearTimeout(timer);
			}
		}),
	);
	return Object.fromEntries(entries);
}
