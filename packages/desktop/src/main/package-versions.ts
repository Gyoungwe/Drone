const NAME = /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/iu;

type Fetcher = (
	url: string,
	init: { signal: AbortSignal; headers: Record<string, string> },
) => Promise<{
	ok: boolean;
	json: () => Promise<unknown>;
}>;

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
