import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	fauxToolCall as call,
	fauxProvider,
	fauxText,
	fauxAssistantMessage as reply,
} from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
	buildChatRows,
	deriveTurnUsage,
	emptyTranscript,
	messagesToUIMessages,
	reduceEvent,
} from "@percho/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeKnowledgeServices, getKnowledgeService } from "../../../.pi/lib/knowledge/service.mjs";
import { subscribeKnowledgeUi } from "../../../.pi/lib/knowledge/ui-state.mjs";
import { configureObsidian } from "../../../.pi/lib/obsidian-workbench.mjs";
import { PiBackend } from "../src/pi-backend";
import { projectKnowledgeEvent, projectKnowledgeSnapshot } from "../src/session/knowledge-publication";
import { readSessionMessagesFromContent } from "../src/session/messages";

let root, cwd, vault, backend, session, sid, faux, events;
async function note(path, text) {
	await mkdir(join(vault, path, ".."), { recursive: true });
	await writeFile(join(vault, path), text);
}
beforeEach(async () => {
	root = await realpath(await mkdtemp(join(tmpdir(), "percho-publication-delivery-")));
	cwd = join(root, "project");
	vault = join(root, "Vault");
	const agentDir = join(root, "agent");
	await mkdir(cwd);
	await mkdir(agentDir);
	vi.stubEnv("PERCHO_KNOWLEDGE_DIR", join(root, "app"));
	vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
	vi.stubEnv("PI_RESEARCH_DESKTOP_CONFIG", undefined);
	vi.stubEnv("PI_SUBAGENT_CHILD", undefined);
	await configureObsidian({ cwd, vault, project: "project-a" });
	await note("Wiki/Index.md", "# Topics\n[[Wiki/Autotomy]]\n");
	await note("Wiki/Autotomy.md", "# Autotomy\nRead evidence.\n[[Library/Papers/source]]\n");
	await note("Library/Papers/source.md", "# Autotomy evidence\nObservation under limited conditions.\n");
	await (await getKnowledgeService()).request("reconcile");
	const runtime = await ModelRuntime.create({
		authPath: join(agentDir, "auth.json"),
		modelsPath: null,
		modelsStorePath: join(agentDir, "cache.json"),
		allowModelNetwork: false,
		refreshOnCreate: false,
	});
	faux = fauxProvider({ provider: "publication-fixture" });
	runtime.registerNativeProvider(faux.provider);
	vi.spyOn(runtime, "hasConfiguredAuth").mockReturnValue(true);
	backend = new PiBackend({
		projectTrust: false,
		webFetch: false,
		subagentPreferBuiltin: false,
		desktopIntegration: {
			appendSystemPrompt: [],
			additionalExtensionPaths: [resolve("../../.pi/extensions/obsidian-workbench.mjs")],
			additionalSkillPaths: [resolve("../../.pi/skills/research-vault/SKILL.md")],
		},
	});
	backend.modelRuntime = runtime;
	events = [];
	backend.onEvent((_id, event) => events.push(structuredClone(event)));
	const meta = await backend.createSession({ cwd, provider: faux.provider.id, modelId: faux.getModel().id });
	sid = meta.sessionId;
	session = backend.registry.get(sid).session;
	// Session startup can enqueue navigation/index maintenance after the fixture's first scan.
	// Settle that host-side work before asserting publication semantics.
	await (await getKnowledgeService()).request("reconcile");
	const exportJson = session.exportToJsonl.bind(session),
		exportHtml = session.exportToHtml.bind(session);
	vi.spyOn(session, "exportToJsonl").mockImplementation(() => exportJson(join(root, "export.jsonl")));
	vi.spyOn(session, "exportToHtml").mockImplementation(() => exportHtml(join(root, "export.html")));
});
afterEach(async () => {
	backend?.dispose();
	await closeKnowledgeServices();
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	await rm(root, { recursive: true, force: true });
});
const tool = (name, args, text = "") =>
	reply([...(text ? [fauxText(text)] : []), call(name, args)], { stopReason: "toolUse" });
