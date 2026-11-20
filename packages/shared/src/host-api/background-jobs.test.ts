import { Check } from "typebox/value";
import { describe, expect, it } from "vitest";
import { BackgroundJobsContract } from "./background-jobs";
import { channelOf } from "./define";

describe("BackgroundJobsContract", () => {
	it.each([
		["getBackgroundJobsStatus", "backgroundJobs:getBackgroundJobsStatus", ["/workspace"], [false]],
		[
			"setBackgroundJobsEnabled",
			"backgroundJobs:setBackgroundJobsEnabled",
			["/workspace", true],
			["/workspace", "true"],
		],
		[
			"setBackgroundJobsDailyLimit",
			"backgroundJobs:setBackgroundJobsDailyLimit",
			["/workspace", 1],
			["/workspace", 0],
		],
	] as const)(
		"binds %s to %s with validated desktop arguments",
		(method, channel, validArgs, invalidArgs) => {
			const { access, args } = BackgroundJobsContract.methods[method];
			expect(channelOf(BackgroundJobsContract, method)).toBe(channel);
			expect(access).toBe("desktop");
			expect(Check(args, validArgs)).toBe(true);
			expect(Check(args, invalidArgs)).toBe(false);
		},
	);

	it("rejects fractional daily limits", () => {
		expect(Check(BackgroundJobsContract.methods.setBackgroundJobsDailyLimit.args, ["/workspace", 1.5])).toBe(
			false,
		);
	});
});
