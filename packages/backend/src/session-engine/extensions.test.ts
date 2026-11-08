import { describe, expect, it, vi } from "vitest";
import { PermissionGate } from "../permissions/gate";
import { createDroneRuntime } from "../runtime";
import { SessionTraces } from "../session/traces";
import { buildSessionCustomTools, type SessionExtensionDependencies } from "./extensions";

function dependencies(): SessionExtensionDependencies {
	return {
		runtime: createDroneRuntime(),
		webFetch: false,
		subagentPreferBuiltin: false,
		getModelRuntime: async () => {
			throw new Error("not used in this test");
		},
		getSubagentModel: async () => undefined,
		traces: new SessionTraces(),
		onEvent: () => undefined,
		setMcpStatus: () => undefined,
	};
}

const HOST_TOOLS = ["deliver_files", "memory_save", "set_status", "todo"];

describe("core tool wiring", () => {
	it("registers the host's UI and project memory tools once each, with no core plugin", async () => {
		const deps = dependencies();
		const tools = buildSessionCustomTools(deps, new PermissionGate(() => undefined), {
			ask: vi.fn(async () => ({ kind: "cancel" as const })),
		}).map((tool) => tool.name);
		for (const name of HOST_TOOLS) expect(tools.filter((tool) => tool === name)).toHaveLength(1);
		await deps.runtime.dispose();
	});
});
