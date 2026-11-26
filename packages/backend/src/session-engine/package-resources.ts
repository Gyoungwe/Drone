import type { PackageSource } from "@earendil-works/pi-coding-agent";
import { DefaultPackageManager, SettingsManager } from "./sdk";

export async function packageHasPiResources(path: string, entry?: PackageSource): Promise<boolean> {
	const source = typeof entry === "object" ? { ...entry, source: path } : path;
	const settingsManager = SettingsManager.inMemory({ packages: [source] });
	const manager = new DefaultPackageManager({ cwd: path, agentDir: path, settingsManager });
	const resolved = await manager.resolve(async () => "skip");
	const file = statSync(path, { throwIfNoEntry: false })?.isFile();
	return [...resolved.extensions, ...resolved.skills, ...resolved.prompts, ...resolved.themes].some(
		(resource) =>
			resource.enabled &&
			resource.metadata.origin === "package" &&
			resource.metadata.source === path &&
			(resource.path !== path || file === true),
	);
}

import { statSync } from "node:fs";
