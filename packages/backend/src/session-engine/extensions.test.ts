import type { CoreHostPort } from "@gyoungwe/plugin-api";
import { describe, expect, it, vi } from "vitest";
import { PermissionGate } from "../permissions/gate";
import { createDroneRuntime } from "../runtime";
import { SessionTraces } from "../session/traces";
import { buildSessionCustomTools, type SessionExtensionDependencies } from "./extensions";

function coreHost(): CoreHostPort {
	const tool = (name: string) => vi.fn(() => ({ name }));
	return {
		contractVersion: 1,
		makeDeliverFilesTool: tool("deliver_files"),
		makeMemorySaveTool: tool("memory_save"),
		makeStatusTool: tool("set_status"),
		makeTodoTool: tool("todo"),
		memoryIndexPrompt: () => [],
		writeMemory: () => "project.md",
	};
}

function dependencies(core?: CoreHostPort): SessionExtensionDependencies {
	return {
		runtime: createDroneRuntime(),
		...(core ? { coreHost: core } : {}),
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

const UI_TOOLS = ["deliver_files", "set_status", "todo"];
const names = (deps: SessionExtensionDependencies) =>
	buildSessionCustomTools(deps, new PermissionGate(() => undefined), {
		ask: vi.fn(async () => ({ kind: "cancel" as const })),
	}).map((tool) => tool.name);

describe("core tool wiring", () => {
	it("keeps the host UI tools without the core plugin, and no project memory tool", async () => {
		const deps = dependencies();
		const tools = names(deps);
		expect(tools).toEqual(expect.arrayContaining(UI_TOOLS));
		expect(tools).not.toContain("memory_save");
		await deps.runtime.dispose();
	});

	it("takes only project memory from the core host", async () => {
		const injected = coreHost();
		const deps = dependencies(injected);
		const tools = names(deps);
		expect(tools).toContain("memory_save");
		// Each UI tool is the host's own, registered once.
		for (const name of UI_TOOLS) expect(tools.filter((tool) => tool === name)).toHaveLength(1);
		expect(injected.makeStatusTool).not.toHaveBeenCalled();
		await deps.runtime.dispose();
	});
});