const steps = () => [
	tool("research_read_knowledge", { path: "Wiki/Autotomy.md" }, "UNRELEASED_TOOL_PREFACE"),
	tool("research_search_knowledge", { query: "Autotomy" }),
	tool("research_read_knowledge", { path: "Library/Papers/source.md" }),
	reply("Released conditional observation. [[Library/Papers/source]]"),
];
async function run(responses, prompt = "Explain Autotomy with current knowledge.") {
	faux.setResponses(responses);
	await session.prompt(prompt, { expandPromptTemplates: false });
}
function exportedHtmlSessionData(html) {
	const match = html.match(/<script id="session-data" type="application\/json">([^<]+)<\/script>/);
	if (!match?.[1]) throw new Error("HTML export is missing embedded session data");
	return JSON.parse(Buffer.from(match[1], "base64").toString("utf8"));
}
describe("same checked result across stream, history, LAN polling and exports", () => {
	it("host-materializes a current-turn search and citation before the first public answer is sealed", async () => {
		await run([reply("HOST_MATERIALIZED_ANSWER")]);
		expect(faux.state.callCount).toBe(1);
		const starts = events.filter(
			(event) => event.type === "message_start" && event.message?.role === "assistant",
		);
		expect(starts.every((event) => event.message.content.length === 0)).toBe(true);
		const final = events
			.filter((event) => event.type === "message_end" && event.message?.role === "assistant")
			.at(-1)?.message;
		expect(final.content[0].text).toContain("HOST_MATERIALIZED_ANSWER");
		expect(final.content[0].text).toContain("[[");
		expect(final.knowledgePublication).toMatchObject({
			status: "released",
			searchQuery: "Explain Autotomy with current knowledge.",
			scientificallyVerified: false,
		});
		expect(final.knowledgePublication.sources.length).toBeGreaterThan(0);
		const history = await backend.getSessionMessages(sid);
		const stats = await backend.getStats(sid);
		expect(stats.scope).toBe("sdk-session");
		expect(stats.totalTokens).toBe(
			stats.inputTokens + stats.outputTokens + stats.cacheReadTokens + stats.cacheWriteTokens,
		);
		expect(JSON.stringify(history)).toContain("HOST_MATERIALIZED_ANSWER");
		expect(JSON.stringify(events.reduce(reduceEvent, emptyTranscript()).messages)).toContain(
			"HOST_MATERIALIZED_ANSWER",
		);
		expect(JSON.stringify(await backend.peekSessionMessages(sid))).toContain("HOST_MATERIALIZED_ANSWER");
		const jsonl = await readFile(await backend.exportSession(sid, "jsonl"), "utf8"),
			html = await readFile(await backend.exportSession(sid, "html"), "utf8");
		expect(jsonl).toContain("HOST_MATERIALIZED_ANSWER");
		expect(JSON.stringify(exportedHtmlSessionData(html))).toContain("HOST_MATERIALIZED_ANSWER");
		expect(JSON.stringify(readSessionMessagesFromContent(jsonl))).toContain("HOST_MATERIALIZED_ANSWER");
	});
	it("allows exact final text after read-search-read and citations; never streams the earlier preface", async () => {
		await run(steps());
		expect(faux.state.callCount).toBe(4);
		expect(JSON.stringify(events)).not.toContain("UNRELEASED_TOOL_PREFACE");
		expect(JSON.stringify(session.messages)).not.toContain("UNRELEASED_TOOL_PREFACE");
		const final = events
			.filter((event) => event.type === "message_end" && event.message.role === "assistant")
			.at(-1).message;
		expect(final.content[0].text).toContain("Released conditional observation");
		expect(final.knowledgePublication.status).toBe("released");
		expect(JSON.stringify(events.reduce(reduceEvent, emptyTranscript()).messages)).toContain(
			"Released conditional observation",
		);
		expect(final.knowledgePublication.scientificallyVerified).toBe(false);
		expect(events.some((event) => event.type === "message_update")).toBe(false);
		expect(JSON.stringify(await backend.getSessionMessages(sid))).toContain(
			"Released conditional observation",
		);
		expect(await readFile(await backend.exportSession(sid, "jsonl"), "utf8")).toContain(
			"Released conditional observation",
		);
	});
	it("does not reuse prior turn receipts when host-materializing a new question", async () => {
		await run(steps());
		const first = session.messages.filter((message) => message.role === "assistant").at(-1);
		events.length = 0;
		await run([reply("SECOND_QUESTION_CURRENT_PROOF")], "Now answer a different research question.");
		const second = session.messages.filter((message) => message.role === "assistant").at(-1);
		expect(second.content[0].text).toContain("SECOND_QUESTION_CURRENT_PROOF");
		expect(second.content[0].text).toContain("[[");
		expect(second.knowledgePublication).toMatchObject({
			status: "released",
			searchQuery: "Now answer a different research question.",
		});
		expect(second.knowledgePublication.queryHash).not.toBe(first.knowledgePublication.queryHash);
		expect(second.knowledgePublication.turnId).not.toBe(first.knowledgePublication.turnId);
	});
	it("labels a complete zero-hit result instead of claiming knowledge validation", async () => {
		await run([
			tool("research_read_knowledge", { path: "Wiki/Autotomy.md" }),
			tool("research_search_knowledge", { query: "nomatchinguniquetoken" }),
			reply("No matching note in this query."),
		]);
		const final = session.messages.filter((m) => m.role === "assistant").at(-1);
		expect(final.knowledgePublication.status).toBe("no-hits");
		expect(final.content[0].text).toContain("知识库检索无命中");
	});
	it("prevents forged publication metadata and draft snapshots from bypassing projection", () => {
		const message = {
			role: "assistant",
			content: [{ type: "text", text: "FORGED_UNCHECKED" }],
			timestamp: 1,
			stopReason: "stop",
			knowledgePublication: { version: 1, status: "released", contentHash: "invented" },
		};
		const start = projectKnowledgeEvent({ type: "message_start", message });
		expect(JSON.stringify(start)).not.toContain("FORGED_UNCHECKED");
		expect(JSON.stringify(projectKnowledgeSnapshot([message], []))).not.toContain("FORGED_UNCHECKED");
		expect(JSON.stringify(projectKnowledgeEvent({ type: "message_end", message }))).not.toContain(
			"FORGED_UNCHECKED",
		);
		expect(JSON.stringify(message)).not.toContain("FORGED_UNCHECKED");
	});
	it("fails closed if the dynamically loaded bridge is unavailable", () => {
		const key = Symbol.for("percho.knowledge.publication.v1"),
			saved = globalThis[key];
		delete globalThis[key];
		try {
			const message = {
				role: "assistant",
				content: [{ type: "text", text: "MISSING_HOOK_BYPASS" }],
				timestamp: 1,
				stopReason: "stop",
			};
			expect(
				projectKnowledgeEvent({
					type: "message_update",
					assistantMessageEvent: { type: "text_delta", delta: "MISSING_HOOK_BYPASS" },
				}),
			).toBeNull();
			expect(JSON.stringify(projectKnowledgeEvent({ type: "message_end", message }))).not.toContain(
				"MISSING_HOOK_BYPASS",
			);
			expect(JSON.stringify(message)).not.toContain("MISSING_HOOK_BYPASS");
		} finally {
			globalThis[key] = saved;
		}
	});
});

