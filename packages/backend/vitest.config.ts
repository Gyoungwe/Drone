import { readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const PACKAGE_ROOT = dirname(fileURLToPath(import.meta.url));
const TEST_FILE = /\.(?:test|spec)\.[^/]+$/;
const REAL_RUNTIME = /\bnew\s+PiBackend\s*\(|\bcreateAgentSession\s*\(|\bnew\s+AgentSession\s*\(/;

/**
 * Keep tests that instantiate PiBackend/createAgentSession in the SDK project
 * even when their filenames predate the `*-sdk.test.*` convention. This keeps
 * the unit project hermetic while automatically classifying newly added tests.
 */
function runtimeTestFiles(dir: string): string[] {
	const result: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.name === "node_modules" || entry.name === "dist") continue;
		const path = resolve(dir, entry.name);
		if (entry.isDirectory()) {
			result.push(...runtimeTestFiles(path));
			continue;
		}
		if (!TEST_FILE.test(entry.name)) continue;
		if (REAL_RUNTIME.test(readFileSync(path, "utf8"))) {
			result.push(relative(PACKAGE_ROOT, path).split(sep).join("/"));
		}
	}
	return result.sort();
}

const runtimeTests = runtimeTestFiles(PACKAGE_ROOT);
const SDK_TEST_GLOB = "**/*-sdk.test.*";
const ALL_TEST_GLOB = "**/*.{test,spec}.{ts,tsx,js,jsx,mts,mjs}";

export default defineConfig({
	test: {
		// SQLite services create native workers. Isolate test files in processes and
		// bound Windows concurrency to avoid native worker / IPC crashes under load.
		pool: "forks",
		...(process.platform === "win32" ? { maxWorkers: 2, minWorkers: 1 } : {}),
		projects: [
			{
				extends: true,
				test: {
					name: "unit",
					include: [ALL_TEST_GLOB],
					exclude: [SDK_TEST_GLOB, ...runtimeTests, "**/node_modules/**"],
				},
			},
			{
				extends: true,
				test: {
					name: "sdk",
					include: [SDK_TEST_GLOB, ...runtimeTests],
				},
			},
		],
	},
});
