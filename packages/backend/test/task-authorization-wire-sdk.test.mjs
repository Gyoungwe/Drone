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

async function setup(approved) {
	const network = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
		throw new Error("Network forbidden in fixture");
	});
	let asks = 0;
	live.host = await startBuiltinCore({
		root: await realpath(await mkdtemp(join(tmpdir(), "drone-auth-wire-"))),
		setUserData: (path) => {
			environment.userData = path;
		},
		approve: () => approved,
		answer: () => {
			asks++;
			return undefined;
		},
		backend: {
			projectTrust: true,
			webFetch: false,
			subagentPreferBuiltin: false,
			// The original SDK setup did not share its model queue with the memory summarizer.
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
		faux: live.host.faux,
		network,
		// Task authorization uses the host dialog; any plugin question is another decision.
		asks: () => live.host.dialogs.length + asks,
	};
}

function taskResponses(approved) {
	return [
		checked(
			reply(
				[
					call("task_plan", {
						goal: "Write one bounded result",
						summary: "Write one bounded result",
						writeDirectories: ["."],
						milestones: [{ id: "report", title: "Report", acceptance: { kind: "file", path: "result.md" } }],
					}),
					call("task_status", {}),
				],
				{ stopReason: "toolUse" },
			),
		),
		...(approved
			? [
					checked(
						reply(
							[
								call("write", {
									path: "result.md",
									content: "# Result\nCompleted within approved scope.\n",
								}),
							],
							{ stopReason: "toolUse" },
						),
					),
					checked(reply([call("task_status", {})], { stopReason: "toolUse" })),
				]
			: []),
		checked(reply(approved ? "DELIVERED result.md" : "DECLINED; no file written")),
	];
}

async function assertLegacyRepair({ session, faux, asks }) {
	// Seed the exact legacy interleaving and verify the next provider context is repaired.
	const history = session.agent.state.messages;
	const statusIndex = history.findIndex((m) => m.role === "custom" && m.details?.taskView);
	expect(statusIndex).toBeGreaterThanOrEqual(0);
	const [legacyStatus] = history.splice(statusIndex, 1);
	expect(legacyStatus.customType).toBe(`plugin-notice:${encodeURIComponent(live.host.core.source.pluginId)}`);
	const resultIndex = history.findIndex((m) => m.role === "toolResult");
	history.splice(resultIndex, 0, legacyStatus);
	let recovered = false;
	faux.setResponses([
		(context) => {
			assertWire(context.messages);
			recovered = true;
			return reply("Existing report explained without changes.");
		},
	]);
	await session.prompt("Explain the existing result.md without changing files.", {
		expandPromptTemplates: false,
	});
	expect(recovered).toBe(true);
	expect(asks()).toBe(1);
	expect(session.messages.filter((m) => m.role === "toolResult" && m.toolName === "write")).toHaveLength(1);
}

async function assertContinuation(s) {
	const { session, faux, asks } = s;
	faux.setResponses([checked(reply("Continuation needs no repeated write."))]);
	await session.prompt("继续", { expandPromptTemplates: false });
	assertWire(session.messages);
	expect(asks()).toBe(1);
	expect(session.messages.filter((m) => m.role === "toolResult" && m.toolName === "write")).toHaveLength(1);
	// A completed task is not silently reopened by "continue": the turn is answered as
	// ordinary conversation, and crucially no second authorization and no second write happen.
	expect(faux.state.callCount).toBe(5);
	expect(session.messages.filter((m) => m.role === "toolResult" && m.toolName === "write")).toHaveLength(1);
	await assertLegacyRepair(s);
}

it.each([
	{ approved: true, mode: "sequential" },
	{ approved: false, mode: "sequential" },
	{ approved: true, mode: "parallel" },
	{ approved: false, mode: "parallel" },
])(
	"real SDK one host authorization decision → valid wire → delivery, approved=$approved mode=$mode",
	async ({ approved, mode }) => {
		const s = await setup(approved);
		const { session, cwd, faux, asks, network } = s;
		session.agent.toolExecution = mode;
		faux.setResponses(taskResponses(approved));
		await session.prompt("Create a code report file in this project after asking for task authorization.", {
			expandPromptTemplates: false,
		});
		assertWire(session.messages);
		expect(asks()).toBe(1);
		const plan = session.messages.find((m) => m.role === "toolResult" && m.toolName === "task_plan");
		expect(plan.content[0].text).toContain(`"authorized":${approved}`);
		expect(faux.state.callCount).toBe(approved ? 4 : 2);
		expect(JSON.stringify(session.messages)).toContain(
			approved ? "DELIVERED result.md" : "DECLINED; no file written",
		);
		expect(network).not.toHaveBeenCalled();
		if (approved) expect(await readFile(join(cwd, "result.md"), "utf8")).toContain("Completed");
		else await expect(readFile(join(cwd, "result.md"))).rejects.toMatchObject({ code: "ENOENT" });
		if (approved) await assertContinuation(s);
	},
	30000,
);
