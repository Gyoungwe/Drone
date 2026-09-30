import { Check } from "typebox/value";
import { describe, expect, it } from "vitest";
import { channelOf } from "./define";
import { InstitutionalContract } from "./institutional";

describe("InstitutionalContract", () => {
	it("keeps legacy channels and optional login arguments", () => {
		expect(channelOf(InstitutionalContract, "getStatus")).toBe("institutional:getStatus");
		expect(channelOf(InstitutionalContract, "saveConfig")).toBe("institutional:saveConfig");
		expect(channelOf(InstitutionalContract, "openLogin")).toBe("institutional:openLogin");
		expect(channelOf(InstitutionalContract, "testAccess")).toBe("institutional:testAccess");
		expect(Check(InstitutionalContract.methods.getStatus.args, [])).toBe(true);
		expect(Check(InstitutionalContract.methods.getStatus.args, ["unexpected"])).toBe(false);
		expect(Check(InstitutionalContract.methods.openLogin.args, [])).toBe(true);
		expect(Check(InstitutionalContract.methods.openLogin.args, ["https://login.example.edu"])).toBe(true);
		expect(Check(InstitutionalContract.methods.openLogin.args, [42])).toBe(false);
		expect(
			Check(InstitutionalContract.methods.saveConfig.args, [
				{ autoDownloadEnabled: false, perTaskLimit: 10, institutionName: "Example" },
			]),
		).toBe(true);
		expect(Check(InstitutionalContract.methods.saveConfig.args, [{ perTaskLimit: 0 }])).toBe(false);
	});

	it("validates status and access results without leaking extra fields", () => {
		const status = {
			config: { version: 1, autoDownloadEnabled: true, perTaskLimit: 20 },
			session: {
				cookiesCount: 1,
				hasSessionCookies: true,
				partition: "persist:drone-institutional",
			},
			loggedIn: true,
			electronAvailable: true,
		};
		expect(Check(InstitutionalContract.methods.getStatus.result, status)).toBe(true);
		expect(Check(InstitutionalContract.methods.getStatus.result, { ...status, secret: "nope" })).toBe(false);
		expect(
			Check(InstitutionalContract.methods.testAccess.result, {
				url: "https://doi.org/10.1038/example",
				status: 200,
				ok: true,
				via: "institutional_session",
			}),
		).toBe(true);
	});
});