describe("live-run edges and provider protocol compatibility", () => {
	it("holds an in-memory final draft out of polling and exports while validation is unresolved", async () => {
		const service = await getKnowledgeService(),
			validate = service.validateAnswer.bind(service);
		let release;
		vi.spyOn(service, "validateAnswer").mockImplementation(
			(...args) =>
				new Promise((resolveProof) => {
					release = async () => resolveProof(await validate(...args));
				}),
		);
		const running = run(steps());
		await vi.waitFor(() => expect(release).toBeTypeOf("function"));
		const view = await backend.getSessionMessages(sid);
		expect(JSON.stringify(view)).not.toContain("Released conditional observation");
		expect(await readFile(await backend.exportSession(sid, "jsonl"), "utf8")).not.toContain(
			"Released conditional observation",
		);
		await release();
		await running;
		expect(JSON.stringify(await backend.getSessionMessages(sid))).toContain(
			"Released conditional observation",
		);
	});
	it("preserves signed tool-cycle protocol for the provider without persisting or displaying it", async () => {
		const signed = {
			type: "thinking",
			thinking: "PRIVATE_PROTOCOL_CONTENT",
			thinkingSignature: "opaque-signature",
		};
		const first = reply(
			[
				signed,
				fauxText("PRIVATE_TOOL_PREFACE"),
				call("research_read_knowledge", { path: "Wiki/Autotomy.md" }),
			],
			{ stopReason: "toolUse" },
		);
		let sawProtocol = false,
			seenPrevious = null;
		await run([
			first,
			(context) => {
				const previous = context.messages.find(
					(m) => m.role === "assistant" && m.content.some((b) => b.type === "toolCall"),
				);
				seenPrevious = structuredClone(previous);
				sawProtocol = true;
				return tool("research_search_knowledge", { query: "Autotomy" });
			},
			tool("research_read_knowledge", { path: "Library/Papers/source.md" }),
			reply("Protocol-safe answer. [[Library/Papers/source]]"),
		]);
		expect(sawProtocol).toBe(true);
		expect(seenPrevious.content[0]).toEqual(signed);
		expect(seenPrevious.content.some((b) => b.text === "PRIVATE_TOOL_PREFACE")).toBe(true);
		expect(JSON.stringify(events)).not.toContain("PRIVATE_PROTOCOL_CONTENT");
		expect(JSON.stringify(session.messages)).not.toContain("PRIVATE_TOOL_PREFACE");
		const exported = await readFile(await backend.exportSession(sid, "jsonl"), "utf8");
		expect(exported).not.toContain("PRIVATE_PROTOCOL_CONTENT");
		expect(exported).toContain("Protocol-safe answer");
	});
	it("queued follow-up questions receive fresh host proof instead of inheriting prior permissions", async () => {
		const queuedQuestion = "A new question after the completed evidence check.";
		const scripted = steps();
		scripted[3] = async () => {
			await session.followUp(queuedQuestion);
			return reply("First response. [[Library/Papers/source]]");
		};
		scripted.push(reply("QUEUED_QUESTION_CURRENT_PROOF"));
		await run(scripted);
		expect(faux.state.callCount).toBe(5);
		const finals = session.messages.filter(
			(message) => message.role === "assistant" && message.knowledgePublication?.status === "released",
		);
		const first = finals.find((message) =>
			message.content.some((block) => block.text?.includes("First response")),
		);
		const queued = finals.find((message) =>
			message.content.some((block) => block.text?.includes("QUEUED_QUESTION_CURRENT_PROOF")),
		);
		expect(queued.content[0].text).toContain("[[");
		expect(queued.knowledgePublication.searchQuery).toBe(queuedQuestion);
		expect(queued.knowledgePublication.queryHash).not.toBe(first.knowledgePublication.queryHash);
		expect(queued.knowledgePublication.turnId).not.toBe(first.knowledgePublication.turnId);
	});
	it("backend prompt acknowledgement and event delivery expose the same sealed current-turn proof", async () => {
		const prompt = "A normal desktop or LAN question.";
		faux.setResponses([reply("IPC_PATH_CURRENT_PROOF")]);
		await expect(backend.prompt(sid, prompt)).resolves.toEqual({ kind: "agent" });
		await vi.waitFor(() => expect(events.some((e) => e.type === "agent_settled")).toBe(true));
		const final = events
			.filter((event) => event.type === "message_end" && event.message?.role === "assistant")
			.at(-1)?.message;
		expect(final.content[0].text).toContain("IPC_PATH_CURRENT_PROOF");
		expect(final.content[0].text).toContain("[[");
		expect(final.knowledgePublication).toMatchObject({ status: "released", searchQuery: prompt });
		expect(JSON.stringify(await backend.peekSessionMessages(sid))).toContain("IPC_PATH_CURRENT_PROOF");
	});
	it("provider request errors surface as LLM errors, not knowledge publication notices", async () => {
		await run([
			reply([], {
				stopReason: "error",
				errorMessage: "OpenAI API error (502): Upstream service temporarily unavailable",
			}),
		]);
		const dumped = JSON.stringify(events);
		expect(dumped).not.toContain("知识库检查未通过");
		const firstError = events.find(
			(event) => event.type === "turn_end" && event.message?.stopReason === "error",
		)?.message;
		expect(firstError.errorMessage).toContain("502");
		expect(firstError.content).toEqual([]);
		const transcript = events.reduce(reduceEvent, emptyTranscript());
		const cards = transcript.messages.filter((m) => m.kind === "error");
		expect(cards).toHaveLength(1);
		expect(cards[0].error.detail).not.toContain("知识库检查未通过");
		expect(cards[0].error.detail).toMatch(/502|No more faux responses queued/);
	});
});

