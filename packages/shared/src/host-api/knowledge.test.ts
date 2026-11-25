import { Check } from "typebox/value";
import { describe, expect, it } from "vitest";
import { channelOf } from "./define";
import { DailyContract, KnowledgeContract, ZoteroContract } from "./knowledge";

describe("knowledge routing contracts", () => {
	it("keeps one neutral channel per domain group", () => {
		expect(channelOf(KnowledgeContract, "invoke")).toBe("knowledge:invoke");
		expect(channelOf(DailyContract, "invoke")).toBe("daily:invoke");
		expect(channelOf(ZoteroContract, "invoke")).toBe("zotero:invoke");
	});

	it("exposes exactly one routed method per domain", () => {
		expect(Object.keys(KnowledgeContract.methods)).toEqual(["invoke"]);
		expect(Object.keys(DailyContract.methods)).toEqual(["invoke"]);
		expect(Object.keys(ZoteroContract.methods)).toEqual(["invoke"]);
	});

	it("carries the domain on the channel and the operation inside the envelope", () => {
		const args = [{ operation: "overview", input: { cwd: "/tmp" } }];
		expect(Check(KnowledgeContract.methods.invoke.args, args)).toBe(true);
		expect(Check(DailyContract.methods.invoke.args, args)).toBe(true);
		expect(Check(ZoteroContract.methods.invoke.args, args)).toBe(true);
	});

	it("requires a non-empty operation name and rejects unknown envelope fields", () => {
		const args = KnowledgeContract.methods.invoke.args;
		expect(Check(args, [{ operation: "overview" }])).toBe(true);
		expect(Check(args, [{ operation: "" }])).toBe(false);
		expect(Check(args, [{ input: {} }])).toBe(false);
		expect(Check(args, [{ operation: "overview", extra: 1 }])).toBe(false);
		expect(Check(args, [])).toBe(false);
	});

	it("keeps the knowledge event channel for host-side subscribers", () => {
		expect(channelOf(KnowledgeContract, "event")).toBe("knowledge:event");
	});
});
