import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { intentJournalPath, ToolIntentJournal } from "../src/session/intent-journal";
import {
	AUTO_RESUME_WINDOW_MS,
	findDanglingToolCalls,
	repairInterruptedToolCalls,
	shouldAutoResume,
} from "../src/session/interrupted-tools";
import { SessionRecovery } from "../src/session/recovery";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function crashedSession() {
	const dir = mkdtempSync(join(tmpdir(), "drone-interrupted-"));
	dirs.push(dir);
	const manager = SessionManager.create(dir, dir);
	manager.appendMessage({ role: "user", content: "跑一下", timestamp: 1 } as never);
	manager.appendMessage({
		role: "assistant",
		content: [
			{ type: "toolCall", id: "c-read", name: "read", arguments: { path: "a.txt" } },
			{ type: "toolCall", id: "c-bash", name: "bash", arguments: { command: "deploy" } },
			{ type: "toolCall", id: "c-never", name: "write", arguments: { path: "b" } },
		],
		api: "faux",
		provider: "faux",
		model: "faux",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "toolUse",
		timestamp: 2,
	} as never);
	const file = manager.getSessionFile() as string;
	const journal = new ToolIntentJournal(intentJournalPath(file));
	journal.start({ toolCallId: "c-read", toolName: "read", args: { path: "a.txt" }, replay: "safe" });
	journal.start({ toolCallId: "c-bash", toolName: "bash", args: { command: "deploy" }, replay: "unsafe" });
	journal.output("c-bash", "step 1/10\nstep 2/10\n");
	return file;
}

describe("interrupted tool repair on reopen", () => {
	it("synthesizes results: safe → rerun, unsafe → may have partially run with partial output", () => {
		const file = crashedSession();
		const reopened = SessionManager.open(file);
		const repaired = repairInterruptedToolCalls(
			reopened as never,
			(n) => (n === "read" ? "safe" : "unsafe"),
			() => 9,
		);
		expect(repaired.map((c) => [c.toolCallId, c.started, c.replay])).toEqual([
			["c-read", true, "safe"],
			["c-bash", true, "unsafe"],
			["c-never", false, "unsafe"],
		]);
		expect(repaired[0].args).toEqual({ path: "a.txt" });

		const messages = SessionManager.open(file).buildSessionContext().messages as {
			role: string;
			toolCallId?: string;
			isError?: boolean;
			content?: { text?: string }[];
		}[];
		const results = messages.filter((m) => m.role === "toolResult");
		expect(results.map((m) => m.toolCallId)).toEqual(["c-read", "c-bash", "c-never"]);
		expect(results.every((m) => m.isError)).toBe(true);
		const bash = results[1].content?.[0]?.text ?? "";
		expect(bash).toContain("may have partially run");
		expect(bash).toContain("step 2/10");
		expect(results[2].content?.[0]?.text).toContain("尚未开始执行");
		// Idempotent: a second reopen finds nothing left to repair.
		expect(repairInterruptedToolCalls(SessionManager.open(file) as never, () => "unsafe")).toEqual([]);
	});

	it("ignores finished turns and turns after a newer user message", () => {
		expect(findDanglingToolCalls([])).toEqual([]);
		expect(
			findDanglingToolCalls([
				{
					type: "message",
					message: { role: "assistant", content: [{ type: "toolCall", id: "x", name: "bash" }] },
				},
				{ type: "message", message: { role: "toolResult", toolCallId: "x" } },
			]),
		).toEqual([]);
		expect(
			findDanglingToolCalls([
				{
					type: "message",
					message: { role: "assistant", content: [{ type: "toolCall", id: "x", name: "bash" }] },
				},
				{ type: "message", message: { role: "user", content: "hi" } },
			]),
		).toEqual([]);
	});

	it("auto-resumes only recent, started, replay-safe calls", () => {
		const now = 10 * AUTO_RESUME_WINDOW_MS;
		const call = {
			toolCallId: "a",
			toolName: "read",
			started: true,
			replay: "safe" as const,
			startedAt: now - 1000,
		};
		expect(shouldAutoResume([call], now)).toBe(true);
		expect(shouldAutoResume([{ ...call, replay: "unsafe" }], now)).toBe(false);
		expect(shouldAutoResume([{ ...call, started: false }], now)).toBe(false);
		expect(shouldAutoResume([{ ...call, startedAt: now - AUTO_RESUME_WINDOW_MS - 1 }], now)).toBe(false);
	});
});

describe("SessionRecovery.resumeInterrupted", () => {
	it("allows only recovery-safe tools plus the safe tool being replayed, then restores tools", async () => {
		let active = ["read", "bash", "set_status", "webfetch"];
		const sent: { content: string; details: Record<string, unknown> }[] = [];
		const session = {
			sessionId: "s1",
			isIdle: true,
			pendingMessageCount: 0,
			getActiveToolNames: () => active,
			setActiveToolsByName: vi.fn((names: string[]) => {
				active = names;
			}),
			getToolDefinition: () => undefined,
			getAllTools: () => [],
			sendCustomMessage: vi.fn(async (message: { content: string; details: Record<string, unknown> }) => {
				sent.push(message);
				expect(active.sort()).toEqual(["read", "set_status"]);
			}),
			waitForIdle: async () => {},
		};
		const recovery = new SessionRecovery();
		await recovery.resumeInterrupted(session as never, [
			{ toolCallId: "c-read", toolName: "read", started: true, replay: "safe", args: { path: "a" } },
			{ toolCallId: "c-bash", toolName: "bash", started: true, replay: "unsafe" },
		]);
		expect(sent[0].content).toContain('read {"path":"a"}');
		expect(sent[0].content).toContain("不要重做");
		expect(sent[0].details).toMatchObject({ mode: "interrupted-tool-recovery" });
		expect(active).toEqual(["read", "bash", "set_status", "webfetch"]);
		expect(recovery.isRecovering("s1")).toBe(false);
	});
});
