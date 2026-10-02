import { describe, expect, it, vi } from "vitest";
import {
	createStateEvent,
	DirectRunner,
	type JobSpec,
	JobStatusMachine,
	MemoryEventStore,
	MemorySubmissionLedger,
	MemoryTransport,
	RUNNER_PROTOCOL_VERSION,
	RunnerClient,
	reconcileJob,
	submitIdempotently,
	validateArtifactManifest,
} from "../src/index";

const spec: JobSpec = {
	jobId: "job-1",
	hostAlias: "hpc-a",
	workflow: { name: "demo", version: "1.0.0" },
	remoteWorkDir: "/srv/drone/job-1",
	outputs: [{ path: "report.tsv", bytes: 4, sha256: "a".repeat(64) }],
};

function response(command: string, data: unknown): string {
	return JSON.stringify({ ok: true, protocolVersion: RUNNER_PROTOCOL_VERSION, command, data });
}

function textOf(value: string | Uint8Array): string {
	return typeof value === "string" ? value : new TextDecoder().decode(value);
}

describe("RunnerClient", () => {
	it("sends fixed runner commands as argv plus JSON stdin and negotiates versions", async () => {
		const transport = new MemoryTransport(async ({ stdin }) => {
			const request = JSON.parse(textOf(stdin ?? ""));
			if (request.command === "version")
				return {
					exitCode: 0,
					stdout: response("version", { runnerVersion: "1.2.0", protocolVersion: 1 }),
					stderr: "",
				};
			if (request.command === "capabilities")
				return { exitCode: 0, stdout: response("capabilities", { scheduler: "direct" }), stderr: "" };
			return {
				exitCode: 0,
				stdout: response(request.command, { pid: 20, processStartedAt: "2026-10-03T00:00:00Z" }),
				stderr: "",
			};
		});
		const client = new RunnerClient(transport, { minRunnerVersion: "1.0.0" });
		const negotiated = await client.negotiate();
		expect(negotiated.capabilities.scheduler).toBe("direct");
		expect(transport.requests.map((request) => request.argv)).toEqual([
			["drone-runner", "version"],
			["drone-runner", "capabilities"],
		]);
		expect(JSON.parse(textOf(transport.requests[0]?.stdin ?? "")).command).toBe("version");
	});
});

describe("job state and idempotent submit", () => {
	it("does not replay a submission after an unknown outcome", async () => {
		const ledger = new MemorySubmissionLedger();
		await ledger.tryAcquire("job-1");
		const submit = vi.fn(async () => ({
			jobId: "job-1",
			idempotencyKey: "job-1",
			remoteId: "42",
			submittedAt: "now",
		}));
		const outcome = await submitIdempotently({ jobId: "job-1", idempotencyKey: "job-1", ledger, submit });
		expect(outcome.kind).toBe("unknown");
		expect(submit).not.toHaveBeenCalled();
	});

	it("returns from unknown after reconcile and preserves forward progress", () => {
		const local = { jobId: "job-1", state: "unknown" as const, updatedAt: "old" };
		const recovered = reconcileJob(local, { state: "running", updatedAt: "new", pid: 9 }, "clock");
		expect(recovered.state).toBe("running");
		expect(reconcileJob({ ...recovered, state: "running" }, { state: "queued" }, "later").state).toBe(
			"running",
		);
	});

	it("rejects terminal rewrites and records state events", async () => {
		const events = new MemoryEventStore();
		const machine = new JobStatusMachine(spec, {
			onTransition: (event) => events.append(createStateEvent(spec.jobId, event.status)),
		});
		await machine.transition("authorized");
		await machine.transition("prepared");
		await machine.transition("submitting");
		await machine.transition("queued");
		await machine.transition("running");
		await machine.transition("collecting");
		await machine.transition("succeeded");
		await expect(machine.transition("failed")).rejects.toThrow("Cannot transition");
		expect(events.read(spec.jobId)).toHaveLength(7);
	});
});

describe("artifact manifest", () => {
	it("rejects traversal and symlink entries and verifies checksums", () => {
		const result = validateArtifactManifest(
			{
				version: 1,
				entries: [
					{ path: "report.tsv", bytes: 4, sha256: "a".repeat(64) },
					{ path: "../secret", bytes: 1, sha256: "b".repeat(64) },
					{ path: "link", bytes: 1, sha256: "c".repeat(64), symlink: true },
				],
			},
			{ observed: [{ path: "report.tsv", bytes: 4, sha256: "a".repeat(64) }] },
		);
		expect(result.valid).toBe(false);
		expect(result.errors.some((error) => error.includes("Unsafe"))).toBe(true);
		expect(result.errors.some((error) => error.includes("Symlink"))).toBe(true);
		expect(result.errors.some((error) => error.includes("Missing"))).toBe(true);
	});
});

describe("DirectRunner", () => {
	it("prepares and submits a direct process once", async () => {
		const transport = new MemoryTransport(async ({ stdin }) => {
			const command = JSON.parse(textOf(stdin ?? "")).command;
			if (command === "prepare")
				return { exitCode: 0, stdout: response(command, { prepared: true }), stderr: "" };
			if (command === "start")
				return { exitCode: 0, stdout: response(command, { pid: 12, processStartedAt: "now" }), stderr: "" };
			return { exitCode: 0, stdout: response(command, { state: "queued" }), stderr: "" };
		});
		const runner = new DirectRunner(new RunnerClient(transport));
		const first = await runner.submit(spec);
		const second = await runner.submit(spec);
		expect(first.outcome.kind).toBe("submitted");
		expect(second.outcome.kind).toBe("already-submitted");
		expect(
			transport.requests.filter((request) => JSON.parse(textOf(request.stdin ?? "")).command === "start"),
		).toHaveLength(1);
	});
});
