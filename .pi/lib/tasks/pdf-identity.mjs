import { Worker } from "node:worker_threads";

/** Untrusted PDF parsing is isolated and bounded; never executes embedded PDF actions. */
export async function readPdfIdentity(bytes) {
	return new Promise((resolve, reject) => {
		const worker = new Worker(new URL("./pdf-worker.mjs", import.meta.url), {
			workerData: { bytes },
			resourceLimits: { maxOldGenerationSizeMb: 128 },
		});
		const timer = setTimeout(() => {
			void worker.terminate();
			reject(new Error("PDF identity inspection timed out; no file was changed."));
		}, 15000);
		worker.once("message", (result) => {
			clearTimeout(timer);
			void worker.terminate();
			if (result.error) reject(new Error(`PDF identity requires manual inspection: ${result.error}`));
			else resolve(result);
		});
		worker.once("error", () => {
			clearTimeout(timer);
			reject(new Error("PDF identity extractor unavailable; no identity claim was made."));
		});
		worker.once("exit", (code) => {
			clearTimeout(timer);
			if (code !== 0) reject(new Error("PDF identity worker stopped; no identity claim was made."));
		});
	});
}
