import { defineConfig } from "vitest/config";

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
					include: ["test/**/*.{test,spec}.{ts,tsx,js,jsx,mts,mjs}"],
					exclude: ["test/**/*-sdk.test.*"],
				},
			},
			{
				extends: true,
				test: {
					name: "sdk",
					include: ["test/**/*-sdk.test.*"],
				},
			},
		],
	},
});
