#!/usr/bin/env node
/**
 * Task runtime ownership belongs to the installed task plugin. This guard
 * removes stale .pi/lib/tasks artifacts instead of generating a second
 * runtime graph, while preserving the resource-shape guard used by CI.
 */
import { rm, stat } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const legacyDir = resolve(root, ".pi/lib/tasks");
const check = process.argv.includes("--check");

try {
	await stat(legacyDir);
	if (check) throw new Error("legacy tasks runtime directory still exists: .pi/lib/tasks");
	await rm(legacyDir, { recursive: true, force: true });
	console.log("removed legacy tasks runtime resources; the installed task plugin owns the runtime");
} catch (error) {
	if (error?.code === "ENOENT") {
		console.log("tasks runtime resources are package-owned");
	} else {
		throw error;
	}
}
