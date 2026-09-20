import { emptyInstitutionalConfig } from "@drone/shared";
import { describe, expect, it } from "vitest";
import { buildProxiedUrl } from "../src/institutional/config.ts";

describe("institutional proxy template", () => {
	it("replaces %s with encoded url", () => {
		const url = "https://www.nature.com/articles/nature12373";
		const template = "https://ezproxy.example.edu/login?url=%s";
		expect(buildProxiedUrl(url, template)).toBe(
			"https://ezproxy.example.edu/login?url=https%3A%2F%2Fwww.nature.com%2Farticles%2Fnature12373",
		);
	});

	it("appends encoded url when template ends with =", () => {
		const url = "https://www.nature.com/articles/nature12373";
		const template = "https://ezproxy.example.edu/login?url=";
		expect(buildProxiedUrl(url, template)).toBe(
			"https://ezproxy.example.edu/login?url=https%3A%2F%2Fwww.nature.com%2Farticles%2Fnature12373",
		);
	});

	it("returns null when already contains host", () => {
		const url = "https://www.nature.com/articles/nature12373";
		const template = "https://ezproxy.example.edu/login?url=https://www.nature.com/articles/nature12373";
		expect(buildProxiedUrl(url, template)).toBeNull();
	});

	it("returns null for empty template", () => {
		expect(buildProxiedUrl("https://example.com", "")).toBeNull();
		expect(buildProxiedUrl("https://example.com", undefined)).toBeNull();
	});

	it("empty config defaults", () => {
		const cfg = emptyInstitutionalConfig();
		expect(cfg.autoDownloadEnabled).toBe(true);
		expect(cfg.perTaskLimit).toBe(20);
		expect(cfg.version).toBe(1);
	});
});
