import { expect, it, vi } from "vitest";
import { renameWithRetry } from "../src/wiki-review";

const fail = (code: string) => Object.assign(new Error(code), { code });

it("retries transient Windows lock errors then succeeds", async () => {
	const impl = vi
		.fn()
		.mockRejectedValueOnce(fail("EPERM"))
		.mockRejectedValueOnce(fail("EBUSY"))
		.mockResolvedValue(undefined);
	await renameWithRetry("a", "b", { renameImpl: impl, delayMs: 1 });
	expect(impl).toHaveBeenCalledTimes(3);
});

it("does not retry non-lock errors", async () => {
	const impl = vi.fn().mockRejectedValue(fail("ENOENT"));
	await expect(renameWithRetry("a", "b", { renameImpl: impl, delayMs: 1 })).rejects.toThrow("ENOENT");
	expect(impl).toHaveBeenCalledTimes(1);
});

it("gives up after the attempt budget", async () => {
	const impl = vi.fn().mockRejectedValue(fail("EPERM"));
	await expect(renameWithRetry("a", "b", { renameImpl: impl, delayMs: 1, attempts: 3 })).rejects.toThrow(
		"EPERM",
	);
	expect(impl).toHaveBeenCalledTimes(3);
});
