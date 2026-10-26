import type { EventEmitter } from "node:events";

type LifecycleApp = Pick<EventEmitter, "on"> & { quit(): void };
type LifecycleOptions = {
	cleanup(): Promise<void>;
	log: { info(message: string, details?: unknown): void };
	onShutdownError(error: unknown): void;
};

/** Coordinate Electron events with async cleanup before allowing its final quit. */
export function registerAppLifecycle(app: LifecycleApp, options: LifecycleOptions) {
	let state: "running" | "closing" | "failed" | "closed" = "running";
	app.on("before-quit", (event: { preventDefault(): void }) => {
		options.log.info("app before-quit", { state });
		if (state === "closed") return;
		event.preventDefault();
		if (state === "closing") return;
		state = "closing";
		void Promise.resolve()
			.then(() => options.cleanup())
			.then(
				() => {
					state = "closed";
					options.log.info("app cleanup complete; requesting final quit");
					app.quit();
				},
				(error: unknown) => {
					// Cleanup may already have closed part of the host. Keep activation
					// disabled, but allow an explicit subsequent quit to retry cleanup.
					state = "failed";
					options.onShutdownError(error);
				},
			);
	});
	app.on("will-quit", () => options.log.info("app will-quit", { state }));
	return {
		/** Register only once initialization has made window creation safe. */
		onActivate(activate: () => void): void {
			app.on("activate", () => {
				if (state !== "running") {
					options.log.info("app activation ignored during shutdown", { state });
					return;
				}
				activate();
			});
		},
	};
}
