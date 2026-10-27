import { describe, expect, it, vi } from "vitest";
import {
	createKnowledgeDailyDiscoveryOperations,
	createKnowledgeExperienceOperation,
	createKnowledgePublicationOperation,
	createKnowledgeResearchResourceOperations,
	createKnowledgeReviewWithModelOperation,
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

	it("routes answer publication registration through the installed host", () => {
		const begin = vi.fn(() => ({ accepted: true }));
		const host: KnowledgeHostPort = {
			contractVersion: 1,
			overview: async () => undefined,
			search: async () => undefined,
			read: async () => undefined,
			noteLinks: async () => undefined,
			graph: async () => undefined,
			registerAnswerPublication: (_pi, options) => {
				expect(options.evidenceOnly).toBe(true);
				expect(options.getCurrent()).toEqual({ id: "current" });
				return { begin };
			},
		};
		const register = createKnowledgePublicationOperation(host);

		expect(register({}, { getCurrent: () => ({ id: "current" }), evidenceOnly: true }).begin(true)).toEqual({
			accepted: true,
		});
		expect(begin).toHaveBeenCalledWith(true);
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

	it("routes foreground model review through the installed host", async () => {
		const review = vi.fn(async () => ({ verdict: "needs-human" }));
		const host: KnowledgeHostPort = {
			contractVersion: 1,
			overview: async () => undefined,
			search: async () => undefined,
			read: async () => undefined,
			noteLinks: async () => undefined,
			graph: async () => undefined,
			reviewWikiWithModel: review,
		};
		const operation = createKnowledgeReviewWithModelOperation(host);

		await expect(operation({ token: "preview" }, { signal: undefined })).resolves.toEqual({
			verdict: "needs-human",
		});
		expect(review).toHaveBeenCalledWith({ token: "preview" }, { signal: undefined });
	});

	it("fails closed for research capture when no knowledge plugin is installed", () => {
		const operations = createKnowledgeResearchResourceOperations();
		expect(() => operations.resolveContext({ workspaceRoot: "/workspace" })).toThrow(
			"Knowledge research capture is unavailable: install the knowledge plugin",
		);
		expect(() => operations.ingestSnapshot({} as never)).toThrow(
			"Knowledge research capture is unavailable: install the knowledge plugin",
		);
	});
});
