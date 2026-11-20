import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type JobRecord, type MemoryTransport, RunnerClient, type RunnerTransport } from "@drone/compute";
import { afterEach, expect, it, vi } from "vitest";
import { ComputeTransportError, sha256 } from "./compute-operation-lifetime";
import { DefaultComputeExecutor } from "./default-executor";

const host = { alias: "local", host: "local" };
const job: JobRecord = {
	jobId: "host-job",
	remoteId: "remote-job",
	hostAlias: "local",
	spec: { jobId: "host-job", hostAlias: "local", workflow: { name: "fixture", version: "1" } },
	status: "running",
	createdAt: 0,
	updatedAt: 0,
};
const confirmed = {
	state: "confirmed",
	jobId: "remote-job",
	method: "direct",
	observedAt: "2026-11-19T00:00:00Z",
};

afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
});

function mockCancel(
	payload: unknown,
	capabilities: { scheduler: string; cleanupEvidence?: unknown } = {
		scheduler: "direct",
		cleanupEvidence: 1,
	},
) {
	return vi.spyOn(RunnerClient.prototype, "execute").mockImplementation(async (command) => {
		if (command === "version") return { runnerVersion: "1.0.0", protocolVersion: 1 };
		if (command === "capabilities") return capabilities;
		if (command === "cancel") return payload;
		throw new Error(`Unexpected command: ${command}`);
	});
}

it.each(["running", "succeeded", "failed", "cancelled"])("honours runner state %s", async (state) => {
	mockCancel({ state, cleanup: confirmed });
	const executor = new DefaultComputeExecutor();
	try {
		expect(await executor.cancel(job, host)).toMatchObject({ status: state, cleanup: confirmed });
	} finally {
		await executor.dispose();
	}
});

it.each([undefined, null, "unrecognized", 42])(
	"maps missing or unknown state %s to unknown",
	async (state) => {
		mockCancel({ state, cleanup: confirmed });
		const executor = new DefaultComputeExecutor();
		try {
			expect((await executor.cancel(job, host)).status).toBe("unknown");
		} finally {
			await executor.dispose();
		}
	},
);

it("does not accept a status label without state", async () => {
	mockCancel({ status: "cancelled", cleanup: confirmed });
	const executor = new DefaultComputeExecutor();
	try {
		expect((await executor.cancel(job, host)).status).toBe("unknown");
	} finally {
		await executor.dispose();
	}
});

it.each(["confirmed", "unknown", "failed", "unsupported"])(
	"passes through %s cleanup evidence",
	async (state) => {
		const cleanup = { ...confirmed, state };
		const execute = mockCancel({ state: "running", cleanup });
		const executor = new DefaultComputeExecutor();
		try {
			expect(await executor.cancel(job, host)).toEqual({
				status: "running",
				remoteId: "remote-job",
				cleanup,
			});
			expect(execute).toHaveBeenCalledWith("cancel", undefined, "remote-job");
		} finally {
			await executor.dispose();
		}
	},
);

it.each([
	undefined,
	null,
	"confirmed",
	[],
	{},
	{ ...confirmed, jobId: "another-job" },
	{ ...confirmed, state: "cancelled" },
	{ ...confirmed, method: "ssh" },
	{ ...confirmed, observedAt: undefined },
	{ ...confirmed, observedAt: 42 },
])("downgrades malformed or mismatched evidence %j", async (cleanup) => {
	mockCancel({ state: "running", cleanup }, { scheduler: "slurm", cleanupEvidence: 1 });
	const executor = new DefaultComputeExecutor();
	try {
		expect(await executor.cancel(job, host)).toMatchObject({
			status: "running",
			cleanup: { state: "unknown", jobId: "remote-job", method: "slurm" },
		});
	} finally {
		await executor.dispose();
	}
});

it("passes through Slurm evidence", async () => {
	const cleanup = { ...confirmed, method: "slurm" };
	mockCancel({ state: "cancelled", cleanup }, { scheduler: "slurm", cleanupEvidence: 1 });
	const executor = new DefaultComputeExecutor();
	try {
		expect((await executor.cancel(job, host)).cleanup).toEqual(cleanup);
	} finally {
		await executor.dispose();
	}
});

