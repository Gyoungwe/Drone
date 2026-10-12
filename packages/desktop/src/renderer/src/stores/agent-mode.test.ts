import { beforeEach, describe, expect, it, vi } from "vitest";

const setAgentMode = vi.fn();
vi.mock("../api", () => ({ getPi: () => ({ setAgentMode }) }));

import { shortenPath } from "../lib/short-path";
import { useAgentModeStore } from "./agent-mode";

describe("agent mode store (P18)", () => {
	beforeEach(() => {
		useAgentModeStore.setState({ bySession: {}, lastChange: null });
		setAgentMode.mockReset();
	});
	it("defaults to lead and records the tool diff", async () => {
		expect(useAgentModeStore.getState().modeOf("s1")).toBe("lead");
		setAgentMode.mockResolvedValue({ added: [], removed: ["subagent"] });
		await useAgentModeStore.getState().setMode("s1", "single");
		expect(setAgentMode).toHaveBeenCalledWith("s1", "single");
		expect(useAgentModeStore.getState().modeOf("s1")).toBe("single");
		expect(useAgentModeStore.getState().lastChange).toEqual({
			sessionId: "s1",
			mode: "single",
			added: [],
			removed: ["subagent"],
		});
	});
	it("rolls back when the backend rejects", async () => {
		setAgentMode.mockRejectedValue(new Error("read-only"));
		await expect(useAgentModeStore.getState().setMode("s1", "swarm")).rejects.toThrow();
		expect(useAgentModeStore.getState().modeOf("s1")).toBe("lead");
	});
	it("shortens long and home paths", () => {
		expect(shortenPath("/Users/yw/projects/rnaseq", "/Users/yw")).toBe("~/projects/rnaseq");
		expect(shortenPath("C:\\Users\\yw\\a\\b\\c\\d\\e")).toBe("C:/…/c/d/e");
	});
});
