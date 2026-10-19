import { RESEARCH_SKILL_SOURCES } from "@drone/shared";
import { describe, expect, it } from "vitest";
import { SessionResourceService } from "../src/services/session-resources";

describe("research skill provenance", () => {
	it("exposes repository/path identity without product-level commit pins", async () => {
		const source = RESEARCH_SKILL_SOURCES.find((entry) => entry.id === "nature");
		if (!source) throw new Error("missing nature source");
		const profile = source.skills.find((skill) => skill.bundled);
		if (!profile) throw new Error("missing bundled nature skill");
		const service = new SessionResourceService({
			options: {},
			registry: {},
			sessionEngine: {},
			capabilityRuntimes: new Map(),
			mcp: {},
			projectLoader: {},
			requireSession: () =>
				({
					session: {
						resourceLoader: {
							getSkills: () => ({
								skills: [
									{
										name: profile.name,
										description: "fixture",
										filePath: `/tmp/research-skills/${profile.path}`,
										sourceInfo: { source: "local", scope: "user" },
										disableModelInvocation: false,
									},
								],
								diagnostics: [],
							}),
							getExtensions: () => ({ extensions: [], errors: [] }),
						},
					},
				}) as never,
			reapplyCapabilities: () => undefined,
			log: { info: () => undefined, warn: () => undefined },
		} as never);

		const resources = await service.getLoadedResources("session");
		expect(resources.skills[0]).toMatchObject({
			repository: `https://github.com/${source.repository}`,
			repositoryPath: profile.path,
		});
		expect(resources.skills[0]).not.toHaveProperty("repositoryCommit");
	});
});
