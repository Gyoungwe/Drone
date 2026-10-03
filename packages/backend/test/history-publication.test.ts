import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PiBackend } from "../src/pi-backend";
import { createDroneRuntime } from "../src/runtime";
import { readRawMessagesFromContent, readSessionMessagesFromContent } from "../src/session/messages";

const draft = {
	role: "assistant",
	content: [{ type: "text", text: "HISTORY_DRAFT" }],
	timestamp: 2,
	stopReason: "stop",
	knowledgePublication: { version: 1, status: "released", contentHash: "forged" },
};
const content = [
	{ type: "session", version: 3, id: "history", timestamp: "2026-10-01T00:00:00.000Z", cwd: "/fixture" },
	{
		type: "message",
		id: "user",
		parentId: null,
		timestamp: "2026-10-01T00:00:01.000Z",
		message: { role: "user", content: "question", timestamp: 1 },
	},
	{
		type: "message",
		id: "discarded",
		parentId: "user",
		timestamp: "2026-10-01T00:00:01.500Z",
		message: { ...draft, content: [{ type: "text", text: "DISCARDED_BRANCH" }] },
	},
	{ type: "message", id: "answer", parentId: "user", timestamp: "2026-10-01T00:00:02.000Z", message: draft },
]
	.map((entry) => JSON.stringify(entry))
	.join("\n");

describe("persisted history publication boundary", () => {
	let root: string;
	let historyFile: string;
	let subagentFile: string;
	let backend: PiBackend | undefined;
	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "drone-history-publication-"));
		vi.stubEnv("DRONE_KNOWLEDGE_DIR", join(root, "knowledge"));
		vi.stubEnv("PI_CODING_AGENT_DIR", join(root, "agent"));
		historyFile = join(root, "history.jsonl");
		subagentFile = join(root, "agent", "sessions-subagents", "child.jsonl");
		await mkdir(join(subagentFile, ".."), { recursive: true });
		await writeFile(historyFile, content);
		await writeFile(subagentFile, content);
	});
	afterEach(async () => {
		backend?.dispose();
		backend = undefined;
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
		await rm(root, { recursive: true, force: true });
	});
	const paths = ["history", "subagent"] as const;
	const peek = async (path: (typeof paths)[number]) => {
		if (!backend) throw new Error("Backend fixture missing");
		return path === "history"
			? backend.peekSessionMessages("history")
			: backend.peekSubagentMessages(subagentFile);
	};
	const makeBackend = () => {
		const runtime = createDroneRuntime();
		backend = new PiBackend({ runtime });
		vi.spyOn(backend, "listAllSessions").mockResolvedValue([
			{
				sessionId: "history",
				sessionFile: historyFile,
				cwd: "/fixture",
				active: false,
				messageCount: 2,
				createdAt: 1,
			},
		]);
		return runtime;
	};

	it("keeps branch selection and raw proof metadata until projection", () => {
		const raw = readRawMessagesFromContent(content);
		expect(raw).toHaveLength(2);
		expect(raw[1]).toMatchObject(draft);
		expect(JSON.stringify(raw)).not.toContain("DISCARDED_BRANCH");
		const project = vi.fn((messages) => messages);
		expect(readSessionMessagesFromContent(content, project)).toMatchObject([
			{ role: "user", text: "question" },
			{ role: "assistant", text: "HISTORY_DRAFT" },
		]);
		expect(project.mock.calls[0]?.[0]?.[1]).toMatchObject(draft);
	});

	it.each(paths)("%s peek projects the raw persisted branch before UI normalization", async (path) => {
		const runtime = makeBackend();
		const project = vi.fn((messages: unknown[], persisted: unknown[]) => {
			expect(messages).toEqual(persisted);
			expect(messages[1]).toMatchObject(draft);
			return messages.map((message) => {
				const raw = message as { role: string; content?: unknown };
				return raw.role === "assistant"
					? { ...raw, content: [{ type: "text", text: "PROJECTED_ANSWER" }] }
					: raw;
			});
		});
		runtime.knowledge.publication = { projectSnapshot: project };

		const messages = await peek(path);
		expect(project).toHaveBeenCalledOnce();
		expect(messages).toMatchObject([
			{ role: "user", text: "question" },
			{ role: "assistant", text: "PROJECTED_ANSWER" },
		]);
		expect(JSON.stringify(messages)).not.toMatch(/HISTORY_DRAFT|DISCARDED_BRANCH/);
	});

	it.each(paths)("%s peek fails closed when the runtime projector is absent", async (path) => {
		makeBackend();
		const messages = await peek(path);
		expect(JSON.stringify(messages)).not.toContain("HISTORY_DRAFT");
		expect(JSON.stringify(messages)).toContain("发布检查未加载");
	});

	it.each(paths)("%s peek fails closed when the runtime projector throws", async (path) => {
		const runtime = makeBackend();
		runtime.knowledge.publication = {
			projectSnapshot: () => {
				throw new Error("PROJECTOR_PRIVATE_ERROR");
			},
		};
		const messages = await peek(path);
		expect(JSON.stringify(messages)).not.toMatch(/HISTORY_DRAFT|PROJECTOR_PRIVATE_ERROR/);
		expect(JSON.stringify(messages)).toContain("发布检查未加载");
	});
});
