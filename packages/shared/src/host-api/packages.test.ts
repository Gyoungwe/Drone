import { Check } from "typebox/value";
import { describe, expect, it } from "vitest";
import { channelOf } from "./define";
import { PackagesContract } from "./packages";
import { UiPluginsContract } from "./ui-plugins";

describe("PackagesContract", () => {
	it("keeps legacy package channels and call shapes", () => {
		expect(channelOf(PackagesContract, "searchCatalog")).toBe("packages:searchCatalog");
		expect(channelOf(PackagesContract, "installPackage")).toBe("packages:installPackage");
		expect(channelOf(PackagesContract, "updatePackage")).toBe("packages:updatePackage");
		expect(channelOf(PackagesContract, "rollbackPackage")).toBe("packages:rollbackPackage");
		expect(Check(PackagesContract.methods.searchCatalog.args, ["agent"])).toBe(true);
		expect(Check(PackagesContract.methods.searchCatalog.args, ["agent", undefined, 2])).toBe(true);
		expect(Check(PackagesContract.methods.searchCatalog.args, ["agent", "extension", 2])).toBe(true);
		expect(Check(PackagesContract.methods.searchCatalog.args, ["agent", "", 1])).toBe(true);
		expect(Check(PackagesContract.methods.searchCatalog.args, ["agent", "invalid"])).toBe(false);
		expect(Check(PackagesContract.methods.installPackage.args, ["@scope/pkg"])).toBe(true);
		expect(Check(PackagesContract.methods.installPackage.args, [""])).toBe(false);
		expect(Check(PackagesContract.methods.updatePackage.args, ["@scope/pkg"])).toBe(true);
		expect(Check(PackagesContract.methods.updatePackage.args, [""])).toBe(false);
		expect(Check(PackagesContract.methods.rollbackPackage.args, ["@scope/pkg", "1.0.0"])).toBe(true);
		expect(Check(PackagesContract.methods.rollbackPackage.args, ["@scope/pkg", ""])).toBe(false);
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

	it("validates structured lifecycle receipts", () => {
		const receipt = {
			operation: "install",
			packageName: "example-extension",
			source: "npm:example-extension",
			scope: "user",
			status: "succeeded",
			effect: "next-session",
			events: [
				{ type: "staged", at: 1 },
				{ type: "verified", at: 2 },
				{ type: "reload_deferred", at: 3, sessionId: "session-1" },
			],
			deferredSessionIds: ["session-1"],
		};
		expect(Check(PackagesContract.methods.installPackage.result, receipt)).toBe(true);
		const config = UiPluginsContract.events.event;
		expect(Check(config, { kind: "config" })).toBe(true);
		expect(Check(config, { kind: "config", reloadUi: false })).toBe(true);
		expect(Check(config, { kind: "config", receipt })).toBe(true);
		expect(Check(config, { kind: "config", receipt: { ...receipt, events: "enabled" } })).toBe(false);
		expect(
			Check(PackagesContract.methods.installPackage.result, {
				...receipt,
				error: { code: "unknown", message: "bad", retryable: false },
			}),
		).toBe(false);
	});

	it("accepts explicit rollback receipts", () => {
		expect(
			Check(PackagesContract.methods.rollbackPackage.result, {
				operation: "rollback",
				packageName: "example-extension",
				source: "npm:example-extension@1.0.0",
				scope: "user",
				status: "succeeded",
				effect: "current-session",
				previousVersion: "1.1.0",
				version: "1.0.0",
				events: [{ type: "rolled_back", at: 1, detail: "1.0.0" }],
			}),
		).toBe(true);
	});
});

import { packageLifecycleForReview } from "../packages";

it("projects bounded scopes and steps without paths, pins, session ids or guest diagnostics", () => {
	const safe = packageLifecycleForReview({
		operation: "update",
		packageName: "@example/package",
		source: "npm:@example/package@private-fixture",
		scope: "project",
		status: "failed",
		effect: "current-session",
		version: "/private/version",
		previousVersion: "1.0.0",
		events: [
			{ type: "staged", at: 1, detail: "/private/log" },
			{ type: "verified", at: 2 },
			{ type: "drained", at: 3, sessionId: "private-session" },
			{ type: "failed", at: 4, detail: "guest-secret" },
			{ type: "rolled_back", at: 5, detail: "1.0.0" },
		],
		error: { code: "operation-failed", retryable: false, message: "guest-secret" },
		deferredSessionIds: ["private-session"],
	});
	expect(safe?.source).toBe("npm:@example/package");
	expect(safe?.scope).toBe("project");
	expect(safe?.events).toEqual(
		["staged", "verified", "drained", "failed", "rolled_back"].map((type, index) => ({
			type,
			at: index + 1,
		})),
	);
	expect(JSON.stringify(safe)).not.toMatch(/private|guest-secret|deferredSessionIds|sessionId|detail/);
});
