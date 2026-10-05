import { Check } from "typebox/value";
import { describe, expect, it } from "vitest";
import { InquiryContract } from "./inquiry";

describe("InquiryContract", () => {
	it("validates artifact ids and returns the structured error shape", () => {
		expect(Check(InquiryContract.methods.artifactProvenance.args, ["run:1:report.tsv"])).toBe(true);
		expect(Check(InquiryContract.methods.artifactProvenance.args, ["\u0000bad"])).toBe(false);
		expect(
			Check(InquiryContract.methods.artifactProvenance.result, {
				code: "artifact_not_found",
				severity: "error",
				source: "app",
				titleKey: "error.title.inquiry",
				detail: "missing",
				actions: ["copyDetail"],
				timestamp: Date.now(),
			}),
		).toBe(true);
	});
});
