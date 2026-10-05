import { describe, expect, it } from "vitest";
import { HARNESS_CHECKPOINT_CUSTOM_TYPE, type HarnessCheckpoint } from "../../shared/src/harness";
import { buildSessionExtensionFactories } from "../src/session-engine/extensions";
import { checkpointFromBranch, makeHarnessContextExtension } from "../src/session-engine/harness/context";

const taskView = {
	version: 2 as const,
	revision: 1,
	activeTaskId: "t1",
	selectionRequired: false,
	limits: { stageCalls: 48, totalCalls: 192 },
	tasks: [
		{
			id: "t1",
			goal: "Prepare the architecture report",
			state: "running",
			updatedAt: "2026-10-05T00:00:00.000Z",
			reason: null,
			stage: 1,
			budget: { calls: 1, stageCalls: 1 },
			waitMs: 0,
			capabilities: [],
			writeRoots: ["docs"],
			milestones: [
				{
					id: "m1",
					title: "Write the report",
					dependsOn: [],
					acceptance: { kind: "file", path: "docs/report.md" },
					state: "pending",
				},
			],
			actions: [],
			operations: [],
			remainingSummary: "Inspect the session engine next",
		},
	],
};

function branch() {
	return [
		{
			type: "custom_message",
			id: "status-1",
			customType: "drone-task-status",
			content: "当前任务：读取 session-engine",
			details: { taskView },
			display: true,
		},
		{
			type: "custom_message",
			id: "todo-1",
			customType: "todo-reminder",
			content: "Continue the report checklist",
			display: false,
		},
	];
}

function fakeContext(entries = branch()) {
	return {
		sessionManager: {
			getSessionId: () => "session-1",
			getBranch: () => entries,
		},
		model: { contextWindow: 128_000 },
	};
}

function handlers() {
	const registered = new Map<string, (...args: any[]) => any>();
	const pi = {
		on(name: string, handler: (...args: any[]) => any) {
			registered.set(name, handler);
		},
		events: { emit: () => undefined },
	};
	return { registered, pi };
}

describe("harness context adapter", () => {
	it("projects task, todo, and status state into a bounded checkpoint", () => {
		const checkpoint = checkpointFromBranch("Analyze Drone", 1, branch());
		expect(checkpoint).toMatchObject<Partial<HarnessCheckpoint>>({
			objective: "Analyze Drone",
			workState: "running",
			nextMove: "Inspect the session engine next",
			deliverables: ["Write the report: docs/report.md"],
			relevantFiles: ["docs", "docs/report.md"],
		});
		expect(checkpoint.findings.join("\n")).toContain("Continue the report checklist");
	});

	it("adds posture and injects one checkpoint after compaction", async () => {
		const { registered, pi } = handlers();
		const extension = makeHarnessContextExtension({
			getPosture: () => ({ effort: "ultra", delegation: "light", autonomy: "balanced", mode: "execute" }),
		});
		await (extension as any).factory(pi);
		const context = fakeContext();
		const before = await registered.get("before_agent_start")?.(
			{ prompt: "Analyze Drone", systemPrompt: "base" },
			context,
		);
		expect(before.systemPrompt).toContain("Drone harness contract:");
		expect(before.systemPrompt).toContain("effort ULTRA");

		await registered.get("session_compact")?.({}, context);
		const first = await registered.get("context")?.({ messages: [] }, context);
		const message = first.messages.at(-1);
		expect(message).toMatchObject({
			role: "custom",
			customType: HARNESS_CHECKPOINT_CUSTOM_TYPE,
			display: false,
		});
		expect(message.content).toContain("Analyze Drone");
		expect(message.details.epoch).toBe(1);

		const second = await registered.get("context")?.({ messages: first.messages }, context);
		expect(second).toBeUndefined();
	});

	it("creates a new checkpoint when the objective changes", async () => {
		const { registered, pi } = handlers();
		const extension = makeHarnessContextExtension();
		await (extension as any).factory(pi);
		const context = fakeContext();
		await registered.get("before_agent_start")?.(
			{ prompt: "First objective", systemPrompt: "base" },
			context,
		);
		const first = await registered.get("context")?.({ messages: [] }, context);
		await registered.get("before_agent_start")?.(
			{ prompt: "Second objective", systemPrompt: "base" },
			context,
		);
		const second = await registered.get("context")?.({ messages: first.messages }, context);
		expect(second.messages.at(-1)?.content).toContain("Second objective");
	});

	it("keeps shared contracts when familyPrompt is disabled", async () => {
		const { registered, pi } = handlers();
		const extension = makeHarnessContextExtension({ familyPrompt: false });
		await (extension as any).factory(pi);
		const result = await registered.get("before_agent_start")?.(
			{ prompt: "Objective", systemPrompt: "base" },
			fakeContext(),
		);
		expect(result.systemPrompt).not.toContain("Model family guidance");
		expect(result.systemPrompt).toContain("Drone harness contract:");
		expect(result.systemPrompt).toContain("Scientific contract:");
		expect(result.systemPrompt).toContain("Response contract:");
	});

	it("ignores malformed branch entries and fails open", async () => {
		const malformed = fakeContext([{ type: "message", message: { role: "custom", details: "bad" } }]);
		const checkpoint = checkpointFromBranch("Objective", 0, malformed.sessionManager.getBranch());
		expect(checkpoint.objective).toBe("Objective");
		const { registered, pi } = handlers();
		const extension = makeHarnessContextExtension();
		await (extension as any).factory(pi);
		const result = await registered.get("context")?.({ messages: [] }, malformed);
		expect(result?.messages.at(-1)?.customType).toBe(HARNESS_CHECKPOINT_CUSTOM_TYPE);
	});

	it("registers the harness context extension by default and supports disabling it", () => {
		const deps = { runtime: {}, traces: {} } as any;
		const names = (factories: readonly unknown[]) =>
			factories
				.filter((factory): factory is { name?: unknown } => !!factory && typeof factory === "object")
				.map((factory) => factory.name);
		expect(names(buildSessionExtensionFactories(deps, "/tmp/drone"))).toContain("harness-context");
		expect(
			names(buildSessionExtensionFactories({ ...deps, harnessContext: false }, "/tmp/drone")),
		).not.toContain("harness-context");
	});
});
