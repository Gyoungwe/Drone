import { describe, expect, it } from "vitest";
import { en } from "../../i18n/en";
import { zh } from "../../i18n/zh";
import { mcpRuntimeNotice, mcpStatusKey } from "./mcp-runtime";

const base = {
	version: 1 as const,
	servers: [],
	totalTools: 0,
	totalResources: 0,
	connectedCount: 0,
	disabledCount: 0,
};

describe("MCP runtime notice", () => {
	it("says the runtime is missing or not started until it reports", () => {
		expect(mcpRuntimeNotice(null)).toBeNull();
		expect(mcpRuntimeNotice({ ...base, runtime: "missing" })).toBe("runtimeMissing");
		expect(mcpRuntimeNotice({ ...base, runtime: "starting" })).toBe("runtimeStarting");
		expect(mcpRuntimeNotice({ ...base, runtime: "running" })).toBeNull();
	});

	it("has zh/en copy for every notice and server state", () => {
		for (const dict of [zh, en]) {
			const mcp = dict.settings.mcp as Record<string, unknown>;
			for (const key of ["runtimeMissing", "runtimeStarting", "presetSetupOpen"])
				expect(mcp[key]).toBeTypeOf("string");
			for (const status of [
				"connected",
				"cached",
				"failed",
				"needs-auth",
				"not-connected",
				"disabled",
				"blocked",
			] as const)
				expect(mcp[mcpStatusKey(status)]).toBeTypeOf("string");
		}
		expect(zh.settings.mcp.runtimeMissing).toMatch(/MCP 运行时未安装/);
	});
});
