import { Check } from "typebox/value";
import { describe, expect, it } from "vitest";
import { AppContract } from "./app";
import { channelOf } from "./define";

describe("AppContract", () => {
	it("keeps stable app channels and validates metadata", () => {
		expect(channelOf(AppContract, "getInfo")).toBe("app:getInfo");
		expect(channelOf(AppContract, "getDiagnostics")).toBe("app:getDiagnostics");
		expect(channelOf(AppContract, "getDailyDir")).toBe("app:getDailyDir");
		expect(Check(AppContract.methods.getInfo.args, [])).toBe(true);
		expect(Check(AppContract.methods.getInfo.args, ["unexpected"])).toBe(false);
		expect(
			Check(AppContract.methods.getInfo.result, {
				name: "Drone",
				version: "1.0.0",
				electron: "1",
				chrome: "1",
				node: "1",
				platform: "darwin",
				arch: "arm64",
				repoUrl: "https://github.com/Gyoungwe/Drone",
			}),
		).toBe(true);
	});
});
