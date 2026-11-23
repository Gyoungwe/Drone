#!/usr/bin/env node
/**
 * The one Claude Code hook entry for the Jev harness; `hook_event_name` picks the decision point:
 *   PreToolUse       permission policy, then routing of check commands through the output ladder
 *   PostToolUse      path-bound context rules for the file just read or edited
 *   SessionStart     after compact/clear, forget which rules were shown so they come back
 *   UserPromptSubmit name the UI skills only for UI prompts
 * A hook that throws fails open: the tool call proceeds and the error is surfaced as a system message.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { routeCommand, squeezable } from "./command-route.mjs";
import { selectRules } from "./context-rules.mjs";
import { decision, record, STATE_DIR } from "./decision.mjs";
import { locate } from "./paths.mjs";
import { decidePermission } from "./permission-policy.mjs";
import { skillHint } from "./skill-hints.mjs";

const RUNNER = fileURLToPath(new URL("./jev-run.mjs", import.meta.url));
const WRITE_TOOLS = new Set(["Edit", "Write", "MultiEdit"]);

const seenFile = (session) => path.join(STATE_DIR, "seen", `${String(session).replace(/[^\w-]/g, "_")}.json`);
const output = (event, fields) => ({ hookSpecificOutput: { hookEventName: event, ...fields } });

function preToolUse(input) {
	const verdict = decidePermission(input, { locate, exists: existsSync });
	if (verdict !== null) {
		record(STATE_DIR, { ...verdict, tool: input.tool_name });
		return output("PreToolUse", {
			permissionDecision: verdict.answer,
			permissionDecisionReason: `[jev] ${verdict.rule}: AGENTS.md 红线规则拦截（见 .claude/jev/README.md）。`,
		});
	}
	const command = input.tool_name === "Bash" ? String(input.tool_input.command ?? "") : "";
	if (!squeezable(command)) return null;
	record(STATE_DIR, { ...decision("output", "route", "check-command"), command });
	return output("PreToolUse", {
		permissionDecision: "allow",
		permissionDecisionReason: "[jev] 只读检查命令，经输出阶梯运行。",
		updatedInput: { ...input.tool_input, command: routeCommand(command, RUNNER) },
	});
}

function lineCount(file) {
	if (!existsSync(file)) return 0;
	return readFileSync(file, "utf8").split("\n").length;
}

function postToolUse(input) {
	const file = input.tool_input?.file_path;
	if (typeof file !== "string") return null;
	const mode = WRITE_TOOLS.has(input.tool_name) ? "write" : "read";
	const store = seenFile(input.session_id);
	const seen = existsSync(store) ? JSON.parse(readFileSync(store, "utf8")) : {};
	const { key } = locate(file);
	const picked = selectRules({ key, mode, lines: lineCount(file) }, seen);
	if (picked.length === 0) return null;
	for (const rule of picked) seen[rule.id] = rule.level;
	mkdirSync(path.dirname(store), { recursive: true });
	writeFileSync(store, JSON.stringify(seen));
	const level = mode === "write" ? "long" : "short";
	record(STATE_DIR, { ...decision("context", level, picked.map((rule) => rule.id).join(",")), key });
	const text = picked.map((rule) => `[jev] ${rule.text}`).join("\n");
	return output("PostToolUse", { additionalContext: text });
}

function sessionStart(input) {
	if (input.source !== "compact" && input.source !== "clear") return null;
	rmSync(seenFile(input.session_id), { force: true });
	record(STATE_DIR, { ...decision("context", "reset", `session-${input.source}`) });
	return null;
}

function userPromptSubmit(input) {
	const hint = skillHint(String(input.prompt ?? ""));
	if (hint === null) return null;
	const { text, ...entry } = hint;
	record(STATE_DIR, entry);
	return output("UserPromptSubmit", { additionalContext: text });
}

const HANDLERS = {
	PreToolUse: preToolUse,
	PostToolUse: postToolUse,
	SessionStart: sessionStart,
	UserPromptSubmit: userPromptSubmit,
};

function readStdin() {
	return readFileSync(0, "utf8");
}

try {
	const input = JSON.parse(readStdin());
	const result = HANDLERS[input.hook_event_name]?.(input) ?? null;
	if (result !== null) process.stdout.write(JSON.stringify(result));
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	process.stdout.write(JSON.stringify({ systemMessage: `[jev] hook failed open: ${message}` }));
}
