import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

/**
 * Development builds isolate userData under `<userData>-dev`, so they never see the
 * formal build's knowledge binding. This reads the formal binding (read-only) so the
 * unbound state can offer "use the formal build's knowledge base" with a real path.
 * Returns null for packaged builds, non-isolated paths, or a missing/invalid binding.
 */
export async function formalKnowledgeVault(options: {
	isPackaged: boolean;
	userData: string;
	read?: (path: string) => Promise<string>;
	isDirectory?: (path: string) => Promise<boolean>;
}): Promise<string | null> {
	if (options.isPackaged || !options.userData.endsWith("-dev")) return null;
	const formalUserData = options.userData.slice(0, -"-dev".length);
	const read = options.read ?? ((path: string) => readFile(path, "utf8"));
	const isDirectory =
		options.isDirectory ??
		(async (path: string) => {
			try {
				return (await stat(path)).isDirectory();
			} catch {
				return false;
			}
		});
	try {
		const raw = JSON.parse((await read(join(formalUserData, "knowledge", "binding.json"))).replace(/^﻿/, ""));
		const vault = typeof raw?.vault === "string" ? raw.vault : null;
		return vault && (await isDirectory(vault)) ? vault : null;
	} catch {
		return null;
	}
}