it.each([undefined, 0, 2, "1", true])(
	"still cancels without cleanupEvidence: 1 (%s)",
	async (cleanupEvidence) => {
		const execute = mockCancel(
			{ state: "running", cleanup: confirmed },
			{ scheduler: "direct", cleanupEvidence },
		);
		const executor = new DefaultComputeExecutor();
		try {
			expect(await executor.cancel(job, host)).toMatchObject({
				status: "running",
				cleanup: { state: "unsupported", jobId: "remote-job", method: "direct" },
			});
			expect(execute).toHaveBeenCalledWith("cancel", undefined, "remote-job");
		} finally {
			await executor.dispose();
		}
	},
);

it("retains the cancel-unknown retry", async () => {
	vi.useFakeTimers();
	const execute = mockCancel({ state: "running", cleanup: { ...confirmed, state: "unknown" } });
	const cancel = vi.spyOn(RunnerClient.prototype, "cancel");
	cancel.mockRejectedValueOnce({ code: "cancel-unknown", retryable: true });
	const executor = new DefaultComputeExecutor();
	try {
		const result = executor.cancel(job, host);
		await vi.runAllTimersAsync();
		expect((await result).status).toBe("running");
		expect(cancel).toHaveBeenCalledTimes(2);
		expect(execute).toHaveBeenCalledWith("cancel", undefined, "remote-job");
	} finally {
		await executor.dispose();
	}
});

function deferred<T>() {
	let resolve: (value: T) => void = vi.fn();
	let reject: (error: Error) => void = vi.fn();
	const promise = new Promise<T>((complete, fail) => {
		resolve = complete;
		reject = fail;
	});
	return { promise, resolve, reject };
}

function mockCollect() {
	const bytes = Buffer.from("fixture");
	const downloading = deferred<void>();
	const downloaded = deferred<Uint8Array>();
	const close = vi.fn<() => Promise<void>>(async () => undefined);
	vi.spyOn(RunnerClient.prototype, "execute").mockImplementation(async function (this: RunnerClient) {
		// The executor transport includes artifact downloads beyond RunnerTransport's protocol surface.
		const transport = this.transport as RunnerTransport &
			Pick<MemoryTransport, "download"> & { close(): Promise<void> };
		vi.spyOn(transport, "close").mockImplementation(close);
		vi.spyOn(transport, "download").mockImplementation(() => {
			downloading.resolve();
			return downloaded.promise;
		});
		return {
			manifest: {
				version: 1,
				entries: [{ path: "artifact.txt", bytes: bytes.length, sha256: sha256(bytes) }],
			},
		};
	});
	return { bytes, downloading, downloaded, close };
}

it("aborts and drains an in-flight artifact write before closing the transport", async () => {
	const { readdir } = await import("node:fs/promises");
	const fixture = mockCollect();
	const targetDir = await mkdtemp(join(tmpdir(), "drone-collect-lifetime-"));
	fixture.close.mockImplementationOnce(async () => {
		await expect(readFile(join(targetDir, "artifact.txt"))).rejects.toMatchObject({ code: "ENOENT" });
		expect((await readdir(targetDir)).filter((entry) => entry.includes(".drone-partial-"))).toEqual([]);
	});
	const executor = new DefaultComputeExecutor();
	const collection = executor.collect(job, host, { targetDir });
	const rejected = expect(collection).rejects.toMatchObject({ code: "aborted" });
	await fixture.downloading.promise;
	const disposed = executor.dispose();
	await Promise.resolve();
	expect(fixture.close).not.toHaveBeenCalled();
	fixture.downloaded.resolve(fixture.bytes);
	await Promise.all([rejected, disposed]);
	expect(fixture.close).toHaveBeenCalledOnce();
});

it("settles failed writes before closing and reports the collection failure", async () => {
	const fixture = mockCollect();
	const targetDir = await mkdtemp(join(tmpdir(), "drone-collect-failure-"));
	const executor = new DefaultComputeExecutor();
	const collection = executor.collect(job, host, { targetDir });
	const failure = expect(collection).rejects.toThrow("download failed");
	await fixture.downloading.promise;
	const disposed = executor.dispose();
	await Promise.resolve();
	expect(fixture.close).not.toHaveBeenCalled();
	fixture.downloaded.reject(new Error("download failed"));
	await failure;
	await disposed;
	expect(fixture.close).toHaveBeenCalledOnce();
});

it("rejects collection after dispose with executor-disposed", async () => {
	const execute = vi.spyOn(RunnerClient.prototype, "execute");
	const executor = new DefaultComputeExecutor();
	await executor.dispose();
	const collection = executor.collect(job, host);
	await expect(collection).rejects.toBeInstanceOf(ComputeTransportError);
	await expect(collection).rejects.toMatchObject({ code: "executor-disposed" });
	expect(execute).not.toHaveBeenCalled();
});
