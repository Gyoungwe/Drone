import { describe, expect, it } from "vitest";
import { DecisionFanout } from "../services/decision-fanout";
import { type RegisteredSession, SessionRegistry } from "../session/registry";
import type { PluginCapabilityContext } from "./runtime-capabilities";
import { sessionCapabilityHandlers, sessionDecisionCapabilityHandlers } from "./session-capabilities";

const checkpoint = (capabilities: unknown) => ({
	type: "custom",
	customType: "drone-capability-checkpoint-v1",
	data: { capabilities },
});

function live(branch: unknown[] = []) {
	const registry = new SessionRegistry();
	const entry = {
		session: {
			sessionId: "s1",
			sessionManager: { getBranch: () => branch },
			settingsManager: { isProjectTrusted: () => true },
		},
		unsubscribe: () => undefined,
		cwd: "/work/project",
	} as unknown as RegisteredSession;
	registry.add(entry);
	const context = {
		pluginId: "drone-core",
		signal: new AbortController().signal,
		scope: { kind: "session", sessionId: "s1", workspaceDirectory: "/work/project" },
		sessionIdentity: entry,
	} as unknown as PluginCapabilityContext;
	return { registry, context };
}

describe("session.capabilities", () => {
	it("reads the latest capability checkpoint on the actual branch", async () => {
		const { registry, context } = live([
			checkpoint(["literature"]),
			{ type: "custom", customType: "other", data: { capabilities: ["x"] } },
			checkpoint(["analysis", 3, "compute"]),
		]);
		const read = sessionCapabilityHandlers(registry)["session.capabilities"];
		expect(await read.execute(null, context)).toEqual(["analysis", "compute"]);
	});

	it("is empty before the host writes a checkpoint", async () => {
		const { registry, context } = live([{ type: "message" }]);
		expect(await sessionCapabilityHandlers(registry)["session.capabilities"].execute(null, context)).toEqual(
			[],
		);
	});
});

describe("session.decision.record", () => {
	it("publishes under the plugin's name, the caller's project and the host's time", async () => {
		const { registry, context } = live();
		const decisions = new DecisionFanout();
		const published: unknown[] = [];
		decisions.on((event) => published.push(event));
		const record = sessionDecisionCapabilityHandlers(registry, decisions)["session.decision.record"];
		expect(record).toMatchObject({ effect: "write", approval: "own", readCallable: true });
		const input = {
			id: "task-authorization:t1:2",
			kind: "task-authorization",
			summary: "Go",
			basis: ["task:t1"],
		};
		expect(await record.execute(input, context)).toBeNull();
		expect(published).toEqual([
			{
				...input,
				id: "drone-core:task-authorization:t1:2",
				at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
				projectId: "/work/project",
			},
		]);
	});

	it("refuses a caller that is not the live session", async () => {
		const { registry, context } = live();
		const record = sessionDecisionCapabilityHandlers(registry, new DecisionFanout())[
			"session.decision.record"
		];
		const stale = { ...context, sessionIdentity: {} } as PluginCapabilityContext;
		await expect(record.execute({ id: "a", kind: "rebind", summary: "b", basis: [] }, stale)).rejects.toThrow(
			/stale/,
		);
	});
});
