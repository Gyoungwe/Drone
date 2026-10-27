import { describe, expect, it } from "vitest";
import {
	createKnowledgeDailyDiscoveryOperations,
	createKnowledgeExperienceOperation,
	createKnowledgeResearchResourceOperations,
	type KnowledgeHostPort,
} from "./ui";

describe("knowledge host operations", () => {
	it("routes daily discovery prompt work through the installed host", () => {
		const host: KnowledgeHostPort = {
			contractVersion: 1,
			overview: async () => undefined,
			search: async () => undefined,
			read: async () => undefined,
			noteLinks: async () => undefined,
			graph: async () => undefined,
			dailyDiscovery: {
				systemPrompt: "installed prompt",
				buildMessage: () => "installed message",
				parseIdeas: () => [
					{ title: "installed", idea: "idea", basis: [], test: "test", whyOverlooked: "why" },
				],
			},
		};
		const operations = createKnowledgeDailyDiscoveryOperations(host);

		expect(operations.systemPrompt).toBe("installed prompt");
		expect(operations.buildMessage([], [])).toBe("installed message");
		expect(operations.parseIdeas("ignored", [], [])).toEqual([
			{ title: "installed", idea: "idea", basis: [], test: "test", whyOverlooked: "why" },
		]);
	});

	it("routes research capture and terminal experience through the installed host", async () => {
		const context = { projectId: "project", workspaceId: "workspace" };
		const snapshot = { kind: "knowledge-snapshot", id: "snapshot" } as never;
		const experience = { classification: "new", revision: 1 };
		const host: KnowledgeHostPort = {
			contractVersion: 1,
			overview: async () => undefined,
			search: async () => undefined,
			read: async () => undefined,
			noteLinks: async () => undefined,
			graph: async () => undefined,
			researchResource: {
				resolveContext: () => context,
				ingestSnapshot: () => snapshot,
			},
			recordTerminalJobExperience: async () => experience,
		};
		const research = createKnowledgeResearchResourceOperations(host);
		const recordExperience = createKnowledgeExperienceOperation(host);

		expect(research.resolveContext({ workspaceRoot: "/workspace" })).toBe(context);
		expect(research.ingestSnapshot({} as never)).toBe(snapshot);
		expect(await recordExperience({} as never, {} as never)).toBe(experience);
	});
});
