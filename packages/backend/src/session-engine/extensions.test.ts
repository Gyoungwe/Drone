import type { CoreHostPort } from "@gyoungwe/plugin-api";
import { describe, expect, it, vi } from "vitest";
import { PermissionGate } from "../permissions/gate";
import { createDroneRuntime } from "../runtime";
import { SessionTraces } from "../session/traces";
import { buildSessionCustomTools, type SessionExtensionDependencies } from "./extensions";

function coreHost(): CoreHostPort {
	const tool = (name: string) => ({ name });
	return {
		contractVersion: 1,
		makeDeliverFilesTool: () => tool("deliver_files"),
		makeMemorySaveTool: () => tool("memory_save"),
		makeStatusTool: () => tool("set_status"),
		makeTodoTool: () => tool("todo"),
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

describe("core host tool wiring", () => {
	it("fails closed when the core plugin is unavailable", async () => {
		const deps = dependencies();
		const tools = buildSessionCustomTools(deps, new PermissionGate(() => undefined), {
			ask: vi.fn(async () => ({ kind: "cancel" as const })),
		});
		expect(tools.map((tool) => tool.name)).not.toEqual(
			expect.arrayContaining(["deliver_files", "memory_save", "set_status", "todo"]),
		);
		await deps.runtime.dispose();
	});

	it("uses the injected core host factories", async () => {
		const injected = coreHost();
		const deps = dependencies(injected);
		const tools = buildSessionCustomTools(deps, new PermissionGate(() => undefined), {
			ask: vi.fn(async () => ({ kind: "cancel" as const })),
		});
		expect(tools.map((tool) => tool.name)).toEqual(
			expect.arrayContaining(["deliver_files", "memory_save", "set_status", "todo"]),
		);
		await deps.runtime.dispose();
	});
});
