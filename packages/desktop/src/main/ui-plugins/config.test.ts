// @vitest-environment node
import { describe, expect, it } from "vitest";
import { applyUiPluginsPatch, defaultUiPluginsConfig } from "./config-merge";

describe("applyUiPluginsPatch", () => {
	it("deep-merges plugins so a one-plugin patch keeps existing entries", () => {
		const draft = {
			enabled: true,
			plugins: {
				"ds-whale-maid": { enabled: true, trusted: true },
				"voice-alerts": { enabled: false, trusted: false },
			},
			assignments: {},
		};
		const next = applyUiPluginsPatch(draft, {
			plugins: { "ds-whale-maid-q": { enabled: true, trusted: true } },
		});
		expect(next.enabled).toBe(true);
		expect(next.plugins).toEqual({
			"ds-whale-maid": { enabled: true, trusted: true },
			"voice-alerts": { enabled: false, trusted: false },
			"ds-whale-maid-q": { enabled: true, trusted: true },
		});
	});

	it("replaces assignments when provided and keeps them when omitted", () => {
		const draft = {
			enabled: true,
			plugins: {},
			assignments: { "app.overlay": "ds-whale-maid" },
		};
		expect(applyUiPluginsPatch(draft, { enabled: true }).assignments).toEqual({
			"app.overlay": "ds-whale-maid",
		});
		expect(applyUiPluginsPatch(draft, { assignments: {} }).assignments).toEqual({});
	});

	it("null draft falls back to defaults plus the patch", () => {
		const next = applyUiPluginsPatch(null, {
			enabled: true,
			plugins: { "ds-whale-maid": { enabled: true, trusted: true } },
		});
		expect(next.enabled).toBe(true);
		expect(next.plugins["ds-whale-maid"]).toEqual({ enabled: true, trusted: true });
		expect(next.assignments).toEqual(defaultUiPluginsConfig().assignments);
	});
});
