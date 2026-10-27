// @vitest-environment jsdom

import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { messagesToUIMessages } from "@drone/shared";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { taskHostLoader } from "@gyoungwe/pi-core/host";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import React, { createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { buildPlugin } from "../../desktop/src/main/ui-plugins/build";
import "../../desktop/src/renderer/src/plugins/host-api";
import { MessageItem } from "../../desktop/src/renderer/src/components/chat/MessageItem";
import { RegionHost } from "../../desktop/src/renderer/src/plugins/RegionHost";
import { useUiPluginRegistry } from "../../desktop/src/renderer/src/plugins/registry";
import { UI_REGIONS, UI_SLOTS } from "../../desktop/src/renderer/src/plugins/slots";
import { useSessionsStore } from "../../desktop/src/renderer/src/stores/sessions";
import { useTranscriptStore } from "../../desktop/src/renderer/src/stores/transcript";
import { useUiPluginsStore } from "../../desktop/src/renderer/src/stores/ui-plugins";
import { createBackend } from "../src/create-backend";

vi.hoisted(() => {
	window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
});

const roots = [];
let backend;
afterEach(async () => {
	cleanup();
	if (backend) await backend.dispose();
	backend = undefined;
	useUiPluginRegistry.getState().removePlugin("drone-task-ui");
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const call = (name, args) => fauxAssistantMessage(fauxToolCall(name, args), { stopReason: "toolUse" });

it("uses installed core UI for actual journal review, unloads UI independently, and restores the same owner", async () => {
	vi.stubGlobal("React", React);
	// The host builder runs in Node; preserve its typed-array realm inside jsdom.
	vi.stubGlobal("Uint8Array", Object.getPrototypeOf(Buffer));
	const root = await realpath(await mkdtemp(join(tmpdir(), "drone-task-ui-owner-")));
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
	const faux = fauxProvider({ provider: "task-ui-owner-offline", tokensPerSecond: 0 });
	runtime.registerNativeProvider(faux.provider);
	vi.spyOn(runtime, "hasConfiguredAuth").mockReturnValue(true);
	backend = createBackend({
		taskHostLoader,
		projectTrust: false,
		lazyCapabilities: false,
		webFetch: false,
		subagentPreferBuiltin: false,
		desktopIntegration: { appendSystemPrompt: [], additionalExtensionPaths: [], additionalSkillPaths: [] },
	});
	const service = backend.sessions;
	service.modelRuntime = runtime;
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
	faux.setResponses([
		call("task_plan", {
			goal: "Review one recorded result",
			summary: "One bounded human review",
			milestones: [{ id: "review", title: "Review output", acceptance: { kind: "human_review" } }],
		}),
		call("task_wait", {
			kind: "review",
			title: "Check recorded output",
			reason: "Human acceptance required",
			milestoneId: "review",
		}),
		call("task_status", {}),
		fauxAssistantMessage("Ready for review"),
	]);
	await session.prompt("Prepare a bounded human review.");
	await session.waitForIdle();
	expect(asks).toBe(1);
	const rawView = session.messages.findLast((message) => message.details?.taskView).details.taskView;
	const task = rawView.tasks.find((value) => value.id === rawView.activeTaskId);
	expect(task.actions.some((action) => action.kind === "review" && action.state === "pending")).toBe(true);
	const messages = messagesToUIMessages(await service.getSessionMessages(meta.sessionId));
	let projected = messages.findLast((message) => message.kind === "assistant" && message.taskView);
	expect(projected.hostStatus).toBe(true);
	useTranscriptStore.getState().loadHistory(meta.sessionId, messages);
	useSessionsStore.setState({ activeSessionId: "another-session", sessions: [meta], cwd });
	useUiPluginsStore.setState({ config: { enabled: true, plugins: {}, assignments: {} } });
	const prompt = vi.fn((...args) => service.prompt(...args));
	window.pi = { prompt };
	const component = () => createElement(MessageItem, { message: projected, sessionId: meta.sessionId });
	const view = render(component());
	expect(screen.queryByRole("button", { name: "I checked it; count this done" })).toBeNull();
	view.unmount();
	const coreRoot = resolve(createRequire(import.meta.url).resolve("@gyoungwe/pi-core"), "../..");
	const manifest = JSON.parse(await readFile(join(coreRoot, "ui/plugin.json"), "utf8"));
	expect(await buildPlugin(join(coreRoot, "ui"), manifest.main, { outDir: join(root, "ui") })).toEqual({
		ok: true,
	});
	const code = await readFile(join(root, "ui/index.js"), "utf8");
	const module = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
	const install = () =>
		expect(useUiPluginRegistry.getState().applyPlugin(manifest, module, [UI_SLOTS.Message])).toEqual({
			ok: true,
			missing: [],
		});
	install();
	const mounted = render(component());
	expect(screen.getByRole("button", { name: "I checked it; count this done" })).toBeTruthy();
	await act(async () =>
		useUiPluginsStore.setState({ config: { enabled: false, plugins: {}, assignments: {} } }),
	);
	expect(screen.queryByRole("button", { name: "I checked it; count this done" })).toBeNull();
	faux.setResponses([call("task_status", {}), fauxAssistantMessage("Owner remains active")]);
	await session.prompt("Show the same journal while its UI is disabled.");
	await session.waitForIdle();
	expect(
		session.messages.findLast(
			(message) => message.role === "toolResult" && message.toolName === "task_status",
		).isError,
	).toBe(false);
	await act(async () => {
		useUiPluginsStore.setState({ config: { enabled: true, plugins: {}, assignments: {} } });
		useUiPluginRegistry.getState().removePlugin(manifest.name);
	});
	expect(screen.queryByRole("button", { name: "I checked it; count this done" })).toBeNull();
	const noPanel = render(createElement(RegionHost, { region: UI_REGIONS.PanelTab }));
	expect(screen.queryByTestId("task-panel")).toBeNull();
	noPanel.unmount();
	await act(async () => {
		const currentMessages = messagesToUIMessages(await service.getSessionMessages(meta.sessionId));
		projected = currentMessages.findLast((message) => message.kind === "assistant" && message.taskView);
		useTranscriptStore.getState().loadHistory(meta.sessionId, currentMessages);
		install();
	});
	mounted.rerender(component());
	fireEvent.click(screen.getByRole("button", { name: "I checked it; count this done" }));
	await vi.waitFor(() => expect(prompt).toHaveBeenCalledOnce());
	await vi.waitFor(() =>
		expect(
			session.messages
				.findLast((message) => message.details?.taskView)
				.details.taskView.tasks.find((value) => value.id === task.id).milestones[0].state,
		).toBe("completed"),
	);
	expect(prompt.mock.calls[0][0]).toBe(meta.sessionId);
	expect(prompt.mock.calls[0][1]).toMatch(/^\/task-action /);
	expect(asks).toBe(1);
	expect(await readFile(session.sessionFile, "utf8")).toContain(task.id);
	mounted.unmount();
}, 30000);
