#!/usr/bin/env node
/**
 * Research runtime ownership has moved to @drone/research and the published
 * pi-research package. This guard removes stale pre-A5 .pi/lib artifacts and
 * keeps the old command useful in local/CI maintenance scripts.
 */
import { rm, stat } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const legacyDir = resolve(root, ".pi/lib");
const check = process.argv.includes("--check");

try {
	await stat(legacyDir);
	if (check) throw new Error("legacy research runtime directory still exists: .pi/lib");
	await rm(legacyDir, { recursive: true, force: true });
	console.log("removed legacy research runtime resources; @drone/research owns the runtime");
} catch (error) {
	if (error?.code === "ENOENT") {
		console.log("research runtime resources are package-owned");
	} else {
		throw error;
	}
}
