import { Check } from "typebox/value";
import { describe, expect, it } from "vitest";
import { channelOf } from "./define";
import { PackagesContract } from "./packages";

describe("PackagesContract", () => {
	it("keeps legacy package channels and call shapes", () => {
		expect(channelOf(PackagesContract, "searchCatalog")).toBe("packages:searchCatalog");
		expect(channelOf(PackagesContract, "installPackage")).toBe("packages:installPackage");
		expect(Check(PackagesContract.methods.searchCatalog.args, ["agent"])).toBe(true);
		expect(Check(PackagesContract.methods.searchCatalog.args, ["agent", undefined, 2])).toBe(true);
		expect(Check(PackagesContract.methods.searchCatalog.args, ["agent", "extension", 2])).toBe(true);
		expect(Check(PackagesContract.methods.searchCatalog.args, ["agent", "", 1])).toBe(true);
		expect(Check(PackagesContract.methods.searchCatalog.args, ["agent", "invalid"])).toBe(false);
		expect(Check(PackagesContract.methods.installPackage.args, ["@scope/pkg"])).toBe(true);
		expect(Check(PackagesContract.methods.installPackage.args, [""])).toBe(false);
		expect(Check(PackagesContract.methods.removePackage.args, ["npm:pkg", "user"])).toBe(true);
		expect(Check(PackagesContract.methods.removePackage.args, ["npm:pkg", "workspace"])).toBe(false);
		expect(Check(PackagesContract.methods.listConfiguredPackages.args, [])).toBe(true);
	});

	it("validates catalog results without exposing extra fields", () => {
		expect(
			Check(PackagesContract.methods.searchCatalog.result, {
				packages: [
					{
						name: "example",
						description: "Example",
						author: "Drone",
						types: ["extension"],
						downloads: 10,
						updatedAt: 1_700_000_000_000,
						installSource: "npm:example",
					},
				],
				total: 1,
				page: 1,
				pageSize: 50,
			}),
		).toBe(true);
		expect(
			Check(PackagesContract.methods.searchCatalog.result, {
				packages: [],
				total: 0,
				page: 1,
				pageSize: 50,
				extra: true,
			}),
		).toBe(false);
	});
});
