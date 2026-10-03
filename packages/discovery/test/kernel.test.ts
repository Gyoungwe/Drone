import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	type ControlledKernelRunner,
	filterKernelOutput,
	type KernelRunRequest,
	type KernelRunResult,
	KernelSession,
	prepareKernel,
	SubprocessFixtureRunner,
	UnavailableKernelRunner,
} from "../src";

describe("KernelSession B5d protocol", () => {
	it("executes a real isolated python fixture and exports only under runs", async () => {
		const root = await mkdtemp(join(tmpdir(), "drone-discovery-kernel-"));
		try {
			const runDirectory = join(root, "runs", "task-1", "run-1");
			await mkdir(runDirectory, { recursive: true });
			const writes: string[] = [];
			const session = new KernelSession({
				sessionId: "session-1",
				runDirectory: "runs/task-1/run-1",
				language: "python",
				dataClassification: "public",
				runner: new SubprocessFixtureRunner(),
				writer: {
					write: async (path) => {
						writes.push(path);
					},
				},
				maxExecutions: 2,
			});
			// The fixture's cwd must exist; the protocol itself still receives a relative runs path.
			const original = process.cwd();
			process.chdir(root);
			try {
				const execution = await session.execute('print("kernel-ok")');
				expect(execution.status).toBe("succeeded");
				expect(execution.output).toContain("kernel-ok");
				const exported = await session.export();
				expect(exported.scriptPath).toBe("runs/task-1/run-1/exports/session-1.py");
				expect(exported.notebook).toContain('"nbformat": 4');
				expect(writes).toEqual([
					"runs/task-1/run-1/exports/session-1.py",
					"runs/task-1/run-1/exports/session-1.ipynb",
				]);
			} finally {
				process.chdir(original);
			}
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("fails closed on controlled row output and reports the explicit container gate", async () => {
		const rowRunner: ControlledKernelRunner = {
			capabilities: {
				kind: "fixture",
				languages: ["python"],
				networkDisabled: true,
				writesOnlyToRunDirectory: true,
			},
			run: async (_request: KernelRunRequest): Promise<KernelRunResult> => ({
				exitCode: 0,
				durationMs: 1,
				producedBytes: 10,
				outputs: [{ text: "sample\tcase", contentKind: "table", classification: "controlled" }],
			}),
		};
		const session = new KernelSession({
			sessionId: "session-rows",
			runDirectory: "runs/task/run",
			language: "python",
			dataClassification: "controlled",
			runner: rowRunner,
		});
		const execution = await session.execute("print(1)");
		expect(execution.status).toBe("blocked");
		expect(execution.output).toBe("");
		expect(execution.blockedReason).toBe("output-policy");
		expect(prepareKernel(rowRunner, "python").status).toBe("needs-container");
	});

	it("enforces execution budget and idle timeout", async () => {
		const runner = new SubprocessFixtureRunner();
		const session = new KernelSession({
			sessionId: "session-budget",
			runDirectory: "runs/task/run",
			language: "python",
			dataClassification: "public",
			runner,
			maxExecutions: 1,
			idleTimeoutMs: 10,
		});
		await session.execute("print(1)");
		await expect(session.execute("print(2)")).rejects.toThrow("budget");
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(session.status.status).toBe("idle-timeout");
	});

	it("filters restricted output even when a runner attempts to label it as a summary", () => {
		const result = filterKernelOutput(
			[{ text: "secret", contentKind: "summary", classification: "restricted" }],
			"restricted",
		);
		expect(result.text).toBe("");
		expect(result.blocked).toBe(true);
	});

	it("exposes needs-container instead of pretending an unavailable runtime succeeded", async () => {
		const session = new KernelSession({
			sessionId: "session-no-container",
			runDirectory: "runs/task/run",
			language: "python",
			dataClassification: "public",
			runner: new UnavailableKernelRunner(),
		});
		expect(session.status.status).toBe("needs-container");
		await expect(session.execute("print(1)")).rejects.toThrow("needs-container");
	});
});
