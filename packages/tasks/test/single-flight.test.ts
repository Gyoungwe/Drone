import { describe, expect, it, vi } from "vitest";
import { singleFlightCommand, type TaskCommandContext } from "../src/index";

const ctx = (id = "session", cwd = "/project"): TaskCommandContext => ({
	cwd,
	sessionManager: { getSessionId: () => id },
});

describe("single-flight task command coordination", () => {
	it("coalesces only identical in-flight commands", async () => {
		let finish: ((value: string) => void) | undefined;
		const handler = vi.fn(
			() =>
				new Promise<string>((resolve) => {
					finish = resolve;
				}),
		);
		const run = singleFlightCommand<string, TaskCommandContext, string>(handler);
		const first = run("same", ctx());
		const second = run("same", ctx());
		await Promise.resolve();
		expect(handler).toHaveBeenCalledOnce();
		finish?.("done");
		expect(await first).toBe("done");
		expect(await second).toBe("done");

		const retry = run("same", ctx());
		await Promise.resolve();
		expect(handler).toHaveBeenCalledTimes(2);
		finish?.("retry");
		expect(await retry).toBe("retry");
	});

	it("keeps sessions, directories, and commands isolated", async () => {
		const handler = vi.fn(async () => "done");
		const run = singleFlightCommand<string, TaskCommandContext, string>(handler);
		await Promise.all([
			run("same", ctx()),
			run("same", ctx("other")),
			run("same", ctx("session", "/other")),
			run("different", ctx()),
		]);
		expect(handler).toHaveBeenCalledTimes(4);
	});

	it("releases a rejected call and enforces the command bound", async () => {
		const handler = vi
			.fn<(_args: string, _ctx: TaskCommandContext) => Promise<string>>()
			.mockRejectedValueOnce(new Error("cancelled"))
			.mockResolvedValueOnce("retry");
		const run = singleFlightCommand<string, TaskCommandContext, string>(handler);
		await expect(run("same", ctx())).rejects.toThrow("cancelled");
		expect(await run("same", ctx())).toBe("retry");
		await expect(run("x".repeat(6001), ctx())).rejects.toThrow("large");
		expect(handler).toHaveBeenCalledTimes(2);
	});
});
