import { Check } from "typebox/value";
import { describe, expect, it } from "vitest";
import { channelOf } from "./define";
import { McpContract } from "./mcp";

const status = {
	version: 1,
	servers: [{ name: "docs", status: "connected", toolCount: 2, resourceCount: 1, disabled: false }],
	totalTools: 2,
	totalResources: 1,
	connectedCount: 1,
	disabledCount: 0,
};

const config = {
	path: "/tmp/.mcp.json",
	cwd: "/tmp/project",
	servers: [
		{
			name: "docs",
			transport: "stdio",
			command: "node",
			disabled: false,
			scope: "project",
			sourcePath: "/tmp/project/.mcp.json",
		},
	],
};

describe("McpContract", () => {
	it("keeps stable channels and validates projections", () => {
		expect(channelOf(McpContract, "getStatus")).toBe("mcp:getStatus");
		expect(channelOf(McpContract, "setServerEnabled")).toBe("mcp:setServerEnabled");
		expect(Check(McpContract.methods.getStatus.args, [])).toBe(true);
		expect(Check(McpContract.methods.getStatus.args, [undefined])).toBe(true);
		expect(Check(McpContract.methods.getStatus.args, [42])).toBe(false);
		expect(Check(McpContract.methods.getStatus.result, status)).toBe(true);
		expect(Check(McpContract.methods.getConfig.result, config)).toBe(true);
	});

	it("rejects malformed mutation arguments", () => {
		expect(Check(McpContract.methods.setServerEnabled.args, ["docs", true])).toBe(true);
		expect(Check(McpContract.methods.setServerEnabled.args, ["docs", false, undefined])).toBe(true);
		expect(Check(McpContract.methods.setServerEnabled.args, ["docs", "true"])).toBe(false);
	});
});
