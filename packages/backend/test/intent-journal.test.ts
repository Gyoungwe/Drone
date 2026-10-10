import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	createIntentObserver,
	hashArgs,
	intentJournalPath,
	readIntentRecords,
	summarizeIntents,
	ToolIntentJournal,
} from "../src/session/intent-journal";
import { CORE_TOOL_META, replayPolicyOf, ToolManifest } from "../src/tools/manifest";

const dirs: string[] = [];
const tmp = () => {
	const dir = mkdtempSync(join(tmpdir(), "drone-intent-"));
	dirs.push(dir);
	return dir;
};
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("replay policy", () => {
	it("defaults side-effecting tools to unsafe and read-only tools to safe", () => {
		expect(replayPolicyOf(undefined)).toBe("unsafe");
		expect(replayPolicyOf({ readOnly: true })).toBe("safe");
		expect(replayPolicyOf({ recoverySafe: true })).toBe("safe");
		expect(replayPolicyOf({ readOnly: true, replay: "unsafe" })).toBe("unsafe");
		const manifest = new ToolManifest();
		expect(manifest.replayPolicy("bash")).toBe("unsafe");
		expect(manifest.replayPolicy("write")).toBe("unsafe");
		expect(manifest.replayPolicy("read")).toBe("safe");
		expect(manifest.replayPolicy("set_status")).toBe("safe");
		expect(manifest.replayPolicy("some_unknown_mcp_tool")).toBe("unsafe");
		expect(new ToolManifest().replayPolicy("subagent")).toBe("unsafe");
		expect(CORE_TOOL_META.subagent?.replay).toBeUndefined();
	});

	it("reads declared replay from a registration", () => {
		const manifest = new ToolManifest({
			getToolDefinition: (name) => (name === "zotero_search" ? { drone: { replay: "safe" } } : undefined),
		});
		expect(manifest.replayPolicy("zotero_search")).toBe("safe");
	});
});

describe("tool intent journal", () => {
	it("hashes args independent of key order", () => {
		expect(hashArgs({ a: 1, b: [1, { c: 2, d: 3 }] })).toBe(hashArgs({ b: [1, { d: 3, c: 2 }], a: 1 }));
		expect(hashArgs({ a: 1 })).not.toBe(hashArgs({ a: 2 }));
	});

	it("records start before end and keeps args only for safe tools", () => {
		const file = join(tmp(), "s.jsonl");
		const journal = new ToolIntentJournal(intentJournalPath(file), () => 42);
		const observe = createIntentObserver(journal, (name) => (name === "read" ? "safe" : "unsafe"));
		observe({ type: "tool_execution_start", toolCallId: "c1", toolName: "read", args: { path: "a" } });
		observe({ type: "tool_execution_start", toolCallId: "c2", toolName: "bash", args: { command: "rm x" } });
		observe({ type: "tool_execution_end", toolCallId: "c1", isError: false });
		const records = readIntentRecords(intentJournalPath(file));
		expect(records.map((r) => `${r.kind}:${r.toolCallId}`)).toEqual(["start:c1", "start:c2", "end:c1"]);
		const calls = summarizeIntents(records);
		expect(calls.get("c1")).toMatchObject({
			ended: true,
			start: { replay: "safe", args: { path: "a" }, ts: 42 },
		});
		expect(calls.get("c2")?.ended).toBe(false);
		expect(calls.get("c2")?.start.args).toBeUndefined();
		expect(calls.get("c2")?.start.argsHash).toBe(hashArgs({ command: "rm x" }));
	});

	it("tolerates a torn last line", () => {
		const path = intentJournalPath(join(tmp(), "s.jsonl"));
		new ToolIntentJournal(path).start({ toolCallId: "c1", toolName: "bash", args: {}, replay: "unsafe" });
		writeFileSync(path, `${readFileSync(path, "utf8")}{"v":1,"kind":"end","toolCa`);
		expect(readIntentRecords(path)).toHaveLength(1);
	});

	it("never throws into the session when the journal cannot be written", () => {
		const errors: unknown[] = [];
		const journal = new ToolIntentJournal(join(tmp(), "\0bad", "x"));
		const observe = createIntentObserver(
			journal,
			() => "unsafe",
			(e) => errors.push(e),
		);
		expect(() =>
			observe({ type: "tool_execution_start", toolCallId: "c", toolName: "bash", args: {} }),
		).not.toThrow();
		expect(errors).toHaveLength(1);
	});

	it("survives SIGKILL of the writing process mid-tool", () => {
		const dir = tmp();
		const path = intentJournalPath(join(dir, "s.jsonl"));
		const script = join(dir, "child.mjs");
		const mod = resolve(__dirname, "../src/session/intent-journal.ts");
		writeFileSync(
			script,
			`const { ToolIntentJournal } = await import(${JSON.stringify(mod)});
new ToolIntentJournal(${JSON.stringify(path)}).start({ toolCallId: "k1", toolName: "bash", args: { command: "deploy" }, replay: "unsafe" });
process.kill(process.pid, "SIGKILL");`,
		);
		const child = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", script], {
			encoding: "utf8",
		});
		expect(child.stderr).not.toMatch(/Error/);
		if (process.platform !== "win32") expect(child.signal).toBe("SIGKILL");
		const calls = summarizeIntents(readIntentRecords(path));
		expect(calls.get("k1")).toMatchObject({ ended: false, start: { toolName: "bash", replay: "unsafe" } });
	});
});

describe("partial output flushing", () => {
	it("throttles cumulative output and keeps the newest tail for recovery", () => {
		const file = join(tmp(), "s.jsonl");
		let clock = 0;
		const journal = new ToolIntentJournal(intentJournalPath(file), () => clock);
		const observe = createIntentObserver(journal, () => "unsafe", {
			outputIntervalMs: 1000,
			now: () => clock,
		});
		const update = (text: string) =>
			observe({
				type: "tool_execution_update",
				toolCallId: "b",
				partialResult: { content: [{ type: "text", text }] },
			});
		observe({ type: "tool_execution_start", toolCallId: "b", toolName: "bash", args: {} });
		update("line 1\n");
		clock = 500;
		update("line 1\nline 2\n"); // throttled
		clock = 1500;
		update("line 1\nline 2\nline 3\n");
		clock = 3000;
		update("line 1\nline 2\nline 3\n"); // unchanged → skipped
		const records = readIntentRecords(intentJournalPath(file));
		expect(records.filter((r) => r.kind === "output")).toHaveLength(2);
		expect(summarizeIntents(records).get("b")?.partialOutput).toBe("line 1\nline 2\nline 3\n");
	});

	it("clips very long output to the tail", () => {
		const file = join(tmp(), "s.jsonl");
		const observe = createIntentObserver(new ToolIntentJournal(intentJournalPath(file)), () => "unsafe");
		observe({ type: "tool_execution_start", toolCallId: "b", toolName: "bash", args: {} });
		observe({
			type: "tool_execution_update",
			toolCallId: "b",
			partialResult: { content: [{ type: "text", text: `${"x".repeat(40000)}END` }] },
		});
		const out = summarizeIntents(readIntentRecords(intentJournalPath(file))).get("b")?.partialOutput ?? "";
		expect(out.length).toBe(16 * 1024);
		expect(out.endsWith("END")).toBe(true);
	});
});
