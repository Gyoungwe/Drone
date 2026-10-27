import type { CoreHostPort } from "@gyoungwe/plugin-api";
import { describe, expect, it, vi } from "vitest";
import { desktopLoaderOptions } from "./trust-loader";

const integration = {
	appendSystemPrompt: ["desktop"],
	additionalSkillPaths: [],
};

function core(memoryIndexPrompt: CoreHostPort["memoryIndexPrompt"]): CoreHostPort {
	return {
		contractVersion: 1,
		makeDeliverFilesTool: () => ({}),
		makeMemorySaveTool: () => ({}),
		makeStatusTool: () => ({}),
		makeTodoTool: () => ({}),
		memoryIndexPrompt,
		writeMemory: () => "memory.md",
	};
}

describe("trust loader core host wiring", () => {
	it("does not inject core memory context without the optional plugin", () => {
		const options = desktopLoaderOptions(integration, "/tmp/project") as { appendSystemPrompt: string[] };
		expect(options.appendSystemPrompt).toEqual(["desktop"]);
	});

	it("uses memory context from the injected core host", () => {
		const memoryIndexPrompt = vi.fn(() => ["memory-index"]);
		const options = desktopLoaderOptions(integration, "/tmp/project", undefined, core(memoryIndexPrompt)) as {
			appendSystemPrompt: string[];
		};
		expect(memoryIndexPrompt).toHaveBeenCalledWith("/tmp/project");
		expect(options.appendSystemPrompt).toContain("memory-index");
	});
});
