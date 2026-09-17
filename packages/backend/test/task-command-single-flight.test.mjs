import { expect, it, vi } from "vitest";
import { singleFlightCommand } from "../../../.pi/lib/tasks/single-flight.mjs";

const ctx = (id = "session", cwd = "/project") => ({ cwd, sessionManager: { getSessionId: () => id } });
it("coalesces only in-flight identical commands, never caches authorization outcomes", async () => {
	let finish;
	const handler = vi.fn(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		),
		run = singleFlightCommand(handler);
	const a = run("same", ctx()),
		b = run("same", ctx());
	await Promise.resolve();
	expect(handler).toHaveBeenCalledOnce();
	finish("done");
	expect(await a).toBe("done");
	expect(await b).toBe("done");
	const retry = run("same", ctx());
	await Promise.resolve();
	expect(handler).toHaveBeenCalledTimes(2);
	finish("retry");
	expect(await retry).toBe("retry");
});
it("does not coalesce across sessions, directories, or different commands", async () => {
	const handler = vi.fn(async () => "done"),
		run = singleFlightCommand(handler);
	await Promise.all([
		run("same", ctx()),
		run("same", ctx("other")),
		run("same", ctx("session", "/other")),
		run("different", ctx()),
	]);
	expect(handler).toHaveBeenCalledTimes(4);
});
it("rejection releases the entry and an explicit retry can run", async () => {
	const handler = vi.fn().mockRejectedValueOnce(new Error("cancelled")).mockResolvedValueOnce("retry"),
		run = singleFlightCommand(handler);
	await expect(run("same", ctx())).rejects.toThrow("cancelled");
	expect(await run("same", ctx())).toBe("retry");
	expect(handler).toHaveBeenCalledTimes(2);
});
it("rejects oversized commands before invoking the handler", async () => {
	const handler = vi.fn(),
		run = singleFlightCommand(handler);
	await expect(run("x".repeat(6001), ctx())).rejects.toThrow("large");
	expect(handler).not.toHaveBeenCalled();
});