it("real SDK displays public stage → tools → next stage → tools → summary before the checked final answer", async () => {
	const steps = [
		reply(
			[
				call("set_status", {
					text: "STAGE_ONE",
					kind: "plan",
					detail: "Read the Wiki before searching evidence.",
				}),
				call("research_read_knowledge", { path: "Wiki/Autotomy.md" }),
			],
			{ stopReason: "toolUse" },
		),
		reply(
			[
				call("set_status", {
					text: "STAGE_TWO",
					kind: "update",
					detail: "Locate the evidence that the Wiki points to.",
				}),
				call("research_search_knowledge", { query: "Autotomy" }),
			],
			{ stopReason: "toolUse" },
		),
		reply(
			[
				call("set_status", { text: "STAGE_THREE", kind: "plan", detail: "Read the actual source range." }),
				call("research_read_knowledge", { path: "Library/Papers/source.md" }),
			],
			{ stopReason: "toolUse" },
		),
		tool("set_status", {
			text: "STAGE_SUMMARY",
			kind: "summary",
			detail: "The cited source was read; publication remains independently checked.",
		}),
		reply("FINAL_STAGE_DELIVERY [[Library/Papers/source]]"),
	];
	await run(steps);
	const labels = (state) =>
		buildChatRows(state, "fixture").flatMap((row) =>
			row.kind === "metaGroup"
				? row.items.flatMap((i) => i.tools.map((t) => t.name))
				: row.kind === "message" && row.message.kind === "assistant" && !row.message.taskView
					? [row.message.progress?.text || row.message.text]
					: [],
		);
	const expected = [
		"STAGE_ONE",
		"research_read_knowledge",
		"STAGE_TWO",
		"research_search_knowledge",
		"STAGE_THREE",
		"research_read_knowledge",
		"STAGE_SUMMARY",
		"FINAL_STAGE_DELIVERY [[Library/Papers/source]]",
	];
	const live = events.reduce(reduceEvent, emptyTranscript());
	const history = {
		...emptyTranscript(),
		messages: messagesToUIMessages(await backend.getSessionMessages(sid)),
	};
	expect(live.messages.some((m) => m.kind === "assistant" && m.taskView?.version === 2)).toBe(true);
	expect(labels(live)).toEqual(expected);
	expect(labels(history)).toEqual(expected);
	expect(deriveTurnUsage(live.messages)[0].requests).toBe(5);
	expect(deriveTurnUsage(history.messages)[0].requests).toBe(5);
	expect(session.messages.filter((m) => m.role === "assistant").at(-1).knowledgePublication.status).toBe(
		"released",
	);
	expect(events.some((e) => e.type === "message_update")).toBe(false);
	const exported = readSessionMessagesFromContent(
		await readFile(await backend.exportSession(sid, "jsonl"), "utf8"),
	);
	expect(labels({ ...emptyTranscript(), messages: messagesToUIMessages(exported) })).toEqual(expected);
});

it("real SDK repeated review commands open UI without model calls or fabricated run events", async () => {
	const notifications = [];
	const unsubscribe = subscribeKnowledgeUi((event) => notifications.push(event));
	const before = session.messages.length;
	try {
		for (let i = 0; i < 3; i++) {
			await expect(backend.prompt(sid, "/obsidian-review")).resolves.toEqual({ kind: "command" });
			expect(session.isStreaming).toBe(false);
		}
		expect(faux.state.callCount).toBe(0);
		expect(events.some((event) => event.type === "agent_start")).toBe(false);
		expect(session.messages.length).toBe(before);
		expect(
			notifications.filter((event) => event.kind === "open-review" && event.sessionId === sid),
		).toHaveLength(3);
	} finally {
		unsubscribe();
	}
});
