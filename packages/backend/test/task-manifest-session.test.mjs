import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerKnowledgeInterface } from "@drone/extensions/knowledge-extension";
import { registerTaskRuntime } from "@drone/tasks/runtime";
import { createStandaloneRuntime, withRuntime } from "@drone/tasks/runtime-bridge";
import { isReadOnlyTool } from "@drone/tasks/tool-manifest-runtime";
import { createEventBus } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, it, vi } from "vitest";

const runtimes = [];
afterEach(async () => {
	vi.unstubAllEnvs();
	await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()));
});

function host(id) {
	const hooks = new Map();
	const runtime = createStandaloneRuntime();
	runtimes.push(runtime);
	const events = createEventBus();
	const pi = {
		events,
		registerTool() {},
		registerCommand() {},
		getCommands: () => [],
		appendEntry() {},
		sendMessage() {},
		on(name, handler) {
			hooks.set(name, [...(hooks.get(name) || []), handler]);
		},
	};
	const journal = registerTaskRuntime(pi);
	const ctx = {
		cwd: tmpdir(),
		sessionManager: { getSessionId: () => id, getBranch: () => [] },
	};
	const emit = async (name, event) => {
		const results = [];
		for (const hook of hooks.get(name) || []) results.push(await hook(event, ctx));
		return results;
	};
	return { pi, journal, runtime, emit };
}

it("repeats declared knowledge reads across turns without replaying effects or borrowing another session's manifest", async () => {
	vi.stubEnv("DRONE_KNOWLEDGE_DIR", join(tmpdir(), "drone-task-manifest-test"));
	const first = host("knowledge-session");
	const other = host("unrelated-session");
	// Load the real independently bundled knowledge extension before the inline
	// host announces its runtime, matching Desktop's extension initialization.
	registerKnowledgeInterface({ ...first.pi, on() {} }, { readOnly: true });
	for (const current of [first, other]) {
		current.pi.events.on("drone:runtime/request/v1", () =>
			current.pi.events.emit("drone:runtime/v1", { version: 1, runtime: current.runtime }),
		);
		current.pi.events.emit("drone:runtime/v1", { version: 1, runtime: current.runtime });
		await current.emit("session_start", {});
		current.journal.plan({
			goal: "Read sources",
			summary: "Read and inspect",
			milestones: [{ id: "review", title: "Review", acceptance: { kind: "human_review" } }],
		});
		current.journal.command({
			action: "authorize-task",
			taskId: current.journal.snapshot().id,
			revision: current.journal.view().revision,
		});
	}
	const name = "research_prepare_knowledge";
	expect(withRuntime(first.runtime, () => isReadOnlyTool(name))).toBe(true);
	expect(withRuntime(other.runtime, () => isReadOnlyTool(name))).toBe(false);
	for (const current of [first, other]) {
		const call = { toolName: name, toolCallId: "first", input: {} };
		expect(await current.emit("tool_call", call)).toEqual([undefined]);
		await current.emit("tool_result", { ...call, isError: false, content: [], details: {} });
		await current.emit("input", { text: "continue" });
		const repeated = await current.emit("tool_call", { ...call, toolCallId: "second" });
		if (current === first) expect(repeated).toEqual([undefined]);
		else
			expect(repeated).toEqual([
				expect.objectContaining({ block: true, reason: expect.stringContaining("idempotency-check") }),
			]);
	}
});
