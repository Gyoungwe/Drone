import { EventEmitter } from "node:events";
import { setImmediate } from "node:timers/promises";
import { describe, expect, it, vi } from "vitest";
import { registerAppLifecycle } from "./app-lifecycle";

class App extends EventEmitter {
	quit = vi.fn(() => {
		let prevented = false;
		this.emit("before-quit", {
			preventDefault: () => {
				prevented = true;
			},
		});
		if (!prevented) this.emit("will-quit");
	});
}

function deferred() {
	let resolve!: () => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<void>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

function setup(cleanup: () => Promise<void>) {
	const app = new App();
	const log = { info: vi.fn() };
	const onShutdownError = vi.fn();
	const createWindow = vi.fn();
	const lifecycle = registerAppLifecycle(app, { cleanup, log, onShutdownError });
	lifecycle.onActivate(createWindow);
	return { app, log, onShutdownError, createWindow };
}

describe("Electron app lifecycle", () => {
	it("coalesces repeated quit requests and never recreates a window during or after cleanup", async () => {
		const pending = deferred();
		const cleanup = vi.fn(() => pending.promise);
		const { app, log, onShutdownError, createWindow } = setup(cleanup);
		const willQuit = vi.fn();
		app.on("will-quit", willQuit);
		app.emit("activate");
		expect(createWindow).toHaveBeenCalledTimes(1);
		app.quit();
		app.emit("activate");
		app.quit();
		await setImmediate();
		expect(cleanup).toHaveBeenCalledTimes(1);
		expect(willQuit).not.toHaveBeenCalled();
		expect(createWindow).toHaveBeenCalledTimes(1);
		pending.resolve();
		await setImmediate();
		expect(app.quit).toHaveBeenCalledTimes(3);
		expect(willQuit).toHaveBeenCalledTimes(1);
		app.emit("activate");
		expect(createWindow).toHaveBeenCalledTimes(1);
		expect(onShutdownError).not.toHaveBeenCalled();
		expect(log.info).toHaveBeenCalledWith("app will-quit", { state: "closed" });
	});

	it.each(["reject", "throw"])(
		"reports cleanup %s without declaring success, and allows a later explicit quit retry",
		async (failure) => {
			const error = new Error("resource has not drained");
			const next = deferred();
			const cleanup = vi
				.fn()
				.mockImplementationOnce(() => {
					if (failure === "throw") throw error;
					return Promise.reject(error);
				})
				.mockImplementation(() => next.promise);
			const { app, log, onShutdownError, createWindow } = setup(cleanup);
			const willQuit = vi.fn();
			app.on("will-quit", willQuit);
			app.quit();
			await setImmediate();
			expect(onShutdownError).toHaveBeenCalledWith(error);
			expect(willQuit).not.toHaveBeenCalled();
			expect(log.info).not.toHaveBeenCalledWith("app cleanup complete; requesting final quit");
			app.emit("activate");
			expect(createWindow).not.toHaveBeenCalled();
			app.quit();
			await setImmediate();
			expect(cleanup).toHaveBeenCalledTimes(2);
			expect(willQuit).not.toHaveBeenCalled();
			next.resolve();
			await setImmediate();
			expect(willQuit).toHaveBeenCalledTimes(1);
			app.emit("activate");
			expect(createWindow).not.toHaveBeenCalled();
		},
	);
});
