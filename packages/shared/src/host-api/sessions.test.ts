import { Check } from "typebox/value";
import { describe, expect, it } from "vitest";
import { SessionsContract } from "./sessions";

const methodNames = [
	"createSession",
	"listSessions",
	"listAllSessions",
	"openSession",
	"closeSession",
	"deleteSession",
	"prompt",
	"abort",
	"retry",
	"setModel",
	"setThinkingLevel",
	"compact",
	"getStats",
	"getContextUsage",
	"clearQueue",
	"getFollowUpMessages",
	"listSlashCommands",
	"listSlashCommandsForCwd",
	"setSessionName",
	"exportSession",
	"forkSession",
	"recallMessage",
	"getLoadedResources",
	"getSessionMessages",
	"peekSubagentMessages",
	"steerSubagent",
	"replySubagentSupervisor",
	"getTodos",
	"listModels",
	"listProjectFiles",
	"ensureProjectTrust",
] as const;

describe("SessionsContract", () => {
	it("covers every session IPC method with the stable backend method name", () => {
		expect(Object.keys(SessionsContract.methods).sort()).toEqual([...methodNames].sort());
	});

	it("enforces tuple arity and primitive argument constraints", () => {
		expect(Check(SessionsContract.methods.createSession.args, [{ cwd: "/tmp/project" }])).toBe(true);
		expect(Check(SessionsContract.methods.createSession.args, [{ cwd: "" }])).toBe(false);
		expect(Check(SessionsContract.methods.listSessions.args, [])).toBe(true);
		expect(Check(SessionsContract.methods.listSessions.args, ["/tmp/project"])).toBe(true);
		expect(Check(SessionsContract.methods.listSessions.args, ["/tmp/project", "extra"])).toBe(false);
		expect(Check(SessionsContract.methods.deleteSession.args, ["session-1"])).toBe(true);
		expect(Check(SessionsContract.methods.deleteSession.args, ["session-1", "/tmp/session.jsonl"])).toBe(
			true,
		);
		expect(Check(SessionsContract.methods.deleteSession.args, ["session-1", ""])).toBe(false);
		expect(Check(SessionsContract.methods.retry.args, ["session-1", "request-1", 42])).toBe(true);
		expect(Check(SessionsContract.methods.retry.args, ["session-1", "request-1", "42"])).toBe(false);
		expect(Check(SessionsContract.methods.exportSession.args, ["session-1", "html"])).toBe(true);
		expect(Check(SessionsContract.methods.exportSession.args, ["session-1", "markdown"])).toBe(false);
		expect(Check(SessionsContract.methods.steerSubagent.args, ["session-1", "continue"])).toBe(true);
		expect(Check(SessionsContract.methods.steerSubagent.args, ["session-1", "continue", "followUp"])).toBe(
			true,
		);
		expect(Check(SessionsContract.methods.steerSubagent.args, ["session-1", "continue", "invalid"])).toBe(
			false,
		);
	});
});
