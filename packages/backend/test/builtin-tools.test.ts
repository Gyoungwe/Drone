import { describe, expect, it } from "vitest";
import { excludedBuiltinTools } from "../src/session-engine/builtin-tools";
import { makeCapabilityLoadTool } from "../src/tools/capability-load";
import { CORE_TOOL_META } from "../src/tools/manifest";

describe("powershell exposure", () => {
	it("drops the powershell tool on darwin and linux, including WSL", () => {
		expect(excludedBuiltinTools("darwin")).toEqual(["powershell"]);
		expect(excludedBuiltinTools("linux")).toEqual(["powershell"]);
		expect(excludedBuiltinTools("win32")).toEqual([]);
		expect(excludedBuiltinTools()).toEqual(process.platform === "win32" ? [] : ["powershell"]);
	});

	it("keeps powershell in the coding pack, beside bash", () => {
		expect(CORE_TOOL_META.powershell).toEqual({ capabilities: ["coding"] });
		expect(CORE_TOOL_META.bash).toEqual({ capabilities: ["coding"] });
		const description = makeCapabilityLoadTool({} as never).description;
		expect(description).toMatch(/coding carries the shell \(bash, and powershell on Windows\)/);
		expect(description).toMatch(/adds tools only/);
	});
});
