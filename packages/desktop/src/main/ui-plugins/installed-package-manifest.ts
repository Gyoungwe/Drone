import { readFile } from "node:fs/promises";

export function readInstalledPackageManifest(manifestPath: string) {
	return readFile(manifestPath, "utf8")
		.then(
			(value) =>
				JSON.parse(value) as {
					entrypoints?: {
						ui?: unknown;
						desktopRuntime?: unknown;
						extension?: unknown;
						resources?: unknown;
					};
					hosts?: unknown;
					drone?: {
						deliveryProjection?: unknown;
						nativeChildSessions?: unknown;
						taskGrants?: unknown;
						networkReads?: unknown;
						credentials?: unknown;
						workspaceRead?: unknown;
						provides?: unknown;
						requires?: unknown;
						consumes?: unknown;
						recordAdoptions?: unknown;
						p5?: unknown;
						hostEvents?: unknown;
					};
					permissions?: { filesystem?: unknown; network?: unknown; subprocess?: unknown };
				},
		)
		.catch(() => null);
}
