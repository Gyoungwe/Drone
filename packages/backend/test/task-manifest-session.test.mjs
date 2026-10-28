import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createEventBus } from "@earendil-works/pi-coding-agent";
import { build } from "esbuild";
import { afterEach, expect, it, vi } from "vitest";
import { createStandaloneRuntime, withRuntime } from "../../extensions/src/internal/runtime/runtime-bridge";
import { isReadOnlyTool } from "../../extensions/src/internal/runtime/tool-manifest";
import { registerTaskRuntime } from "./fixtures/task-plugin.mjs";

const runtimes = [];
const directories = [];
afterEach(async () => {
	vi.unstubAllEnvs();
	await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()));
	await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function host(id) {
	const hooks = new Map();
	const runtime = createStandaloneRuntime();
	runtimes.push(runtime);
	const events = createEventBus();
	const pi = {
		events,
		registerTool() {},
		getAllTools: () => [],
		registerCommand() {},
		getCommands: () => [],
		appendEntry() {},
		sendMessage() {},
		on(name, handler) {
			hooks.set(name, [...(hooks.get(name) || []), handler]);
		},
	};
	const journal = await registerTaskRuntime(pi);
	const ctx = {
		cwd: tmpdir(),
		sessionManager: { getSessionId: () => id, getSessionFile: () => undefined, getBranch: () => [] },
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
	const directory = await mkdtemp(join(tmpdir(), "drone-task-manifest-bundle-"));
	directories.push(directory);
	const bundle = join(directory, "knowledge.mjs");
	await build({
		entryPoints: [createRequire(import.meta.url).resolve("@drone/extensions/knowledge-extension")],
		outfile: bundle,
		bundle: true,
		platform: "node",
		format: "esm",
		logLevel: "silent",
	});
	const { registerKnowledgeInterface } = await import(/* @vite-ignore */ pathToFileURL(bundle).href);
	const first = await host("knowledge-session");
	const other = await host("unrelated-session");
	// Load the real independently bundled knowledge extension before the inline
	// host announces its runtime, matching Desktop's extension initialization.
	registerKnowledgeInterface({ ...first.pi, on() {} }, { readOnly: true });
	for (const current of [first, other]) {
		current.pi.events.on("drone:runtime/request/v1", () =>
			current.pi.events.emit("drone:runtime/v1", { version: 1, runtime: current.runtime }),
		);
		current.pi.events.emit("drone:runtime/v1", { version: 1, runtime: current.runtime });
		await current.emit("session_start", {});
		await current.journal.plan({
			goal: "Read sources",
			summary: "Read and inspect",
			milestones: [{ id: "review", title: "Review", acceptance: { kind: "human_review" } }],
		});
		await current.journal.command({
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
