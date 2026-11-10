import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxToolCall as call, fauxAssistantMessage as reply } from "@earendil-works/pi-ai";
import { getCurrentSystemPrompt } from "@earendil-works/pi-ai/utils/transcript";
import { afterEach, expect, it, vi } from "vitest";

const environment = vi.hoisted(() => ({ userData: "" }));
vi.mock("electron", () => ({ app: { isPackaged: false, getPath: () => environment.userData } }));

import { startBuiltinCore, TASK_TOOLS } from "./fixtures/builtin-core.mjs";

const live = {};
afterEach(async () => {
	await live.host?.close();
	delete live.host;
});

// The shipped built-in pi-core in its managed runtime, with the real SDK/provider/tool-result transport
// and an in-memory fake model: no paid model or user credentials.
it("real SDK failure → task_status → natural handoff keeps pairing and does not replace the final answer", async () => {
	const network = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
		throw new Error("Network must not run in this fixture");
	});
	live.host = await startBuiltinCore({
		root: await realpath(await mkdtemp(join(tmpdir(), "drone-failure-sdk-"))),
		setUserData: (path) => {
			environment.userData = path;
		},
		backend: {
			projectTrust: true,
			webFetch: false,
			subagentPreferBuiltin: false,
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
	const { faux } = live.host;
	const s = await live.host.open("project");
	expect(s.tools().sort()).toEqual([...TASK_TOOLS].sort());
	let captured;
	const answer =
		"读取 missing.csv 时发现文件不存在，因此还不能分析这份输入；我会先核对文件路径，不重跑其他已完成步骤。";
	faux.setResponses([
		() => reply([call("read", { path: "missing.csv" })], { stopReason: "toolUse" }),
		() => reply([call("task_status", {})], { stopReason: "toolUse" }),
		(context) => {
			captured = context;
			return reply(answer);
		},
	]);
	await s.prompt("读取 missing.csv，并说明任何失败对结果的影响和下一步。");
	expect(faux.state.callCount).toBe(3);
	expect(network).not.toHaveBeenCalled();
	expect(s.errors).toEqual([]);
	expect(captured.messages.some((m) => m.role === "toolResult" && m.toolName === "task_status")).toBe(true);
	const capturedSystemPrompt = getCurrentSystemPrompt(captured.messages || []);
	expect(capturedSystemPrompt).toContain("not a copied task ledger");
	expect(capturedSystemPrompt).toContain("not in the reply");
	expect(capturedSystemPrompt).not.toContain("Explain recovered attempts as history");
	expect(capturedSystemPrompt).toContain("impact not yet known");
	const index = captured.messages.findIndex((m) => m.role === "toolResult" && m.toolName === "read");
	expect(index).toBeGreaterThan(0);
	const result = captured.messages[index];
	expect(result.isError).toBe(true);
	const content = JSON.stringify(result.content);
	// A plain-chat read reaches the file system; the task owner does not refuse it as a write.
	expect(content).not.toContain("No approved task plan");
	expect(content).toContain("task_failure_context");
	expect(content).toContain("missing.csv");
	expect(content).toContain("ENOENT");
	// No custom status can split the assistant(tool_calls) / tool-result pair.
	const previous = captured.messages[index - 1];
	expect(previous.role).toBe("assistant");
	expect(previous.content.some((b) => b.type === "toolCall" && b.id === result.toolCallId)).toBe(true);
	expect(
		s.session.messages.some((m) => m.role === "assistant" && JSON.stringify(m.content).includes(answer)),
	).toBe(true);
}, 30000);
