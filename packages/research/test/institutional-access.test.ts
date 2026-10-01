import { describe, expect, it } from "vitest";
import {
	detectAndSaveTemplateFromUrl,
	emptyInstitutionalConfig,
	loadInstitutionalConfig,
	normalizeInstitutionalConfig,
	saveInstitutionalConfig,
} from "../src/institutional-access";

const target = "https://www.nature.com/articles/nature12373";

describe("institutional access config runtime", () => {
	it("normalizes bounded config while preserving safe fields", () => {
		expect(
			normalizeInstitutionalConfig({
				ezproxyTemplate: "https://ezproxy.example.edu/login?url=%s",
				institutionName: " Example University ",
				perTaskLimit: 999,
				autoDownloadEnabled: false,
			}),
		).toMatchObject({
			ezproxyTemplate: "https://ezproxy.example.edu/login?url=%s",
			institutionName: "Example University",
			perTaskLimit: 100,
			autoDownloadEnabled: false,
			configured: true,
		});
	});

	it("returns the safe default when storage is unavailable", async () => {
		const config = await loadInstitutionalConfig("/missing/institutional.json", {
			readFile: async () => {
				throw new Error("missing");
			},
		});
		expect(config).toEqual(emptyInstitutionalConfig());
	});

	it("writes normalized config through injected storage", async () => {
		let stored = "";
		const config = await saveInstitutionalConfig(
			{ ezproxyTemplate: "https://proxy.example.edu/login?url=%s", perTaskLimit: 0 },
			"/agent/institutional.json",
			{
				readFile: async () => stored,
				mkdir: async () => {},
				writeFile: async (_path, value) => {
					stored = value;
				},
			},
		);
		expect(config.perTaskLimit).toBe(1);
		expect(JSON.parse(stored).ezproxyTemplate).toContain("proxy.example.edu");
	});

	it("records an inferred EZproxy template without storing credentials", async () => {
		let stored = "{}";
		const config = await detectAndSaveTemplateFromUrl(
			`https://ezproxy.example.edu/login?url=${encodeURIComponent(target)}`,
			{
				path: "/agent/institutional.json",
				io: {
					readFile: async () => stored,
					mkdir: async () => {},
					writeFile: async (_path, value) => {
						stored = value;
					},
				},
			},
		);
		expect(config?.ezproxyTemplate).toBe("https://ezproxy.example.edu/login?url=%s");
		expect(stored).not.toContain("password");
	});
});
