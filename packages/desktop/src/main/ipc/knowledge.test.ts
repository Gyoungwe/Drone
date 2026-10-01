import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	handlers: new Map<string, (event: any, input: any) => any>(),
	window: { isDestroyed: () => false, webContents: { send: vi.fn() } },
	openPath: vi.fn(async () => ""),
	openExternal: vi.fn(async () => {}),
	from: vi.fn(),
}));
vi.mock("electron", () => ({
	ipcMain: { handle: (name: string, fn: any) => mocks.handlers.set(name, fn) },
	BrowserWindow: { fromWebContents: mocks.from, getAllWindows: () => [mocks.window] },
	shell: { openPath: mocks.openPath, openExternal: mocks.openExternal },
}));

import { IpcChannels } from "@drone/shared";
import { registerKnowledgeIpc } from "./knowledge";

const channel = (key: string, fallback: string) =>
	(IpcChannels as unknown as Record<string, string>)[key] || fallback;

let backend: any;
beforeEach(() => {
	mocks.handlers.clear();
	mocks.from.mockReturnValue(mocks.window);
	backend = {
		knowledge: {
			overview: vi.fn(async () => ({ bound: false })),
			setupPreview: vi.fn(),
			jobs: vi.fn(),
			reviews: vi.fn(),
			preview: vi.fn(),
			decide: vi.fn(),
			read: vi.fn(),
			maintain: vi.fn(),
			openTarget: vi.fn(async () => ({ kind: "note", path: "/fixture/Vault/note.md" })),
			semanticStatus: vi.fn(async () => ({ settings: {}, index: {} })),
			saveSemanticSettings: vi.fn(async (input: unknown) => input),
			testSemanticProvider: vi.fn(async () => ({ ok: true })),
			indexSemantic: vi.fn(async () => ({ enabled: true })),
			cancelSemanticIndex: vi.fn(async () => {}),
			topics: vi.fn(async () => ({ revision: 1, topics: [] })),
			archiveTopic: vi.fn(async () => ({ status: "archived" })),
			subscribe: vi.fn(),
		},
		startKnowledgeSetup: vi.fn(),
		resumeKnowledgeCheck: vi.fn(),
	};
	registerKnowledgeIpc(backend);
});
it("rejects requests from child frames and non-application windows", async () => {
	const frame = {};
	const handler = mocks.handlers.get(IpcChannels.KnowledgeReviewDecide)!;
	await expect(handler({ sender: { mainFrame: frame }, senderFrame: {} }, { token: "x" })).rejects.toThrow(
		"main frame",
	);
	mocks.from.mockReturnValue(null);
	await expect(handler({ sender: { mainFrame: frame }, senderFrame: frame }, { token: "x" })).rejects.toThrow(
		"main frame",
	);
	expect(backend.knowledge.decide).not.toHaveBeenCalled();
});
it("passes the exact preview capability to the host API", async () => {
	const frame = {},
		input = { cwd: "/fixture", token: "exact-preview", decision: "apply" };
	await mocks.handlers.get(IpcChannels.KnowledgeReviewDecide)?.(
		{ sender: { mainFrame: frame }, senderFrame: frame },
		input,
	);
	expect(backend.knowledge.decide).toHaveBeenCalledWith(input);
});
it("opens only backend-resolved knowledge paths", async () => {
	const frame = {};
	await mocks.handlers.get(IpcChannels.KnowledgeOpen)?.(
		{ sender: { mainFrame: frame }, senderFrame: frame },
		{ path: "note.md", revision: 1 },
	);
	expect(mocks.openExternal).toHaveBeenCalledWith("obsidian://open?path=%2Ffixture%2FVault%2Fnote.md");
});

it("specialist mode writes require the same main-frame restriction as approvals", async () => {
	const frame = {};
	const handler = mocks.handlers.get(IpcChannels.KnowledgeSpecialistsSettings)!;
	await expect(
		handler(
			{ sender: { mainFrame: frame }, senderFrame: {} },
			{ mode: "automatic", revision: 0, bindingRevision: 1 },
		),
	).rejects.toThrow("main frame");
});
it("passes explicit specialist settings and both versions to the human host API", async () => {
	backend.knowledge.specialistSettings = vi.fn(async () => ({ mode: "off", revision: 1 }));
	const frame = {},
		input = { mode: "off", revision: 0, bindingRevision: 1 };
	await mocks.handlers.get(IpcChannels.KnowledgeSpecialistsSettings)?.(
		{ sender: { mainFrame: frame }, senderFrame: frame },
		input,
	);
	expect(backend.knowledge.specialistSettings).toHaveBeenCalledWith(input);
});

