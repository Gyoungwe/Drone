import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { closeKnowledgeServices } from "@gyoungwe/pi-knowledge/host";
import { afterEach, expect, it, vi } from "vitest";
import { SessionService } from "../src/session-service";

const knowledgeExtension = join(
	resolve(import.meta.dirname, "../../.."),
	".pi",
	"extensions",
	"obsidian-workbench.mjs",
);
const coreExtension = createRequire(import.meta.url).resolve("@gyoungwe/pi-core");
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
	const service = new SessionService({
		projectTrust: false,
		lazyCapabilities: false,
		webFetch: false,
		subagentPreferBuiltin: false,
		desktopIntegration: {
			appendSystemPrompt: [],
			additionalSkillPaths: [],
			additionalExtensionPaths:
				installedCore && order === "core-first"
					? [coreExtension, knowledgeExtension]
					: [knowledgeExtension, ...(installedCore ? [coreExtension] : [])],
		},
	});
	services.push(service);
	service.modelRuntime = modelRuntime;
	const permissions = [];
	service.onPermissionRequest((request) => {
		permissions.push(request);
		queueMicrotask(() =>
			service.respondPermission(request.id, request.message.includes("denied.txt") ? "deny" : "allow"),
		);
	});
	let asks = 0;
	service.onAskRequest((request) => {
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
	return { service, session, cwd, faux, permissions, asks: () => asks };
}

const response = (name, args) => fauxAssistantMessage(fauxToolCall(name, args));
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

it.each(["core-first", "knowledge-first"])(
	"activates installed core before/after knowledge (%s) and completes its approved file milestone",
	async (order) => {
		const { session, cwd, faux, asks } = await setup(true, order);
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
