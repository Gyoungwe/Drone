import { Check } from "typebox/value";
import { describe, expect, it } from "vitest";
import { channelOf } from "./define";
import { KnowledgeContract } from "./knowledge";

describe("KnowledgeContract", () => {
	it("exposes stable domain channels for every knowledge action", () => {
		expect(channelOf(KnowledgeContract, "getOverview")).toBe("knowledge:getOverview");
		expect(channelOf(KnowledgeContract, "getResearchRuns")).toBe("knowledge:getResearchRuns");
		expect(channelOf(KnowledgeContract, "reviewWithModel")).toBe("knowledge:reviewWithModel");
		expect(channelOf(KnowledgeContract, "getZoteroStatus")).toBe("knowledge:getZoteroStatus");
		expect(channelOf(KnowledgeContract, "authorizeZoteroLocalWrite")).toBe(
			"knowledge:authorizeZoteroLocalWrite",
		);
		expect(Object.keys(KnowledgeContract.methods)).toHaveLength(36);
	});

	it("keeps optional reads optional while requiring object payloads for mutations", () => {
		expect(Check(KnowledgeContract.methods.getOverview.args, [])).toBe(true);
		expect(Check(KnowledgeContract.methods.getOverview.args, [{ cwd: null, sessionId: "s" }])).toBe(true);
		expect(Check(KnowledgeContract.methods.startSetup.args, [{ sessionId: "s" }])).toBe(true);
		expect(Check(KnowledgeContract.methods.startSetup.args, [])).toBe(false);
		expect(Check(KnowledgeContract.methods.startSetup.args, ["s"])).toBe(false);
		expect(Check(KnowledgeContract.methods.resumeCheck.args, ["s"])).toBe(true);
		expect(Check(KnowledgeContract.methods.resumeCheck.args, [])).toBe(false);
	});
});
