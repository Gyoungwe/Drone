import { Check } from "typebox/value";
import { describe, expect, it } from "vitest";
import { channelOf } from "./define";
import { SubagentsContract } from "./subagents";

const run = {
	runId: "run-1",
	dispatchId: "dispatch-1",
	parentSessionId: "session-1",
	agent: "scout",
	source: "builtin",
	task: "Inspect the repository",
	cwd: "/tmp/project",
	requiredTools: ["read"],
	followUp: true,
	status: "running",
	contextState: "none",
	queuePosition: 1,
	createdAt: 1_700_000_000_000,
	startedAt: 1_700_000_000_001,
	childSessionId: "child-1",
	sessionFile: "/tmp/project/sessions-subagents/child-1.jsonl",
	model: "provider/model",
	tokens: 12,
	statusText: "Reading",
	statusPhase: "tool",
	currentAction: "read",
	currentTool: "read_file",
	pendingApprovalIds: [],
};

describe("SubagentsContract", () => {
	it("keeps the four legacy subagent panel channels", () => {
		expect(channelOf(SubagentsContract, "list")).toBe("subagents:list");
		expect(channelOf(SubagentsContract, "dispatch")).toBe("subagents:dispatch");
		expect(channelOf(SubagentsContract, "abort")).toBe("subagents:abort");
		expect(channelOf(SubagentsContract, "runs")).toBe("subagents:runs");
	});

	it("validates the snapshot, dispatch and run shapes", () => {
		expect(
			Check(SubagentsContract.methods.list.result, {
				sessionId: "session-1",
				cwd: "/tmp/project",
				agents: [
					{
						name: "scout",
						description: "Read-only repository scout",
						source: "builtin",
						tools: ["read"],
						mcpAccess: "none",
						trusted: true,
					},
				],
				maxConcurrent: 2,
				projectTrusted: true,
				userAgentsDir: "/home/user/.pi/agent/agents",
				projectAgentsDir: "/tmp/project/.pi/agents",
				readOnly: false,
			}),
		).toBe(true);
		expect(
			Check(SubagentsContract.methods.dispatch.args, [
				"session-1",
				{ tasks: [{ agent: "scout", task: "Inspect", requiredTools: ["read"] }] },
			]),
		).toBe(true);
		expect(
			Check(SubagentsContract.methods.dispatch.result, {
				dispatchId: "dispatch-1",
				runs: [run],
			}),
		).toBe(true);
		expect(Check(SubagentsContract.methods.runs.result, [run])).toBe(true);
	});

	it("rejects invalid tasks and unknown fields", () => {
		expect(Check(SubagentsContract.methods.dispatch.args, ["session-1", { tasks: [] }])).toBe(false);
		expect(
			Check(SubagentsContract.methods.dispatch.args, [
				"session-1",
				{ tasks: [{ agent: "scout", task: "Inspect", unexpected: true }] },
			]),
		).toBe(false);
		expect(Check(SubagentsContract.methods.list.args, [""])).toBe(false);
		expect(Check(SubagentsContract.methods.abort.result, "true")).toBe(false);
	});
});
