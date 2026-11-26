import { Check } from "typebox/value";
import { describe, expect, it } from "vitest";
import { AppContract } from "./app";
import { channelOf } from "./define";

describe("AppContract", () => {
	it("accepts omitted resource context while retaining argument types", () => {
		for (const method of [AppContract.methods.filePreview, AppContract.methods.resourceOpenExternal]) {
			expect(Check(method.args, ["/papers/source.pdf", undefined])).toBe(true);
			expect(Check(method.args, ["/papers/source.pdf", undefined, undefined])).toBe(true);
			expect(Check(method.args, ["/papers/source.pdf", "/papers", true])).toBe(true);
			expect(Check(method.args, ["/papers/source.pdf", 123])).toBe(false);
		}
	});

	it("keeps stable app channels and validates metadata", () => {
		expect(channelOf(AppContract, "getInfo")).toBe("app:getInfo");
		expect(channelOf(AppContract, "getDiagnostics")).toBe("app:getDiagnostics");
		expect(channelOf(AppContract, "getDailyDir")).toBe("app:getDailyDir");
		expect(Check(AppContract.methods.checkResearchSkills.args, [])).toBe(true);
		expect(Check(AppContract.methods.getInfo.args, [])).toBe(true);
		expect(Check(AppContract.methods.getInfo.args, ["unexpected"])).toBe(false);
		expect(channelOf(AppContract, "addSkillRepository")).toBe("app:addSkillRepository");
		expect(
			Check(AppContract.methods.addSkillRepository.args, [
				{ kind: "local", source: "/tmp/skills", license: "MIT" },
			]),
		).toBe(true);
		expect(
			Check(AppContract.methods.addSkillRepository.args, [{ kind: "local", source: "", license: "MIT" }]),
		).toBe(false);
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

	it("declares the app events and retains the five domain channels", () => {
		expect(Object.keys(AppContract.events)).toEqual([
			"updateEvent",
			"researchSkillUpdateEvent",
			"desktopCommand",
		]);
		expect(channelOf(AppContract, "formalKnowledgeVault")).toBe("knowledge:formalVault");
		expect(channelOf(AppContract, "checkResearchSkills")).toBe("researchSkills:check");
		expect(channelOf(AppContract, "updateResearchSkills")).toBe("researchSkills:update");
		expect(channelOf(AppContract, "restartForResearchSkills")).toBe("researchSkills:restart");
		expect(channelOf(AppContract, "researchSkillUpdateEvent")).toBe("researchSkills:updateEvent");
	});
});
