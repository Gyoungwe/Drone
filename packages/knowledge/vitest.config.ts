import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		// Windows runners do file and SQLite I/O several times slower; the 5 s default
		// timed out the bounded experience-store search test at random.
		testTimeout: process.platform === "win32" ? 30_000 : 5_000,
		hookTimeout: process.platform === "win32" ? 30_000 : 10_000,
	},
});
