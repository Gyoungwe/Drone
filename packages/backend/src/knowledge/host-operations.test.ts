import { describe, expect, it } from "vitest";
import { createKnowledgeDailyDiscoveryOperations, type KnowledgeHostPort } from "./ui";

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
				parseIdeas: () => [{ title: "installed", idea: "idea", basis: [], test: "test", whyOverlooked: "why" }],
			},
		};
		const operations = createKnowledgeDailyDiscoveryOperations(host);

		expect(operations.systemPrompt).toBe("installed prompt");
		expect(operations.buildMessage([], [])).toBe("installed message");
		expect(operations.parseIdeas("ignored", [], [])).toEqual([
			{ title: "installed", idea: "idea", basis: [], test: "test", whyOverlooked: "why" },
		]);
	});
});
