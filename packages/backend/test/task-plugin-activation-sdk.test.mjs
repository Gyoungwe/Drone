import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { configureObsidian } from "@drone/extensions/internal/obsidian-workbench";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
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

async function setup(installedCore, order = "knowledge-first") {
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
	const backend = createBackend({
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

it.each(["core-first"])(
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