it("model review and cancellation remain restricted to the application main frame", async () => {
	const frame = {};
	for (const name of [IpcChannels.KnowledgeReviewModel, IpcChannels.KnowledgeReviewModelCancel])
		await expect(
			mocks.handlers.get(name)?.({ sender: { mainFrame: frame }, senderFrame: {} }, {}),
		).rejects.toThrow("main frame");
});

it("guards and forwards semantic and topic human actions exactly", async () => {
	const frame = {};
	const input = { cwd: "/fixture", bindingRevision: 4, requestId: "r-1", limit: 8 };
	await mocks.handlers.get(channel("KnowledgeSemanticIndex", "knowledge:semanticIndex"))?.(
		{ sender: { mainFrame: frame }, senderFrame: frame },
		input,
	);
	expect(backend.knowledge.indexSemantic).toHaveBeenCalledWith(input);
	await expect(
		mocks.handlers.get(channel("KnowledgeTopics", "knowledge:topics"))?.(
			{ sender: { mainFrame: frame }, senderFrame: {} },
			input,
		),
	).rejects.toThrow("main frame");
	const topicInput = { cwd: "/fixture", bindingRevision: 4, id: "topic-1", expectedRevision: 9 };
	await mocks.handlers.get(channel("KnowledgeTopicArchive", "knowledge:topicArchive"))?.(
		{ sender: { mainFrame: frame }, senderFrame: frame },
		topicInput,
	);
	expect(backend.knowledge.archiveTopic).toHaveBeenCalledWith(topicInput);
});
it("forwards explicit one-shot model review choices, never granting a model tool approval", async () => {
	backend.reviewKnowledgeWithModel = vi.fn(async () => ({ applied: false }));
	const frame = {},
		input = {
			cwd: "/fixture",
			token: "exact",
			sessionId: "s",
			requestId: "id",
			acknowledged: true,
			autoApply: false,
		};
	await mocks.handlers.get(IpcChannels.KnowledgeReviewModel)?.(
		{ sender: { mainFrame: frame }, senderFrame: frame },
		input,
	);
	expect(backend.reviewKnowledgeWithModel).toHaveBeenCalledWith(input);
});

it("binds session-bound actions from BackendServices when provided", async () => {
	const frame = {};
	const knowledgeSession = {
		startSetup: vi.fn(async () => undefined),
		reviewWithModel: vi.fn(async () => ({ applied: false })),
		cancelModelReview: vi.fn(async () => undefined),
		resumeCheck: vi.fn(async () => undefined),
	};
	registerKnowledgeIpc({
		sessions: backend,
		knowledge: backend.knowledge,
		knowledgeSession,
		zotero: { getStatus: vi.fn() },
	} as any);
	const reviewInput = {
		cwd: "/fixture",
		token: "exact",
		sessionId: "s",
		requestId: "id",
		acknowledged: true,
		autoApply: false,
	};
	await mocks.handlers.get(IpcChannels.KnowledgeSetupStart)?.(
		{ sender: { mainFrame: frame }, senderFrame: frame },
		{ sessionId: "s", path: "/fixture/Vault" },
	);
	await mocks.handlers.get(IpcChannels.KnowledgeReviewModel)?.(
		{ sender: { mainFrame: frame }, senderFrame: frame },
		reviewInput,
	);
	await mocks.handlers.get(IpcChannels.KnowledgeReviewModelCancel)?.(
		{ sender: { mainFrame: frame }, senderFrame: frame },
		{ sessionId: "s", requestId: "id" },
	);
	await mocks.handlers.get(IpcChannels.KnowledgeResume)?.(
		{ sender: { mainFrame: frame }, senderFrame: frame },
		"s",
	);
	expect(knowledgeSession.startSetup).toHaveBeenCalledWith({ sessionId: "s", path: "/fixture/Vault" });
	expect(knowledgeSession.reviewWithModel).toHaveBeenCalledWith(reviewInput);
	expect(knowledgeSession.cancelModelReview).toHaveBeenCalledWith({ sessionId: "s", requestId: "id" });
	expect(knowledgeSession.resumeCheck).toHaveBeenCalledWith("s");
});
