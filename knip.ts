import { readFileSync } from "node:fs";
import type { KnipConfig } from "knip";

// plugin-api publishes dist/*.js; map each public subpath back to its source so
// public contracts never show up as "unused files".
const pluginApiExports: Record<string, { import: string }> = JSON.parse(
	readFileSync(new URL("./packages/plugin-api/package.json", import.meta.url), "utf8"),
).exports;
const pluginApiEntries = Object.values(pluginApiExports).map((target) =>
	target.import.replace(/^\.\/dist\//, "src/").replace(/\.js$/, ".ts"),
);

const config: KnipConfig = {
	workspaces: {
		".": {
			entry: ["scripts/**/*.{mjs,mts,js,ts}"],
			project: ["scripts/**/*.{mjs,mts,js,ts}"],
		},
		"packages/desktop": {
			// electron-vite default entries; Knip has no electron-vite plugin.
			entry: [
				"src/main/index.ts",
				"src/preload/index.ts",
				"src/renderer/src/main.tsx",
				"scripts/**/*.{mjs,ts,tsx}",
			],
			project: ["src/**/*.{ts,tsx}", "scripts/**/*.{mjs,ts,tsx}"],
		},
		"packages/extensions": {
			// scripts/build-extensions.mjs bundles every top-level src/*.ts.
			entry: ["src/*.ts"],
			project: ["src/**/*.ts", "test/**/*.{ts,mts,mjs}"],
		},
		"packages/plugin-api": {
			entry: pluginApiEntries,
			project: ["src/**/*.ts", "test/**/*.{ts,mts,mjs}"],
		},
		"packages/*": {
			project: ["src/**/*.{ts,tsx,mts,mjs}", "test/**/*.{ts,tsx,mts,mjs}"],
		},
	},
	// Agent-invoked CLIs/libraries with no static import in the repo.
	ignoreDependencies: ["@ast-grep/cli", "ts-morph"],
	ignore: [".pi/**", "**/out/**", "**/dist/**", "packages/*/src/runtime-compiled/**"],
};

export default config;
