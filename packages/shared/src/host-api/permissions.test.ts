import { Check } from "typebox/value";
import { describe, expect, it } from "vitest";
import { PermissionsContract } from "./permissions";

describe("PermissionsContract", () => {
	it("requires structured save/probe inputs and an optional positive audit limit", () => {
		expect(Check(PermissionsContract.methods.load.args, [])).toBe(true);
		expect(Check(PermissionsContract.methods.save.args, [])).toBe(false);
		expect(Check(PermissionsContract.methods.save.args, [{ settings: {}, expectedMtimeMs: null }])).toBe(
			true,
		);
		expect(Check(PermissionsContract.methods.probe.args, [{ tool: "read", input: {} }])).toBe(true);
		expect(Check(PermissionsContract.methods.probe.args, [{ input: {} }])).toBe(false);
		expect(Check(PermissionsContract.methods.auditTail.args, [])).toBe(true);
		expect(Check(PermissionsContract.methods.auditTail.args, [50])).toBe(true);
		expect(Check(PermissionsContract.methods.auditTail.args, [0])).toBe(false);
	});
});
