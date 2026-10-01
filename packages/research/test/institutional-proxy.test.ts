import { describe, expect, it } from "vitest";
import { buildProxiedUrl, inferEzproxyTemplateFromUrl } from "../src/institutional-proxy";

const target = "https://www.nature.com/articles/nature12373";

describe("institutional proxy policy", () => {
	it("encodes a target using a %s template", () => {
		expect(buildProxiedUrl(target, "https://ezproxy.example.edu/login?url=%s")).toBe(
			"https://ezproxy.example.edu/login?url=https%3A%2F%2Fwww.nature.com%2Farticles%2Fnature12373",
		);
	});

	it("fills a trailing query assignment and avoids double proxying", () => {
		expect(buildProxiedUrl(target, "https://ezproxy.example.edu/login?url=")).toBe(
			"https://ezproxy.example.edu/login?url=https%3A%2F%2Fwww.nature.com%2Farticles%2Fnature12373",
		);
		expect(buildProxiedUrl(target, `https://ezproxy.example.edu/login?url=${target}`)).toBeNull();
	});

	it("rejects empty or malformed templates", () => {
		expect(buildProxiedUrl(target, "")).toBeNull();
		expect(buildProxiedUrl(target, "not-a-template")).toBe(
			"not-a-templatehttps%3A%2F%2Fwww.nature.com%2Farticles%2Fnature12373",
		);
	});

	it("infers an EZproxy template only from an explicit HTTP target", () => {
		expect(
			inferEzproxyTemplateFromUrl(
				`https://ezproxy.example.edu/login?url=${encodeURIComponent(target)}`,
			),
		).toBe("https://ezproxy.example.edu/login?url=%s");
		expect(inferEzproxyTemplateFromUrl("https://ezproxy.example.edu/login?url=ftp%3A%2F%2Fexample.org")).toBeNull();
		expect(inferEzproxyTemplateFromUrl("not-a-url")).toBeNull();
	});
});
