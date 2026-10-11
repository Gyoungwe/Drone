import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { externalEffectKey } from "../../compute/src/jobs/idempotency";

/**
 * Process-boundary regression test for the durable session contract.
 *
 * The existing module tests exercise each journal/inbox primitive in one
 * process. This fixture deliberately kills a child after it has persisted a
 * tool intent, queued a request, and committed an external effect. A fresh
 * child then reopens the same files and must repair the dangling transcript,
 * drain the inbox once, and refuse to create a second external effect for the
 * same idempotency key.
 */
const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function runChild(script: string, args: string[]) {
	const path = join(dirs[0] as string, `${args[0]}.mjs`);
	writeFileSync(path, script);
	const viteNode = resolve(__dirname, "../../../node_modules/vite-node/vite-node.mjs");
	return spawnSync(process.execPath, [viteNode, path, ...args.slice(1)], {
		encoding: "utf8",
	});
}

describe("durable session process recovery", () => {
	it("reopens after SIGKILL without replaying a committed external effect", () => {
		const dir = mkdtempSync(join(tmpdir(), "drone-session-crash-"));
		dirs.push(dir);
		const journalModule = pathToFileURL(resolve(__dirname, "../src/session/intent-journal.ts")).href;
		const interruptedModule = pathToFileURL(resolve(__dirname, "../src/session/interrupted-tools.ts")).href;
		const inboxModule = pathToFileURL(resolve(__dirname, "../src/session/durable-inbox.ts")).href;
		const agentModule = pathToFileURL(
			resolve(__dirname, "../../../node_modules/@earendil-works/pi-coding-agent/dist/index.js"),
		).href;
		const effectKey = externalEffectKey("knowledge.ingest", { project: "fixture", title: "结论" });
		const state = JSON.stringify({
			dir,
			journalModule,
			interruptedModule,
			inboxModule,
			agentModule,
			effectKey,
		});

		const crash = runChild(
			`import { writeFileSync, readFileSync } from "node:fs";
const state = JSON.parse(process.argv[2]);
const { SessionManager } = await import(state.agentModule);
const { ToolIntentJournal, intentJournalPath } = await import(state.journalModule);
const { DurableInbox, inboxPath } = await import(state.inboxModule);
const manager = SessionManager.create(state.dir, state.dir, { id: "fixture" });
const sessionFile = manager.getSessionFile();
if (!sessionFile) throw new Error("session manager did not allocate a session file");
writeFileSync(state.dir + "/session-path", sessionFile);
manager.appendMessage({ role: "user", content: "继续研究", timestamp: 1 });
manager.appendMessage({ role: "assistant", content: [
  { type: "toolCall", id: "safe-1", name: "read", arguments: { path: "evidence.md" } },
  { type: "toolCall", id: "unsafe-1", name: "research_write", arguments: { title: "结论" } },
], api: "fixture", provider: "fixture", model: "fixture", usage: {
  input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
}, stopReason: "toolUse", timestamp: 2 });
const journal = new ToolIntentJournal(intentJournalPath(sessionFile));
journal.start({ toolCallId: "safe-1", toolName: "read", args: { path: "evidence.md" }, replay: "safe" });
journal.start({ toolCallId: "unsafe-1", toolName: "research_write", args: { title: "结论" }, replay: "unsafe" });
journal.output("unsafe-1", "已写入远端，等待确认");
const inbox = new DurableInbox(inboxPath(sessionFile));
inbox.accept("继续整理", "request-1");
const key = state.effectKey;
writeFileSync(state.dir + "/effects.json", JSON.stringify([{ key }]) + "\\n");
process.kill(process.pid, "SIGKILL");`,
			["crash", state],
		);
		if (process.platform !== "win32") expect(crash.signal, crash.stderr || crash.stdout).toBe("SIGKILL");

		const recover = runChild(
			`import { readFileSync, writeFileSync } from "node:fs";
const state = JSON.parse(process.argv[2]);
const { SessionManager } = await import(state.agentModule);
const { repairInterruptedToolCalls } = await import(state.interruptedModule);
const { DurableInbox, inboxPath } = await import(state.inboxModule);
const sessionFile = readFileSync(state.dir + "/session-path", "utf8");
const manager = SessionManager.open(sessionFile);
const repaired = repairInterruptedToolCalls(manager, (name) => name === "read" ? "safe" : "unsafe", () => 9);
const inbox = new DurableInbox(inboxPath(sessionFile));
const drained = inbox.drain();
const key = state.effectKey;
const effectsPath = state.dir + "/effects.json";
const effects = JSON.parse(readFileSync(effectsPath, "utf8"));
if (!effects.some((entry) => entry.key === key)) effects.push({ key });
writeFileSync(effectsPath, JSON.stringify(effects) + "\\n");
writeFileSync(state.dir + "/recovery.json", JSON.stringify({
  repaired: repaired.map((call) => ({ id: call.toolCallId, started: call.started, replay: call.replay, partial: call.partialOutput ?? null })),
  drained: drained.map((item) => item.requestId),
  effectCount: effects.length,
}));`,
			["recover", state],
		);
		expect(recover.status).toBe(0);
		const first = JSON.parse(readFileSync(join(dir, "recovery.json"), "utf8"));
		expect(first.repaired).toEqual([
			{ id: "safe-1", started: true, replay: "safe", partial: null },
			{ id: "unsafe-1", started: true, replay: "unsafe", partial: "已写入远端，等待确认" },
		]);
		expect(first.drained).toEqual(["request-1"]);
		expect(first.effectCount).toBe(1);

		// A second process restart must see the synthesized tool results and the
		// delivered request, so neither recovery nor the external effect repeats.
		const second = runChild(
			`import { readFileSync, writeFileSync } from "node:fs";
const state = JSON.parse(process.argv[2]);
const { SessionManager } = await import(state.agentModule);
const { repairInterruptedToolCalls } = await import(state.interruptedModule);
const { DurableInbox, inboxPath } = await import(state.inboxModule);
const sessionFile = readFileSync(state.dir + "/session-path", "utf8");
const repaired = repairInterruptedToolCalls(SessionManager.open(sessionFile), (name) => name === "read" ? "safe" : "unsafe");
const drained = new DurableInbox(inboxPath(sessionFile)).drain();
const key = state.effectKey;
const effectsPath = state.dir + "/effects.json";
const effects = JSON.parse(readFileSync(effectsPath, "utf8"));
if (!effects.some((entry) => entry.key === key)) effects.push({ key });
writeFileSync(effectsPath, JSON.stringify(effects) + "\\n");
writeFileSync(state.dir + "/recovery.json", JSON.stringify({ repaired: repaired.length, drained: drained.length, effectCount: effects.length }));`,
			["recover-again", state],
		);
		expect(second.status).toBe(0);
		expect(JSON.parse(readFileSync(join(dir, "recovery.json"), "utf8"))).toEqual({
			repaired: 0,
			drained: 0,
			effectCount: 1,
		});
	}, 20_000);
});
