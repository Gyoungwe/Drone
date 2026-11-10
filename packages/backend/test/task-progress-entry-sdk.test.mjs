import { mkdtemp, readFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxToolCall as call, fauxAssistantMessage as reply } from "@earendil-works/pi-ai";
import { afterEach, expect, it, vi } from "vitest";

const environment = vi.hoisted(() => ({ userData: "" }));
vi.mock("electron", () => ({ app: { isPackaged: false, getPath: () => environment.userData } }));

import { startBuiltinCore, TASK_TOOLS } from "./fixtures/builtin-core.mjs";

const live = {};
afterEach(async () => {
	await live.host?.close();
	delete live.host;
});

function assertWire(messages) {
	let pending = new Set();
	for (const m of messages) {
		if (m.role === "toolResult") {
			expect(pending.has(m.toolCallId), `orphan tool result ${m.toolCallId}`).toBe(true);
			pending.delete(m.toolCallId);
			continue;
		}
		expect(pending.size, `interrupted tool batch before ${m.role}/${m.customType || ""}`).toBe(0);
		if (m.role === "assistant")
			pending = new Set(m.content.filter((b) => b.type === "toolCall").map((b) => b.id));
	}
	expect(pending.size, "incomplete tool batch sent to provider").toBe(0);
}

const checked = (response) => (context) => {
	assertWire(context.messages);
	return response;
};

async function setup(answer) {
	const network = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
		throw new Error("Network forbidden in fixture");
	});
	let asks = 0;
	live.host = await startBuiltinCore({
		root: await realpath(await mkdtemp(join(tmpdir(), "drone-auth-wire-"))),
		setUserData: (path) => {
			environment.userData = path;
		},
		answer: () => {
			asks++;
			return answer();
		},
		backend: {
			projectTrust: true,
			webFetch: false,
			subagentPreferBuiltin: false,
			// Direct SDK construction had no automatic memory summarizer using the model queue.
			harness: { recall: false },
			lazyCapabilities: false,
			tools: ["read", "write", ...TASK_TOOLS],
			desktopIntegration: {
				additionalExtensionPaths: [
					join(import.meta.dirname, "../../../.pi/extensions/obsidian-workbench.mjs"),
				],
			},
		},
	});
	const s = await live.host.open("project");
	expect(s.tools().sort()).toEqual([...TASK_TOOLS].sort());
	return {
		...s,
		backend: live.host.service,
		faux: live.host.faux,
		network,
		// Task authorization is a host dialog; progress decisions are plugin questions.
		asks: () => live.host.dialogs.length + asks,
	};
}

async function prepareTask(session, faux, asks) {
	faux.setResponses([
		checked(
			reply(
				[
					call("task_plan", {
						goal: "Write one bounded result",
						summary: "Write one bounded result",
						writeDirectories: ["."],
						milestones: [{ id: "report", title: "Report", acceptance: { kind: "file", path: "result.md" } }],
					}),
				],
				{ stopReason: "toolUse" },
			),
		),
		checked(reply("Report is not written yet; remaining delivery is result.md.")),
	]);
	await session.prompt("Create a code report file in this project after task authorization.", {
		expandPromptTemplates: false,
	});
	expect(asks()).toBe(1);
	const view = [...session.messages].reverse().find((m) => m.details?.taskView)?.details.taskView;
	const task = view.tasks.find((t) => t.id === view.activeTaskId);
	expect(task.remainingSummary).toContain("剩余 1 项");
	return { view, task };
}

function deliveryResponses(faux) {
	faux.setResponses([
		checked(
			reply([call("write", { path: "result.md", content: "# Delivered\n" })], { stopReason: "toolUse" }),
		),
		checked(reply([call("task_status", {})], { stopReason: "toolUse" })),
		checked(reply("QUICK_DELIVERY_COMPLETE")),
	]);
}

async function assertDelivery({ session, cwd, asks, network }, mode) {
	expect(asks()).toBe(mode === "double" ? 2 : 3);
	expect(session.messages.filter((m) => m.role === "toolResult" && m.toolName === "write")).toHaveLength(1);
	expect(await readFile(join(cwd, "result.md"), "utf8")).toContain("Delivered");
	assertWire(session.messages);
	expect(network).not.toHaveBeenCalled();
}

it.each(["double", "cancel-retry"])(
	"registered command %s completes exactly once",
	async (mode) => {
		let pendingAsk;
		const s = await setup(
			() =>
				new Promise((resolve) => {
					pendingAsk = { resolve };
				}),
		);
		const { backend, faux, session, meta, asks } = s;
		const { task, view } = await prepareTask(session, faux, asks);
		deliveryResponses(faux);
		const command = Buffer.from(
			JSON.stringify({ taskId: task.id, revision: view.revision, action: "progress" }),
		).toString("base64url");
		const submit = () => backend.prompt(meta.sessionId, `/task-action ${command}`).catch((error) => error);
		let first = submit();
		await vi.waitFor(() => expect(pendingAsk).toBeTruthy());
		let second;
		if (mode === "double") {
			second = submit();
			await new Promise((resolve) => setImmediate(resolve));
		} else {
			pendingAsk.resolve(undefined);
			await first;
			expect(faux.state.callCount).toBe(2);
			pendingAsk = null;
			first = submit();
			await vi.waitFor(() => expect(pendingAsk).toBeTruthy());
		}
		pendingAsk.resolve("接着做完剩下的");
		expect(await first).not.toBeInstanceOf(Error);
		if (second) expect(await second).not.toBeInstanceOf(Error);
		await vi.waitFor(() => expect(JSON.stringify(session.messages)).toContain("QUICK_DELIVERY_COMPLETE"), {
			timeout: 5000,
		});
		await assertDelivery(s, mode);
	},
	30000,
);
