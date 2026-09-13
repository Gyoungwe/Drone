import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerKnowledgeInterface } from "../../../.pi/lib/knowledge/extension.mjs";
import { closeKnowledgeServices } from "../../../.pi/lib/knowledge/service.mjs";
import { createTopicMemory } from "../../../.pi/lib/knowledge/topic-memory.mjs";
import { configureObsidian } from "../../../.pi/lib/obsidian-workbench.mjs";

let root, project, vault, app;
beforeEach(async () => {
	root = await realpath(await mkdtemp(join(tmpdir(), "percho-topic-extension-")));
	project = join(root, "project");
	vault = join(root, "Vault");
	app = join(root, "app");
	await mkdir(project);
	vi.stubEnv("PERCHO_KNOWLEDGE_DIR", app);
	await configureObsidian({ cwd: project, vault, project: "project" });
	await writeFile(join(vault, "Library", "evidence.md"), "# Evidence\nA source for the topic.\n");
});
afterEach(async () => {
	await closeKnowledgeServices();
	vi.unstubAllEnvs();
	await rm(root, { recursive: true, force: true });
});

describe("topic memory extension lifecycle", () => {
	it("registers bounded topic tools and injects selected memory as navigation data", async () => {
		const tools = new Map();
		const events = new Map();
		const pi = {
			registerTool: (tool) => tools.set(tool.name, tool),
			registerCommand: () => {},
			on: (name, fn) => events.set(name, fn),
			getCommands: () => [],
		};
		const api = registerKnowledgeInterface(pi);
		const ctx = { cwd: project, sessionId: "topic-session" };
		await api.beforeStart({ prompt: "topic" }, ctx);
		const binding = JSON.parse(await readFile(join(app, "binding.json"), "utf8"));
		const memory = createTopicMemory({ binding, project: "project" });
		const evidenceHash = createHash("sha256")
			.update(await readFile(join(vault, "Library", "evidence.md")))
			.digest("hex");
		await memory.record({
			topicId: "topic",
			title: "Topic",
			summary: "A compact topic summary",
			sources: [{ path: "Library/evidence.md", hash: evidenceHash }],
			runHash: "b".repeat(64),
		});
		const resumed = await tools
			.get("research_resume_topic")
			.execute("resume", { topic: "topic" }, undefined, undefined, ctx);
		expect(resumed.details.status).toBe("selected");
		const context = await events.get("context")({ messages: [] }, ctx);
		expect(context.messages.some((message) => message.customType === "percho-knowledge-topic-memory")).toBe(
			true,
		);
		expect([...tools.keys()]).toContain("research_topics");
	});
	it("keeps a selected topic across continuation turns and clears it on an explicit switch", async () => {
		const tools = new Map();
		const events = new Map();
		const pi = {
			registerTool: (tool) => tools.set(tool.name, tool),
			registerCommand: () => {},
			on: (name, fn) => events.set(name, fn),
			getCommands: () => [],
		};
		const api = registerKnowledgeInterface(pi);
		const ctx = { cwd: project, sessionId: "continuation" };
		await api.beforeStart({ prompt: "topic" }, ctx);
		const binding = JSON.parse(await readFile(join(app, "binding.json"), "utf8"));
		const memory = createTopicMemory({ binding, project: "project" });
		const hash = createHash("sha256")
			.update(await readFile(join(vault, "Library", "evidence.md")))
			.digest("hex");
		await memory.record({
			topicId: "larva",
			title: "Larva",
			summary: "幼虫发育",
			entities: ["larva"],
			sources: [{ path: "Library/evidence.md", hash }],
			runHash: "a".repeat(64),
		});
		await tools.get("research_resume_topic").execute("resume", { topic: "larva" }, undefined, undefined, ctx);
		await events.get("message_start")({ message: { role: "user", content: "那它的幼虫呢" } }, ctx);
		const packet = await events.get("context")({ messages: [] }, ctx);
		expect(packet.messages.some((m) => m.customType === "percho-knowledge-topic-memory")).toBe(true);
		await events.get("message_start")(
			{ message: { role: "user", content: "switch to a different topic" } },
			ctx,
		);
		const cleared = await events.get("context")({ messages: [] }, ctx);
		expect(cleared.messages.some((m) => m.customType === "percho-knowledge-topic-memory")).toBe(false);
	});
	it("returns bounded candidates for an ambiguous Chinese topic request", async () => {
		const tools = new Map();
		const pi = {
			registerTool: (tool) => tools.set(tool.name, tool),
			registerCommand: () => {},
			on: () => {},
			getCommands: () => [],
		};
		const api = registerKnowledgeInterface(pi);
		const ctx = { cwd: project, sessionId: "ambiguous" };
		await api.beforeStart({ prompt: "topic" }, ctx);
		const binding = JSON.parse(await readFile(join(app, "binding.json"), "utf8"));
		const memory = createTopicMemory({ binding, project: "project" });
		await memory.record({ topicId: "a", title: "幼虫 A", summary: "a" });
		await memory.record({ topicId: "b", title: "幼虫 B", summary: "b" });
		const response = await tools
			.get("research_resume_topic")
			.execute("resume", { topic: "继续那个" }, undefined, undefined, ctx);
		expect(response.details.status).toBe("not-found");
		expect(response.details.candidates.length).toBe(2);
	});
	it("fails closed when the binding revision changes", async () => {
		const tools = new Map();
		const pi = {
			registerTool: (tool) => tools.set(tool.name, tool),
			registerCommand: () => {},
			on: () => {},
			getCommands: () => [],
		};
		const api = registerKnowledgeInterface(pi);
		const ctx = { cwd: project, sessionId: "revoked" };
		await api.beforeStart({ prompt: "topic" }, ctx);
		const path = join(app, "binding.json");
		const binding = JSON.parse(await readFile(path, "utf8"));
		await writeFile(path, JSON.stringify({ ...binding, revision: binding.revision + 1 }));
		await expect(
			tools.get("research_topics").execute("topics", {}, undefined, undefined, ctx),
		).rejects.toThrow(/binding|navigation/i);
	});
	it("omits write tools in read-only mode", async () => {
		const tools = new Map();
		const pi = {
			registerTool: (tool) => tools.set(tool.name, tool),
			registerCommand: () => {},
			on: () => {},
			getCommands: () => [],
		};
		registerKnowledgeInterface(pi, { readOnly: true });
		expect(tools.has("research_update_topic")).toBe(false);
		expect(tools.has("research_archive_topic")).toBe(false);
	});
	it("uses the real sessionManager identity, clears an old topic on beforeStart switch, and blocks revoked trust", async () => {
		const tools = new Map(),
			events = new Map();
		const pi = {
			registerTool: (tool) => tools.set(tool.name, tool),
			registerCommand: () => {},
			on: (name, fn) => events.set(name, fn),
			getCommands: () => [],
		};
		const api = registerKnowledgeInterface(pi);
		let trusted = true;
		const sessionManager = { getSessionId: () => "real-sdk-session" };
		const ctx = { cwd: project, sessionManager, isProjectTrusted: () => trusted };
		await api.beforeStart({ prompt: "larva topic" }, ctx);
		const binding = JSON.parse(await readFile(join(app, "binding.json"), "utf8"));
		const memory = createTopicMemory({ binding, project: "project" });
		await memory.record({ topicId: "larva", title: "Larva", summary: "larval biology" });
		await tools.get("research_resume_topic").execute("resume", { topic: "larva" }, undefined, undefined, ctx);
		let packet = await events.get("context")({ messages: [] }, ctx);
		const topicMessage = packet.messages.find(
			(message) => message.customType === "percho-knowledge-topic-memory",
		);
		expect(topicMessage).toBeDefined();
		expect(topicMessage.content.length).toBeLessThan(2800);

		await api.beforeStart({ prompt: "switch to a different topic about geology" }, ctx);
		packet = await events.get("context")({ messages: [] }, ctx);
		expect(packet.messages.some((message) => message.customType === "percho-knowledge-topic-memory")).toBe(
			false,
		);

		trusted = false;
		await expect(
			tools.get("research_topics").execute("topics", {}, undefined, undefined, ctx),
		).rejects.toThrow(/trust/i);
	});
});
