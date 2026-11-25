import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	handlers: new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>(),
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

import { channelOf, DailyContract, KnowledgeContract, ZoteroContract } from "@drone/shared";
import { registerKnowledgeIpc } from "./knowledge";

const knowledgeChannel = channelOf(KnowledgeContract, "invoke");
const zoteroChannel = channelOf(ZoteroContract, "invoke");

const mainFrame = () => {
	const frame = {};
	return { sender: { mainFrame: frame }, senderFrame: frame };
};

function handlerFor(channel: string) {
	const handler = mocks.handlers.get(channel);
	if (!handler) throw new Error(`Missing IPC handler for ${channel}`);
	return handler;
}

const invoke = (channel: string, route: { operation: string; input?: unknown }) =>
	handlerFor(channel)(mainFrame(), route);

let backend: any;
beforeEach(() => {
	mocks.handlers.clear();
	mocks.from.mockReturnValue(mocks.window);
	mocks.openExternal.mockClear();
	mocks.openPath.mockClear();
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
			specialistSettings: vi.fn(async () => ({ mode: "off", revision: 1 })),
			subscribe: vi.fn(),
		},
		startKnowledgeSetup: vi.fn(),
		resumeKnowledgeCheck: vi.fn(),
	};
	registerKnowledgeIpc(backend);
});

it("binds one neutral channel per domain group", () => {
	expect(mocks.handlers.has(knowledgeChannel)).toBe(true);
	expect(mocks.handlers.has(channelOf(DailyContract, "invoke"))).toBe(true);
	expect(mocks.handlers.has(zoteroChannel)).toBe(true);
});

it("rejects requests from child frames and non-application windows", async () => {
	const frame = {};
	const handler = handlerFor(knowledgeChannel);
	await expect(
		handler({ sender: { mainFrame: frame }, senderFrame: {} }, { operation: "reviews.decide" }),
	).rejects.toThrow("main frame");
	mocks.from.mockReturnValue(null);
	await expect(
		handler({ sender: { mainFrame: frame }, senderFrame: frame }, { operation: "reviews.decide" }),
	).rejects.toThrow("main frame");
	expect(backend.knowledge.decide).not.toHaveBeenCalled();
});

it("rejects an operation name outside the host allowlist", async () => {
	await expect(invoke(knowledgeChannel, { operation: "not.allowed" })).rejects.toThrow(
		"Unknown knowledge operation: not.allowed",
	);
});

it("passes the exact payload of a routed call to its implementation", async () => {
	const input = { cwd: "/fixture", token: "exact-preview", decision: "apply" };
	await invoke(knowledgeChannel, { operation: "reviews.decide", input });
	expect(backend.knowledge.decide).toHaveBeenCalledWith(input);
});

it("opens only backend-resolved knowledge paths", async () => {
	await invoke(knowledgeChannel, {
		operation: "openTarget",
		input: { path: "note.md", revision: 1 },
	});
	expect(mocks.openExternal).toHaveBeenCalledWith("obsidian://open?path=%2Ffixture%2FVault%2Fnote.md");
});

it("returns an unconfigured Zotero Web API status without key material", async () => {
	await expect(invoke(zoteroChannel, { operation: "webApi.get" })).resolves.toEqual({
		configured: false,
		source: null,
		libraryType: "users",
		libraryId: null,
		username: null,
		write: null,
		keyHint: null,
	});
});

it.each(["webApi.save", "webApi.clear"])(
	"redirects retired Zotero credential writes through %s to plugin credentials",
	async (operation) => {
		await expect(invoke(zoteroChannel, { operation })).rejects.toThrow(
			new Error("Zotero Web API keys are now saved under Settings → Plugins → pi-research → credentials"),
		);
	},
);

it("passes explicit specialist settings and both versions to the human host API", async () => {
	const input = { mode: "off", revision: 0, bindingRevision: 1 };
	await invoke(knowledgeChannel, { operation: "specialist.settings", input });
	expect(backend.knowledge.specialistSettings).toHaveBeenCalledWith(input);
});

it("guards and forwards semantic and topic human actions exactly", async () => {
	const input = { cwd: "/fixture", bindingRevision: 4, requestId: "r-1", limit: 8 };
	await invoke(knowledgeChannel, { operation: "semantic.index", input });
	expect(backend.knowledge.indexSemantic).toHaveBeenCalledWith(input);
	const frame = {};
	await expect(
		handlerFor(knowledgeChannel)(
			{ sender: { mainFrame: frame }, senderFrame: {} },
			{ operation: "topics.list", input },
		),
	).rejects.toThrow("main frame");
	const topicInput = { cwd: "/fixture", bindingRevision: 4, id: "topic-1", expectedRevision: 9 };
	await invoke(knowledgeChannel, { operation: "topics.archive", input: topicInput });
	expect(backend.knowledge.archiveTopic).toHaveBeenCalledWith(topicInput);
});

it("binds session-bound actions from BackendServices when provided", async () => {
	const knowledgeSession = {
		startSetup: vi.fn(async () => undefined),
		reviewWithModel: vi.fn(async () => ({ applied: false })),
		cancelModelReview: vi.fn(async () => undefined),
		resumeCheck: vi.fn(async () => undefined),
		disposeSession: vi.fn(),
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
	await invoke(knowledgeChannel, {
		operation: "setup.start",
		input: { sessionId: "s", path: "/fixture/Vault" },
	});
	await invoke(knowledgeChannel, { operation: "reviews.withModel", input: reviewInput });
	await invoke(knowledgeChannel, {
		operation: "reviews.cancelModel",
		input: { sessionId: "s", requestId: "id" },
	});
	await invoke(knowledgeChannel, { operation: "setup.resume", input: "s" });
	expect(knowledgeSession.startSetup).toHaveBeenCalledWith({ sessionId: "s", path: "/fixture/Vault" });
	expect(knowledgeSession.reviewWithModel).toHaveBeenCalledWith(reviewInput);
	expect(knowledgeSession.cancelModelReview).toHaveBeenCalledWith({ sessionId: "s", requestId: "id" });
	expect(knowledgeSession.resumeCheck).toHaveBeenCalledWith("s");
});

it("forwards knowledge events to every open window", () => {
	expect(backend.knowledge.subscribe).toHaveBeenCalled();
	const listener = backend.knowledge.subscribe.mock.calls[0]![0] as (event: unknown) => void;
	listener({ kind: "invalidate" });
	expect(mocks.window.webContents.send).toHaveBeenCalledWith(channelOf(KnowledgeContract, "event"), {
		kind: "invalidate",
	});
});
