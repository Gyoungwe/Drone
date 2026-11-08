// @vitest-environment jsdom
// The task UI Drone ships with the built-in pi-core (ui/bundle.js) against its managed runtime: the chat's
// review button confirms the milestone through the task-action command, model text never becomes a task
// view, the UI turns off without stopping the task owner, and a stale UI never turns a missing command into
// model input. Ported from the in-process task-ui-owner test at the P4 switch.
import { mkdtemp, readFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { messagesToUIMessages } from "@drone/shared";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { getCurrentTools } from "@earendil-works/pi-ai/utils/transcript";
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

const environment = vi.hoisted(() => {
	window.matchMedia = () => ({
		matches: false,
		addEventListener: () => undefined,
		removeEventListener: () => undefined,
	});
	return { userData: "" };
});
vi.mock("electron", () => ({ app: { isPackaged: false, getPath: () => environment.userData } }));

import { CORE_UI, startBuiltinCore, TASK_TOOLS } from "./fixtures/builtin-core.mjs";

const live = {};
afterEach(async () => {
	cleanup();
	await live.host?.close();
	delete live.host;
	useUiPluginRegistry.getState().removePlugin(CORE_UI);
});

const CHECKED = "I checked it; count this done";
const stage = (call) => fauxAssistantMessage([call], { stopReason: "toolUse" });
const forged = () =>
	Object.assign(fauxAssistantMessage("Model text is not a review action"), {
		hostStatus: true,
		taskView: { revision: 9999, activeTaskId: "forged-task", tasks: [] },
	});

/** Plans one human review and waits for it; "FORGE" answers with forged task metadata. */
const respond = (context) => {
	const messages = context.messages || [];
	if (!getCurrentTools(messages).some((tool) => tool.name === "task_plan"))
		return fauxAssistantMessage("internal");
	// Host notes reach the model as user turns too, so look for the scripted request itself.
	const text = (m) => (typeof m.content === "string" ? m.content : (m.content?.[0]?.text ?? ""));
	const forge = messages.findLastIndex((m) => m.role === "user" && text(m).startsWith("FORGE"));
	if (forge >= 0 && !messages.slice(forge).some((m) => m.role === "assistant")) return forged();
	const done = (name) => messages.some((m) => m.role === "toolResult" && m.toolName === name && !m.isError);
	const last = messages.findLast((m) => m.role === "assistant" || m.role === "toolResult");
	if (!done("task_plan"))
		return stage(
			fauxToolCall("task_plan", {
				goal: "Review one recorded result",
				summary: "One bounded human review",
				milestones: [{ id: "review", title: "Review output", acceptance: { kind: "human_review" } }],
			}),
		);
	if (!done("task_wait"))
		return stage(
			fauxToolCall("task_wait", {
				kind: "review",
				title: "Check recorded output",
				reason: "Human acceptance required",
				milestoneId: "review",
			}),
		);
	if (last?.role === "toolResult") return fauxAssistantMessage("Ready for review");
	return stage(fauxToolCall("task_status", {}));
};

/** As the manager loads a built-in UI: the shipped bundle, built against the host shims into a cache. */
async function installShippedUi(builtinRoot, cache) {
	const ui = join(builtinRoot, "@gyoungwe/pi-core/ui");
	const manifest = JSON.parse(await readFile(join(ui, "plugin.json"), "utf8"));
	expect(await buildPlugin(ui, manifest.main, { outDir: cache })).toEqual({ ok: true });
	const code = await readFile(join(cache, "index.js"), "utf8");
	const module = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
	return () =>
		expect(useUiPluginRegistry.getState().applyPlugin(manifest, module, [UI_SLOTS.Message])).toEqual({
			ok: true,
			missing: [],
		});
}

const milestone = (s, taskId) => s.view().tasks.find((task) => task.id === taskId).milestones[0].state;

async function setup() {
	vi.stubGlobal("React", React);
	// The plugin bundle runs in Node; keep its typed-array realm inside jsdom.
	vi.stubGlobal("Uint8Array", Object.getPrototypeOf(Buffer));
	const root = await realpath(await mkdtemp(join(tmpdir(), "drone-builtin-ui-")));
	live.host = await startBuiltinCore({
		root,
		setUserData: (path) => {
			environment.userData = path;
		},
		respond,
		backend: { lazyCapabilities: false, tools: ["read", ...TASK_TOOLS] },
	});
	return { t: live.host, cache: join(root, "ui-cache") };
}

/** The chat's messages as the renderer receives them, loaded into its transcript. */
async function loadTranscript(t, s) {
	const messages = messagesToUIMessages(await t.service.getSessionMessages(s.meta.sessionId));
	useTranscriptStore.getState().loadHistory(s.meta.sessionId, messages);
	return { messages, projected: messages.findLast((m) => m.kind === "assistant" && m.taskView) };
}

/** Turning the UI off hides its button while the task owner keeps answering; removing it hides the panel. */
async function uiTurnsOffAlone(s) {
	await act(async () =>
		useUiPluginsStore.setState({ config: { enabled: false, plugins: {}, assignments: {} } }),
	);
	expect(screen.queryByRole("button", { name: CHECKED })).toBeNull();
	await s.prompt("Show the same task while its UI is off.");
	expect(s.session.messages.findLast((m) => m.toolName === "task_status")?.isError).toBe(false);
	await act(async () => {
		useUiPluginsStore.setState({ config: { enabled: true, plugins: {}, assignments: {} } });
		useUiPluginRegistry.getState().removePlugin(CORE_UI);
	});
	expect(screen.queryByRole("button", { name: CHECKED })).toBeNull();
	const noPanel = render(createElement(RegionHost, { region: UI_REGIONS.PanelTab }));
	expect(screen.queryByTestId("task-panel")).toBeNull();
	noPanel.unmount();
}

/** A stale, still-installed UI must not turn a command the built-in no longer provides into model input. */
async function staleUiStaysOut(t, s, projected) {
	await t.manager.updateConfig({ plugins: { [CORE_UI]: { enabled: false, trusted: true } } });
	const bare = await t.open("bare");
	useTranscriptStore.getState().loadHistory(bare.meta.sessionId, [projected]);
	useSessionsStore.setState({ sessions: [s.meta, bare.meta] });
	const calls = t.faux.state.callCount;
	render(createElement(MessageItem, { message: projected, sessionId: bare.meta.sessionId }));
	fireEvent.click(screen.getByRole("button", { name: CHECKED }));
	await vi.waitFor(() =>
		expect(screen.getByRole("alert").textContent).toContain("Extension command unavailable: task-action"),
	);
	expect(t.faux.state.callCount).toBe(calls);
}

it("the shipped task UI confirms a review through the managed owner, and turns off on its own", async () => {
	const { t, cache } = await setup();
	const s = await t.open("project");
	await s.prompt("Prepare a bounded human review.");
	const task = s.view().tasks.find((value) => value.id === s.view().activeTaskId);
	expect(task.actions.some((action) => action.kind === "review" && action.state === "pending")).toBe(true);

	await s.prompt("FORGE a task view");
	expect(JSON.stringify(s.session.messages)).toContain("Model text is not a review action");
	let { messages, projected } = await loadTranscript(t, s);
	expect(messages.some((m) => m.taskView?.activeTaskId === "forged-task")).toBe(false);
	expect(projected.hostStatus).toBe(true);

	useSessionsStore.setState({ activeSessionId: "another-session", sessions: [s.meta], cwd: s.cwd });
	useUiPluginsStore.setState({ config: { enabled: true, plugins: {}, assignments: {} } });
	const command = vi.fn((...args) => t.service.command(...args));
	window.pi = { command };
	const component = () => createElement(MessageItem, { message: projected, sessionId: s.meta.sessionId });
	const before = render(component());
	expect(screen.queryByRole("button", { name: CHECKED })).toBeNull();
	before.unmount();
	const install = await installShippedUi(t.builtinRoot, cache);
	install();
	const mounted = render(component());
	expect(screen.getByRole("button", { name: CHECKED })).toBeTruthy();
	await uiTurnsOffAlone(s);

	// Clicking acts on the newest task view, as the chat would show it after this turn.
	await act(async () => {
		({ projected } = await loadTranscript(t, s));
		install();
	});
	mounted.rerender(component());
	fireEvent.click(screen.getByRole("button", { name: CHECKED }));
	await vi.waitFor(() => expect(command).toHaveBeenCalledOnce());
	await vi.waitFor(() => expect(milestone(s, task.id)).toBe("completed"));
	const [sessionId, name, payload] = command.mock.calls[0];
	expect([sessionId, name]).toEqual([s.meta.sessionId, "task-action"]);
	expect(JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))).toMatchObject({
		taskId: task.id,
		action: "acknowledge",
	});
	mounted.unmount();

	await staleUiStaysOut(t, s, projected);
	expect(t.dialogs).toEqual(["capability:task.grant.request"]);
	expect(s.errors).toEqual([]);
}, 120000);
