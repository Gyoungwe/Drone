import { expect, it } from "vitest";
import { type PluginRuntimeSource, sameSource } from "./plugin-source";

const source: PluginRuntimeSource = {
	pluginId: "example-p5",
	packageRoot: "/plugins/example-p5",
	entrypoint: "/plugins/example-p5/runtime.mjs",
};

it("distinguishes an absent P5 opt-in from a staged-output opt-in", () => {
	expect(sameSource(source, { ...source, p5: { bytes: "staged-output" } })).toBe(false);
});

it("distinguishes different P5 lanes", () => {
	expect(
		sameSource({ ...source, p5: { bytes: "staged-output" } }, { ...source, p5: { batch: "request" } }),
	).toBe(false);
});

it("matches identical P5 opt-ins regardless of object identity or key order", () => {
	expect(
		sameSource(
			{ ...source, p5: { bytes: "staged-output", batch: "request" } },
			{ ...source, p5: { batch: "request", bytes: "staged-output" } },
		),
	).toBe(true);
});

it("treats absent and empty P5 declarations as no opt-ins", () => {
	expect(sameSource(source, { ...source, p5: {} })).toBe(true);
});
