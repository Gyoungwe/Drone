import { describe, expect, it } from "vitest";
import { buildSessionCustomTools, buildSessionExtensionFactories } from "../src/session-engine/extensions";

const baseDeps = {
	runtime: {},
	traces: { recordCustom: () => undefined },
	webFetch: false,
	subagentPreferBuiltin: false,
	getModelRuntime: async () => ({}),
	getSubagentModel: async () => undefined,
	onEvent: () => undefined,
	setMcpStatus: () => undefined,
};

const gate = { confirm: async () => true } as any;
const askGate = { ask: async () => "" } as any;

function toolNames(harness?: Record<string, boolean>) {
	return buildSessionCustomTools({ ...baseDeps, harness } as any, gate, askGate).map((tool) => tool.name);
}

function extensionNames(harness?: Record<string, boolean>) {
	return buildSessionExtensionFactories({ ...baseDeps, harness } as any, "/tmp/drone", undefined).map(
		(factory) => (factory as { name?: string }).name,
	);
}

describe("harness unit switches", () => {
	it("removes only the selected recall tool", () => {
		const names = toolNames({ recall: false });
		expect(names).not.toContain("harness_recall");
		expect(names).toContain("ask_user");
		expect(names).toContain("set_status");
	});

	it.each([
		["context", "harness-context"],
		["guard", "harness-guard"],
		["delivery", "harness-delivery"],
	] as const)("removes only the selected %s extension", (unit, removed) => {
		const names = extensionNames({ [unit]: false });
		expect(names).not.toContain(removed);
		for (const other of ["harness-context", "harness-guard", "harness-delivery"]) {
			if (other !== removed) expect(names).toContain(other);
		}
	});
});
