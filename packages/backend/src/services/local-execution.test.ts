import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { InquiryLocalExecutionEvent } from "./inquiry";
import { LocalExecutionRecorder } from "./local-execution";

describe("LocalExecutionRecorder", () => {
	it("records a local script output using hashes and scalar parameters only", async () => {
		const root = await mkdtemp(join(tmpdir(), "drone-local-execution-"));
		try {
			await mkdir(join(root, "scripts"));
			await mkdir(join(root, "results"));
			await writeFile(join(root, "scripts", "plot_fixed.py"), "print('fixed')\n");
			await writeFile(join(root, "results", "plot.png"), "png-bytes");
			const events: InquiryLocalExecutionEvent[] = [];
			const scheduleReview = vi.fn();
			const recorder = new LocalExecutionRecorder({
				inquiry: {
					recordLocalExecution: async (event: InquiryLocalExecutionEvent) => void events.push(event),
				} as never,
				getCwd: () => root,
				getProjectId: () => root,
				scheduleReview,
			});
			const command = "python scripts/plot_fixed.py --seed 7 --label fixed";
			recorder.observe("s1", {
				type: "tool_execution_start",
				toolName: "bash",
				toolCallId: "call-1",
				args: { command },
			} as never);
			await new Promise((resolve) => setTimeout(resolve, 5));
			recorder.observe("s1", {
				type: "tool_execution_end",
				toolName: "bash",
				toolCallId: "call-1",
				isError: false,
				result: { command },
			} as never);
			// Recording hashes files asynchronously; Windows runners can take well over 200 ms.
			await vi.waitFor(() => expect(events).toHaveLength(1), { timeout: 10_000, interval: 20 });
			expect(events[0]).toMatchObject({
				id: "call-1",
				toolName: "bash",
				projectId: root,
				parameters: { arg0: "--seed", arg1: 7, arg2: "--label", arg3: "fixed" },
				runProvenance: { workflow: "local", modules: ["bash", "python"] },
			});
			expect(events[0]?.codeFingerprint).toMatch(/^[a-f0-9]{64}$/);
			expect(events[0]?.artifacts).toEqual([
				expect.objectContaining({ path: "results/plot.png", location: "local", sha256: expect.any(String) }),
			]);
			expect(events[0]?.artifacts?.some((artifact) => artifact.path.endsWith("plot_fixed.py"))).toBe(false);
			expect(JSON.stringify(events[0])).not.toContain("print('fixed')");
			expect(scheduleReview).toHaveBeenCalledWith("s1", ["results/plot.png"]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

it("LocalExecutionRecorder publishes the bash event before a failing inquiry write", async () => {
	const root = await mkdtemp(join(tmpdir(), "drone-local-execution-publish-"));
	try {
		await mkdir(join(root, "scripts"));
		await mkdir(join(root, "results"));
		await writeFile(join(root, "scripts", "plot.py"), "print('fixed')\n");
		await writeFile(join(root, "results", "plot.png"), "png-bytes");
		const recorded: InquiryLocalExecutionEvent[] = [];
		const published: InquiryLocalExecutionEvent[] = [];
		let settleRecord: (() => void) | undefined;
		const recordDone = new Promise<void>((resolve) => {
			settleRecord = resolve;
		});
		const recorder = new LocalExecutionRecorder({
			inquiry: {
				recordLocalExecution: async (event: InquiryLocalExecutionEvent) => {
					recorded.push(event);
					settleRecord?.();
					throw new Error("inquiry storage failed");
				},
			} as never,
			getCwd: () => root,
			getProjectId: () => root,
			publish: (event) => published.push(event),
		});
		const command = "python scripts/plot.py";
		recorder.observe("s1", {
			type: "tool_execution_start",
			toolName: "bash",
			toolCallId: "call-1",
			args: { command },
		} as never);
		await new Promise((resolve) => setTimeout(resolve, 5));
		recorder.observe("s1", {
			type: "tool_execution_end",
			toolName: "bash",
			toolCallId: "call-1",
			isError: false,
			result: { command },
		} as never);

		await recordDone;
		expect(published).toHaveLength(1);
		expect(recorded).toHaveLength(1);
		expect(published[0]).toBe(recorded[0]);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

it("LocalExecutionRecorder publishes one kernel event with the same object sent to Inquiry", async () => {
	const root = await mkdtemp(join(tmpdir(), "drone-local-execution-kernel-"));
	try {
		await mkdir(join(root, "runs", "kernel"), { recursive: true });
		await writeFile(join(root, "runs", "kernel", "result.csv"), "value\n1\n");
		const recorded: InquiryLocalExecutionEvent[] = [];
		const published: InquiryLocalExecutionEvent[] = [];
		const recorder = new LocalExecutionRecorder({
			inquiry: {
				recordLocalExecution: async (event: InquiryLocalExecutionEvent) => void recorded.push(event),
			} as never,
			getCwd: () => root,
			getProjectId: () => root,
			publish: (event) => published.push(event),
		});
		await recorder.recordKernelExecution({
			sessionId: "session-1",
			projectId: root,
			cwd: root,
			runDirectory: "runs/kernel",
			language: "python",
			code: "print(1)",
			execution: {
				id: "execution-1",
				status: "succeeded",
				finishedAt: new Date(Date.now() + 10).toISOString(),
			},
		});

		expect(published).toHaveLength(1);
		expect(recorded).toHaveLength(1);
		expect(published[0]).toBe(recorded[0]);
		expect(published[0]?.artifacts?.[0]?.path).toBe("runs/kernel/result.csv");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
