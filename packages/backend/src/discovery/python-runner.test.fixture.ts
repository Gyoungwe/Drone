import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ControlledKernelRunner } from "./contracts";

const runPython = promisify(execFile);

export function createPythonFixtureRunner(): ControlledKernelRunner {
	return {
		capabilities: {
			kind: "fixture",
			languages: ["python"],
			networkDisabled: true,
			writesOnlyToRunDirectory: true,
		},
		async run({ code, runDirectory, timeoutMs, maxOutputBytes, dataClassification, signal }) {
			const startedAt = Date.now();
			const { stdout } = await runPython("python3", ["-I", "-c", code], {
				cwd: runDirectory,
				timeout: timeoutMs,
				maxBuffer: maxOutputBytes,
				signal,
			});
			return {
				exitCode: 0,
				durationMs: Date.now() - startedAt,
				producedBytes: Buffer.byteLength(stdout),
				outputs: [{ text: stdout, contentKind: "raw", classification: dataClassification }],
			};
		},
	};
}
