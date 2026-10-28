import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { configureObsidian } from "@drone/extensions/internal/obsidian-workbench";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { taskHostLoader } from "@gyoungwe/pi-core/host";
import { closeKnowledgeServices } from "@gyoungwe/pi-knowledge/host";
import { afterEach, expect, it, vi } from "vitest";
import { createBackend } from "../src/create-backend";

const knowledgeExtension = join(
	resolve(import.meta.dirname, "../../.."),
	".pi",
	"extensions",
	"obsidian-workbench.mjs",
);
const coreExtension = createRequire(import.meta.url).resolve("@gyoungwe/pi-core");
const nativeKnowledgeExtension = createRequire(import.meta.url).resolve("@gyoungwe/pi-knowledge");
const roots = [];
const services = [];

afterEach(async () => {
	for (const service of services.splice(0)) await service.dispose();
	await closeKnowledgeServices();
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function setup(installedCore, order = "knowledge-first", declaration = false) {
	const root = await realpath(await mkdtemp(join(tmpdir(), "drone-task-activation-")));
	roots.push(root);
	const cwd = join(root, "project"),
		agentDir = join(root, "agent");
	await mkdir(cwd);
	await mkdir(agentDir);
	await writeFile(
		join(agentDir, "permissions.json"),
		JSON.stringify({ autoApproveProjectEdits: false, rules: { write: "ask", bash: "ask" } }),
	);
	await writeFile(join(cwd, "input.txt"), "synthetic input");
	vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
	vi.stubEnv("DRONE_KNOWLEDGE_DIR", join(root, "knowledge"));
	vi.stubEnv("PI_RESEARCH_DESKTOP_CONFIG", undefined);
	const modelRuntime = await ModelRuntime.create({
		authPath: join(agentDir, "auth.json"),
		modelsPath: null,
		allowModelNetwork: false,
		refreshOnCreate: false,
	});
	const faux = fauxProvider({ provider: "task-activation-offline", tokensPerSecond: 0 });
	modelRuntime.registerNativeProvider(faux.provider);
	vi.spyOn(modelRuntime, "hasConfiguredAuth").mockReturnValue(true);
	const declarationPath = join(root, "session-declaration.mjs");
	if (declaration)
		await writeFile(
			declarationPath,
			`export default pi => {
 pi.on("session_start", (_event, ctx) => {
  if (ctx.cwd === ${JSON.stringify(cwd)}) pi.events.emit("drone:acceptance-verifier/v1", {
   version:1, kind:"session_only", definition:{fields:["sessionField"], verify:(_input,{cwd:scope})=>({state:scope===${JSON.stringify(cwd)}?"found":"missing",summary:"Same-session verifier executed"})}
  });
 });
};`,
		);
	const backend = createBackend({
		...(installedCore ? { taskHostLoader } : {}),
		projectTrust: false,
		lazyCapabilities: false,
		webFetch: false,
		subagentPreferBuiltin: false,
		desktopIntegration: {
			appendSystemPrompt: [],
			additionalSkillPaths: [],
			additionalExtensionPaths: [
				...(installedCore && ["core-first", "native-knowledge"].includes(order) ? [coreExtension] : []),
				...(order === "native-knowledge" ? [nativeKnowledgeExtension] : [knowledgeExtension]),
				...(installedCore && order === "knowledge-first" ? [coreExtension] : []),
				...(declaration ? [declarationPath] : []),
			],
		},
	});
	services.push(backend);
	const service = backend.sessions;
	service.modelRuntime = modelRuntime;
	const permissions = [];
	service.onPermissionRequest((request) => {
		permissions.push(request);
		queueMicrotask(() =>
			service.respondPermission(request.id, request.message.includes("denied.txt") ? "deny" : "allow"),
		);
	});
	let asks = 0;
	const stopAutoApproval = service.onAskRequest((request) => {
		asks++;
		queueMicrotask(() =>
			service.respondAsk(request.id, {
				kind: "answer",
				mode: "submit",
				answers: Object.fromEntries(
					request.questions.map((question) => [
						question.id,
						{ values: [question.options.find((option) => option.value === "同意本次请求").value] },
					]),
				),
			}),
		);
	});
	const meta = await service.createSession({ cwd, provider: faux.provider.id, modelId: faux.getModel().id });
	const session = service.registry.get(meta.sessionId).session;
	return { backend, service, session, cwd, faux, permissions, asks: () => asks, stopAutoApproval };
}

const response = (name, args) => fauxAssistantMessage(fauxToolCall(name, args), { stopReason: "toolUse" });
const results = (session, name) =>
	session.messages.filter((message) => message.role === "toolResult" && message.toolName === name);

it("keeps read/write/bash under host permissions when only the knowledge resources are installed", async () => {
	const { session, cwd, faux, permissions } = await setup(false);
	faux.setResponses([
		response("read", { path: "input.txt" }),
		response("write", { path: "denied.txt", content: "must not write" }),
		response("write", { path: "allowed.txt", content: "permission approved" }),
		response("bash", { command: "printf 'command approved' > command-output.txt" }),
		fauxAssistantMessage("completed"),
	]);
	await session.prompt("Read input and create the two synthetic outputs after permission checks.");
	await session.waitForIdle();
	expect(
		results(session, "read"),
		JSON.stringify(
			session.messages
				.filter((message) => message.role === "assistant")
				.map((message) => ({ stopReason: message.stopReason, errorMessage: message.errorMessage })),
		),
	).not.toHaveLength(0);
	expect(results(session, "read")[0].isError).toBe(false);
	expect(
		results(session, "write").map((result) => result.isError),
		JSON.stringify(session.messages.filter((message) => message.role === "toolResult")),
	).toEqual([true, false]);
	expect(results(session, "bash")[0].isError).toBe(false);
	expect(await readFile(join(cwd, "allowed.txt"), "utf8")).toBe("permission approved");
	expect(await readFile(join(cwd, "command-output.txt"), "utf8")).toBe("command approved");
	await expect(readFile(join(cwd, "denied.txt"))).rejects.toMatchObject({ code: "ENOENT" });
	expect(permissions.some((request) => request.message.includes("denied.txt"))).toBe(true);
	expect(session.getAllTools().map((tool) => tool.name)).not.toContain("task_plan");
}, 20000);

it.each(["core-first", "knowledge-first", "adapter-only", "native-knowledge"])(
	"activates installed core before/after knowledge (%s) and completes its approved file milestone",
	async (order) => {
		const { session, cwd, faux, asks } = await setup(true, order);
		if (order === "native-knowledge")
			expect(
				session.getToolDefinition("task_plan").parameters.properties.milestones.items.properties.acceptance
					.properties.kind.enum,
			).toContain("wiki_review");
		faux.setResponses([
			response("read", { path: "input.txt" }),
			response("write", { path: "unplanned.txt", content: "must not write" }),
			response("bash", { command: "printf 'must not run' > unplanned-command.txt" }),
			response("task_plan", {
				goal: "Write one approved file",
				summary: "Write one synthetic result",
				writeDirectories: ["."],
				milestones: [{ id: "report", title: "Report", acceptance: { kind: "file", path: "result.txt" } }],
			}),
			response("write", { path: "result.txt", content: "approved task output" }),
			response("task_status", {}),
			fauxAssistantMessage("completed"),
		]);
		await session.prompt("Read input and deliver a synthetic file after task authorization.");
		await session.waitForIdle();
		expect(
			results(session, "read"),
			JSON.stringify(
				session.messages
					.filter((message) => message.role === "assistant")
					.map((message) => ({ stopReason: message.stopReason, errorMessage: message.errorMessage })),
			),
		).not.toHaveLength(0);
		expect(results(session, "read")[0].isError).toBe(false);
		expect(
			results(session, "write").map((result) => result.isError),
			JSON.stringify(session.messages.filter((message) => message.role === "toolResult")),
		).toEqual([true, false]);
		expect(results(session, "write")[0].content[0].text).toContain("No approved task plan");
		expect(results(session, "bash")[0].isError).toBe(true);
		expect(results(session, "task_plan")[0].isError).toBe(false);
		expect(asks()).toBe(1);
		expect(await readFile(join(cwd, "result.txt"), "utf8")).toBe("approved task output");
		await expect(readFile(join(cwd, "unplanned.txt"))).rejects.toMatchObject({ code: "ENOENT" });
		await expect(readFile(join(cwd, "unplanned-command.txt"))).rejects.toMatchObject({ code: "ENOENT" });
		const view = [...session.messages].reverse().find((message) => message.details?.taskView)
			?.details.taskView;
		expect(view.tasks.find((task) => task.id === view.activeTaskId).remainingSummary).toContain("已验收 1/1");
	},
	20000,
);

it("two installed loaders and two real sessions isolate verifier registries, and disposed owners release basic tools", async () => {
	const first = await setup(true, "adapter-only", true);
	const secondCwd = join(first.cwd, "..", "second-project");
	await mkdir(secondCwd);
	const secondMeta = await first.service.createSession({
		cwd: secondCwd,
		provider: first.faux.provider.id,
		modelId: first.faux.getModel().id,
	});
	const second = first.service.registry.get(secondMeta.sessionId).session;
	const other = await setup(true, "adapter-only");
	const kinds = (session) =>
		session.getToolDefinition("task_plan").parameters.properties.milestones.items.properties.acceptance
			.properties.kind.enum;
	expect(kinds(first.session)).toContain("session_only");
	expect(kinds(second)).not.toContain("session_only");
	expect(kinds(other.session)).not.toContain("session_only");
	first.faux.setResponses([
		response("task_plan", {
			goal: "Check this session's verifier",
			summary: "Use the declared local criterion",
			milestones: [
				{
					id: "scoped",
					title: "Scoped check",
					acceptance: { kind: "session_only", sessionField: "only-first" },
				},
			],
		}),
		response("task_reconcile", {}),
		response("task_status", {}),
		fauxAssistantMessage("Scoped criterion checked"),
	]);
	await first.session.prompt("Reconcile the declared criterion in this session only.");
	await first.session.waitForIdle();
	const ownView = first.session.messages.findLast((message) => message.details?.taskView).details.taskView;
	expect(ownView.tasks.find((task) => task.id === ownView.activeTaskId).milestones[0]).toMatchObject({
		state: "completed",
		evidence: { summary: "Same-session verifier executed" },
	});
	other.faux.setResponses([
		response("task_plan", {
			goal: "Unavailable foreign criterion",
			summary: "Must fail",
			milestones: [{ id: "foreign", title: "Foreign", acceptance: { kind: "session_only" } }],
		}),
		fauxAssistantMessage("Foreign criterion unavailable"),
	]);
	await other.session.prompt("Attempt the foreign criterion without importing its declaration.");
	await other.session.waitForIdle();
	expect(results(other.session, "task_plan").at(-1).isError).toBe(true);
	expect(other.asks()).toBe(0);
	first.backend.taskHost.registerAcceptanceVerifier("loader_only", { fields: ["loaderField"] });
	expect(other.backend.taskHost.readAcceptanceVerifier("loader_only")).toBeNull();
	await first.backend.taskHost.dispose();
	first.faux.setResponses([
		response("task_plan", {
			goal: "disabled",
			summary: "disabled",
			milestones: [{ id: "one", title: "one", acceptance: { kind: "human_review" } }],
		}),
		response("read", { path: "input.txt" }),
		response("write", { path: "after-disable.txt", content: "host permission approved" }),
		response("bash", { command: "printf 'host bash approved' > after-disable-command.txt" }),
		fauxAssistantMessage("done"),
	]);
	await first.session.prompt("Read input and create the two outputs after permission checks.");
	await first.session.waitForIdle();
	expect(results(first.session, "task_plan").at(-1).isError).toBe(true);
	expect(results(first.session, "task_plan").at(-1).content[0].text).toContain("disposed");
	expect(results(first.session, "read").at(-1).isError).toBe(false);
	expect(results(first.session, "write").at(-1).isError).toBe(false);
	expect(results(first.session, "bash").at(-1).isError).toBe(false);
	expect(await readFile(join(first.cwd, "after-disable.txt"), "utf8")).toBe("host permission approved");
	expect(first.permissions.some((request) => request.message.includes("after-disable.txt"))).toBe(true);
	expect(other.backend.taskHost.readAcceptanceVerifier("wiki_review")).toBeNull();
}, 30000);

it("disposing a task owner cancels an open native authorization without granting consent", async () => {
	const current = await setup(true, "adapter-only");
	current.stopAutoApproval();
	let opened;
	current.service.onAskRequest((request) => {
		opened = request;
	});
	current.faux.setResponses([
		response("task_plan", {
			goal: "One bounded output",
			summary: "Wait for approval",
			writeDirectories: ["."],
			milestones: [{ id: "one", title: "One", acceptance: { kind: "file", path: "never.txt" } }],
		}),
		fauxAssistantMessage("Stopped before execution"),
	]);
	const prompt = current.session.prompt("Prepare one output and wait for the task approval.");
	await vi.waitFor(() => expect(opened).toBeDefined());
	await current.backend.taskHost.dispose();
	await prompt;
	await current.session.waitForIdle();
	expect(results(current.session, "task_plan").at(-1)).toMatchObject({
		isError: true,
		content: [{ type: "text", text: "Task session is closed" }],
	});
	expect(
		current.service.respondAsk(opened.id, {
			kind: "answer",
			mode: "submit",
			answers: Object.fromEntries(
				opened.questions.map((question) => [
					question.id,
					{ values: [question.options.find((option) => option.value === "同意本次请求").value] },
				]),
			),
		}),
	).toBe(false);
	const checkpoints = current.session.sessionManager
		.getBranch()
		.filter((entry) => entry.customType === "drone-task-session-v1");
	expect(checkpoints.length).toBeGreaterThan(0);
	expect(checkpoints.some((entry) => entry.data.workbench.tasks.some((task) => task.executionConsent))).toBe(
		false,
	);
	expect(current.permissions).toHaveLength(0);
	await expect(readFile(join(current.cwd, "never.txt"))).rejects.toMatchObject({ code: "ENOENT" });
}, 30000);

it("restores the installed session owner from durable SDK entries without replaying accepted writes", async () => {
	const current = await setup(true, "adapter-only");
	current.faux.setResponses([
		response("task_plan", {
			goal: "Preserve one accepted output",
			summary: "Read back and retain the checkpoint",
			writeDirectories: ["."],
			milestones: [
				{ id: "file", title: "File", acceptance: { kind: "file", path: "persisted.txt" } },
				{ id: "review", title: "Review", dependsOn: ["file"], acceptance: { kind: "human_review" } },
			],
		}),
		response("write", { path: "persisted.txt", content: "durable accepted output" }),
		response("task_status", {}),
		fauxAssistantMessage("Waiting for the bounded review"),
	]);
	await current.session.prompt("Prepare the bounded output and retain the review for the user.");
	await current.session.waitForIdle();
	const before = current.session.messages.findLast((message) => message.details?.taskView).details.taskView;
	const task = before.tasks.find((value) => value.id === before.activeTaskId);
	expect(task.milestones[0].state).toBe("completed");
	expect(task.executionConsent).toMatchObject({ version: 1 });
	const file = current.session.sessionFile;
	await current.service.closeSession(current.session.sessionId);
	const restored = await current.service.openSession(file);
	const session = current.service.registry.get(restored.sessionId).session;
	current.faux.setResponses([response("task_status", {}), fauxAssistantMessage("Checkpoint retained")]);
	await session.prompt("Report the existing checkpoint without repeating the write.");
	await session.waitForIdle();
	const after = session.messages.findLast((message) => message.details?.taskView).details.taskView;
	const recovered = after.tasks.find((value) => value.id === task.id);
	expect(recovered.milestones[0]).toMatchObject({
		id: task.milestones[0].id,
		state: "completed",
		acceptance: task.milestones[0].acceptance,
		evidence: {
			path: task.milestones[0].evidence.path,
			sha256: task.milestones[0].evidence.sha256,
			bytes: task.milestones[0].evidence.bytes,
		},
	});
	expect(recovered.milestones[1].state).not.toBe("completed");
	expect(recovered.executionConsent).toBeUndefined();
	expect(results(session, "write")).toHaveLength(1);
	expect(current.asks()).toBe(1);
	expect(await readFile(join(current.cwd, "persisted.txt"), "utf8")).toBe("durable accepted output");
}, 30000);

it("ordinary native core and knowledge keep a real unreviewed Wiki proposal outside task acceptance", async () => {
	const current = await setup(true, "native-knowledge");
	vi.stubEnv("DRONE_REVIEW_MODE", "strict");
	const vault = join(current.cwd, "..", "Vault");
	await configureObsidian({ cwd: current.cwd, vault, project: "wiki-scope" });
	await writeFile(join(vault, "Wiki/Index.md"), "# Index\n");
	await writeFile(join(vault, "Library/Papers/source.md"), "# Evidence\nObserved under condition A only.\n");
	current.faux.setResponses([
		response("task_plan", {
			goal: "Prepare a reviewed Wiki update",
			summary: "Preserve source scope and human review",
			milestones: [{ id: "wiki", title: "Reviewed Wiki", acceptance: { kind: "wiki_review" } }],
		}),
		response("research_prepare_knowledge", { query: "condition A" }),
		response("research_read_knowledge", { path: "Library/Papers/source.md" }),
		response("research_propose_wiki_update", {
			path: "Wiki/topic.md",
			title: "Topic",
			markdown: "Observed under condition A only.",
			rationale: "One source-limited observation.",
			source_paths: ["Library/Papers/source.md"],
		}),
		response("task_reconcile", {}),
		response("task_status", {}),
		fauxAssistantMessage("The proposed update still requires human review."),
	]);
	await current.session.prompt(
		"Read the source and prepare a Wiki proposal for human review, without treating it as accepted knowledge.",
	);
	await current.session.waitForIdle();
	const proposal = results(current.session, "research_propose_wiki_update").at(-1);
	expect(proposal.isError, JSON.stringify(proposal)).toBe(false);
	expect(proposal.details).toMatchObject({ status: "pending", vaultWritten: false });
	const view = current.session.messages.findLast((message) => message.details?.taskView).details.taskView;
	const task = view.tasks.find((value) => value.id === view.activeTaskId);
	expect(task.milestones[0].state).not.toBe("completed");
	expect(task.operations.some((operation) => operation.review?.id === proposal.details.id)).toBe(true);
	await expect(readFile(join(vault, "Wiki/topic.md"))).rejects.toMatchObject({ code: "ENOENT" });
	expect(current.asks()).toBe(1);
}, 30000);

it.each(["adapter-only", "core-first"])(
	"routes task-status intent inside the installed Pi package (%s) without starting a model",
	async (order) => {
		const { service, session, faux } = await setup(true, order);
		const before = faux.state.callCount;
		for (const text of ["完成到哪了", "What is the status?"]) {
			expect(await service.prompt(session.sessionId, text)).toEqual({ kind: "command" });
			expect(faux.state.callCount).toBe(before);
			expect(
				session.messages.findLast(
					(message) => message.role === "custom" && message.customType === "drone-task-status",
				).details.command,
			).toBe("task-status");
		}
		faux.setResponses([fauxAssistantMessage("Image context remains a model request")]);
		expect(
			await service.prompt(session.sessionId, "任务状态", [{ data: "aW1hZ2U=", mimeType: "image/png" }]),
		).toEqual({ kind: "agent" });
		await session.waitForIdle();
		expect(faux.state.callCount).toBeGreaterThan(before);
	},
	20000,
);
it("keeps task-status phrases as ordinary model input when the task package is absent", async () => {
	const { service, session, faux } = await setup(false);
	faux.setResponses([fauxAssistantMessage("Ordinary response without task capabilities")]);
	expect(await service.prompt(session.sessionId, "完成到哪了")).toEqual({ kind: "agent" });
	await session.waitForIdle();
	expect(faux.state.callCount).toBeGreaterThan(0);
	expect(session.extensionRunner.getCommand("task-status")).toBeUndefined();
}, 20000);
