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

	it("reports duplicate tools with both package sources and keeps the first registration", async () => {
		const extensions = [
			{
				path: "/tmp/first-package/dist/index.mjs",
				sourceInfo: { source: "@example/first-package", scope: "user" },
				tools: new Map([["shared_status", {}]]),
				commands: new Map(),
				flags: new Map(),
				shortcuts: new Map(),
				hidden: false,
			},
			{
				path: "/tmp/second-package/dist/index.mjs",
				sourceInfo: { source: "@example/second-package", scope: "user" },
				tools: new Map([["shared_status", {}]]),
				commands: new Map(),
				flags: new Map(),
				shortcuts: new Map(),
				hidden: false,
			},
		];
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
							getSkills: () => ({ skills: [], diagnostics: [] }),
							getExtensions: () => ({ extensions, errors: [] }),
						},
					},
				}) as never,
			reapplyCapabilities: () => undefined,
			log: { info: () => undefined, warn: () => undefined },
		} as never);

		const resources = await service.getLoadedResources("session");
		expect(resources.extensions.map((extension) => extension.source)).toEqual([
			"@example/first-package",
			"@example/second-package",
		]);
		expect(resources.skillDiagnostics).toContainEqual({
			type: "collision",
			message:
				'Tool "shared_status" is declared by @example/first-package and @example/second-package; keeping the first registration.',
			path: "/tmp/second-package/dist/index.mjs",
		});
	});
});
