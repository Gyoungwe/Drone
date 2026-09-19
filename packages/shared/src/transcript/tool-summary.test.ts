import { describe, expect, it } from "vitest";
import { summarizeToolArgs } from "./tool-summary";

describe("summarizeToolArgs", () => {
	it("prefers command / path / url / query fields", () => {
		expect(summarizeToolArgs('{"command":"npm test"}')).toBe("npm test");
		expect(summarizeToolArgs('{"path":"src/a.ts","offset":1}')).toBe("src/a.ts");
		expect(summarizeToolArgs('{"url":"https://x.y/z"}')).toBe("https://x.y/z");
		expect(summarizeToolArgs('{"pattern":"TODO","glob":"*.ts"}')).toBe("TODO");
	});

	it("humanizes unknown tool payloads instead of dumping JSON", () => {
		expect(summarizeToolArgs('{"capabilities":["coding"]}')).toBe("capabilities: coding");
		expect(summarizeToolArgs('{"goal":"实现登录页","milestones":[{"a":1}]}')).toBe("实现登录页");
		expect(summarizeToolArgs('{"nested":{"a":1},"other":{"b":2}}')).toBe("nested · other");
		expect(summarizeToolArgs('{"count":3,"dry":true}')).toBe("count: 3 · dry: true");
	});

	it("handles streaming partial JSON and empty args", () => {
		expect(summarizeToolArgs("")).toBe("");
		expect(summarizeToolArgs("{}")).toBe("");
		expect(summarizeToolArgs('{"command":"git sta')).toBe("git sta");
		expect(summarizeToolArgs('{"goal":"写测')).toBe("写测");
	});

	it("clips long values to one line", () => {
		const long = "x".repeat(300);
		const out = summarizeToolArgs(JSON.stringify({ text: long }));
		expect(out.length).toBeLessThanOrEqual(120);
		expect(out.endsWith("…")).toBe(true);
	});
});
