import { mkdir, mkdtemp, readFile, realpath, rename, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import { taskHostLoader } from "@gyoungwe/pi-core/host";
import { afterEach, expect, it, vi } from "vitest";
import { createBackend } from "../src/create-backend";

const roots = [],
	backends = [];
afterEach(async () => {
	for (const backend of backends.splice(0)) await backend.dispose();
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const taskRecords = (entries) => entries.filter((entry) => entry.customType === "drone-task-session-v1");
const view = (session) => session.messages.findLast((message) => message.details?.taskView).details.taskView;
const action = (service, sessionId, input) =>
	service.command(sessionId, "task-action", Buffer.from(JSON.stringify(input)).toString("base64url"));
async function setup(adapter) {
	const root = await realpath(await mkdtemp(join(tmpdir(), "drone-task-commit-")));
	roots.push(root);
	const cwd = join(root, "project"),
		agentDir = join(root, "agent");
	await mkdir(cwd);
	await mkdir(agentDir);
	vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
	vi.stubEnv("DRONE_KNOWLEDGE_DIR", join(root, "knowledge"));
	const runtime = await ModelRuntime.create({
		authPath: join(agentDir, "auth.json"),
		modelsPath: null,
		allowModelNetwork: false,
		refreshOnCreate: false,
	});
	const faux = fauxProvider({ provider: "task-commit-offline", tokensPerSecond: 0 });
	runtime.registerNativeProvider(faux.provider);
	vi.spyOn(runtime, "hasConfiguredAuth").mockReturnValue(true);
	const makeBackend = () => {
		const backend = createBackend({
			...(adapter === "host" ? { taskHostLoader } : {}),
			projectTrust: false,
			lazyCapabilities: false,
			webFetch: false,
			subagentPreferBuiltin: false,
			desktopIntegration: {
				appendSystemPrompt: [],
				additionalSkillPaths: [],
				additionalExtensionPaths:
					adapter === "official" ? [createRequire(import.meta.url).resolve("@gyoungwe/pi-core")] : [],
			},
		});
		backends.push(backend);
		backend.sessions.modelRuntime = runtime;
		backend.stopAutoConsent = backend.sessions.onAskRequest((request) =>
			queueMicrotask(() => backend.sessions.respondAsk(request.id, { kind: "cancel" })),
		);
		return backend;
	};
	const backend = makeBackend(),
		service = backend.sessions;
	const meta = await service.createSession({ cwd, provider: faux.provider.id, modelId: faux.getModel().id });
	const session = service.registry.get(meta.sessionId).session;
	const plan = async (target) => {
		faux.setResponses([
			fauxAssistantMessage(
				fauxToolCall("task_plan", {
					goal: "Keep one real saved task",
					summary: "No write approval",
					milestones: [{ id: "review", title: "Review", acceptance: { kind: "human_review" } }],
				}),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("Retain this pending plan."),
		]);
		await target.prompt("Prepare a bounded plan and retain it when consent is declined.");
		await target.waitForIdle();
	};
	await plan(session);
	return {
		root,
		cwd,
		service,
		session,
		meta,
		faux,
		makeBackend,
		plan,
		stopAutoConsent: backend.stopAutoConsent,
	};
}
for (const adapter of ["host", "official"]) {
	it(`${adapter}: real SDK append failure rejects; same-manager reload retains phantom while disk reopen recovers committed data`, async () => {
		const { service, session, meta, makeBackend } = await setup(adapter);
		const before = view(session),
			task = before.tasks.find((value) => value.id === before.activeTaskId);
		const file = session.sessionManager.getSessionFile(),
			backup = file + ".saved";
		const beforeDisk = await readFile(file, "utf8"),
			beforeMessages = session.messages.length;
		await rename(file, backup);
		await mkdir(file);
		await expect(
			action(service, meta.sessionId, { action: "cancel", taskId: task.id, revision: before.revision }),
		).rejects.toThrow(/EISDIR/);
		expect(session.messages).toHaveLength(beforeMessages);
		const phantom = taskRecords(session.sessionManager.getBranch()).at(-1);
		expect(phantom.data.workbench.revision).toBeGreaterThan(before.revision);
		expect(phantom.data.workbench.tasks.find((value) => value.id === task.id).state).toBe("cancelled");
		await rm(file, { recursive: true });
		await rename(backup, file);
		expect(await readFile(file, "utf8")).toBe(beforeDisk);
		await expect(
			action(service, meta.sessionId, { action: "cancel", taskId: task.id, revision: before.revision }),
		).rejects.toThrow(/reopen/);
		const sameManager = session.sessionManager;
		await session.reload();
		expect(session.sessionManager).toBe(sameManager);
		expect(taskRecords(session.sessionManager.getBranch()).at(-1).id).toBe(phantom.id);
		// The long-lived Desktop package application supplies the persistent fence.
		// Raw CLI reload recreates the application: its missing source/generation port
		// remains an explicitly recorded S2 gap, demonstrated by the retained RED log.
		if (adapter === "host") {
			await expect(service.command(meta.sessionId, "task-status", "")).rejects.toThrow(
				`needs-reopen; last committed revision ${before.revision}`,
			);
			await expect(
				action(service, meta.sessionId, { action: "cancel", taskId: task.id, revision: before.revision }),
			).rejects.toThrow(/reopen/);
		}
		expect(await readFile(file, "utf8")).toBe(beforeDisk);
		const disk = SessionManager.open(file);
		expect(taskRecords(disk.getBranch()).at(-1).data.workbench.revision).toBe(before.revision);
		expect(disk.getEntries().some((entry) => entry.id === phantom.id)).toBe(false);
		const reopened = makeBackend().sessions;
		const restored = await reopened.openSession(file);
		await reopened.command(restored.sessionId, "task-status", "");
		const recovered = reopened.registry.get(restored.sessionId).session;
		expect(view(recovered).revision).toBe(before.revision);
		expect(view(recovered).tasks.find((value) => value.id === task.id).state).not.toBe("cancelled");
	}, 20000);
	it(`${adapter}: a cancelled real approval cannot commit its late answer`, async () => {
		const { service, session, meta, stopAutoConsent } = await setup(adapter);
		stopAutoConsent();
		const before = view(session),
			task = before.tasks[0],
			count = taskRecords(session.sessionManager.getBranch()).length;
		let pending;
		const stop = service.onAskRequest((request) => {
			pending = request;
		});
		const result = action(service, meta.sessionId, {
			action: "authorize-task",
			taskId: task.id,
			revision: before.revision,
		}).catch((error) => error);
		await vi.waitFor(() => expect(pending).toBeTruthy());
		await service.abort(meta.sessionId);
		service.respondAsk(pending.id, {
			kind: "answer",
			mode: "submit",
			answers: Object.fromEntries(
				pending.questions.map((question) => [
					question.id,
					{ values: [question.options.find((option) => option.value === "同意本次请求").value] },
				]),
			),
		});
		expect(await result).toMatchObject({ message: "Session command cancelled" });
		expect(taskRecords(session.sessionManager.getBranch())).toHaveLength(count);
		await service.command(meta.sessionId, "task-status", "");
		expect(view(session).revision).toBe(before.revision);
		expect(view(session).tasks[0].executionConsent).toBeUndefined();
		stop();
	}, 20000);
	it(`${adapter}: actual independent sessions commit separately under concurrent explicit commands`, async () => {
		const { root, cwd, service, session, meta, faux, plan } = await setup(adapter);
		const secondCwd = join(root, "second");
		await mkdir(secondCwd);
		const second = await service.createSession({
			cwd: secondCwd,
			provider: faux.provider.id,
			modelId: faux.getModel().id,
		});
		const other = service.registry.get(second.sessionId).session;
		await plan(other);
		const firstView = view(session),
			secondView = view(other);
		expect(taskRecords(session.sessionManager.getBranch()).at(-1).data.workbench.scope).not.toBe(
			taskRecords(other.sessionManager.getBranch()).at(-1).data.workbench.scope,
		);
		const firstTask = firstView.tasks[0],
			secondTask = secondView.tasks[0];
		await Promise.all([
			action(service, meta.sessionId, {
				action: "cancel",
				taskId: firstTask.id,
				revision: firstView.revision,
			}),
			action(service, second.sessionId, {
				action: "cancel",
				taskId: secondTask.id,
				revision: secondView.revision,
			}),
		]);
		expect(view(session).tasks[0].state).toBe("cancelled");
		expect(view(other).tasks[0].state).toBe("cancelled");
		await action(service, second.sessionId, {
			action: "archive",
			taskId: secondTask.id,
			revision: view(other).revision,
		});
		expect(view(other).tasks[0].state).toBe("archived");
		expect(JSON.stringify(taskRecords(session.sessionManager.getBranch()))).not.toContain(secondTask.id);
		expect(JSON.stringify(taskRecords(other.sessionManager.getBranch()))).not.toContain(firstTask.id);
		expect(session.sessionManager.getCwd()).toBe(cwd);
	}, 20000);
}
