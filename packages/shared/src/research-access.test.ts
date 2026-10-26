import { describe, expect, it } from "vitest";
import {
	buildProxiedUrl,
	cloudflareAskCopy,
	inferEzproxyTemplateFromUrl,
	looksLikeCloudflare,
} from "./research-access";

describe("research access host policy", () => {
	it("builds a URL from an encoded template and rejects double proxying", () => {
		expect(buildProxiedUrl("https://example.com/a", "https://proxy.test/?url=")).toBe(
			"https://proxy.test/?url=https%3A%2F%2Fexample.com%2Fa",
		);
		expect(buildProxiedUrl("https://proxy.test/a", "https://proxy.test/?url=")).toBeNull();
	});

	it("infers only explicit EZproxy targets", () => {
		expect(inferEzproxyTemplateFromUrl("https://login.ezproxy.test/?url=https%3A%2F%2Fexample.com")).toBe(
			"https://login.ezproxy.test/?url=%s",
		);
		expect(inferEzproxyTemplateFromUrl("https://example.com/article")).toBeNull();
	});

	it("recognizes challenge body or header signals", () => {
		expect(looksLikeCloudflare({ "cf-mitigated": "challenge" }, "ok")).toBe(true);
		expect(looksLikeCloudflare(null, "Just a moment... checking your browser")).toBe(true);
		expect(looksLikeCloudflare(null, "normal page")).toBe(false);
	});

	it("keeps the language choice in the host contract", () => {
		expect(cloudflareAskCopy("zh-CN").continueLabel).toBe("我已完成，继续");
		expect(cloudflareAskCopy("en-US").continueLabel).toBe("I've finished, continue");
	});
});
