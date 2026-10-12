import { describe, expect, it, vi } from "vitest";
import { installUpdateGuarded } from "./install-update";

describe("installUpdateGuarded", () => {
	it("installs immediately when idle", async () => {
		const install = vi.fn();
		const confirm = vi.fn();
		expect(await installUpdateGuarded({ sessions: () => [{}], confirm, install })).toBe(true);
		expect(confirm).not.toHaveBeenCalled();
		expect(install).toHaveBeenCalled();
	});
	it("asks and aborts when a turn is running and user declines", async () => {
		const install = vi.fn();
		const confirm = vi.fn(() => false);
		expect(await installUpdateGuarded({ sessions: () => [{ agentActive: true }], confirm, install })).toBe(
			false,
		);
		expect(confirm).toHaveBeenCalledWith(1);
		expect(install).not.toHaveBeenCalled();
	});
	it("installs after confirmation", async () => {
		const install = vi.fn();
		expect(
			await installUpdateGuarded({ sessions: () => [{ agentActive: true }], confirm: () => true, install }),
		).toBe(true);
		expect(install).toHaveBeenCalled();
	});
});
