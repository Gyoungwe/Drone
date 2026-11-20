import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ArtifactManifest, type JobRecord, type JobSpec, RunnerClient } from "@drone/compute";
import { afterEach, expect, it, vi } from "vitest";
import { sha256 } from "./compute-operation-lifetime";
import { type CollectingTransport, DefaultComputeExecutor } from "./default-executor";

const host = { alias: "local", host: "local" };
const spec: JobSpec = {
	jobId: "host-job",
	hostAlias: host.alias,
	workflow: { name: "fixture", version: "1" },
};
const started = { remoteId: "remote-job", status: "queued" };
const job: JobRecord = {
	jobId: spec.jobId,
	hostAlias: host.alias,
	remoteId: started.remoteId,
	spec,
	status: "succeeded",
	createdAt: 0,
	updatedAt: 0,
};

afterEach(() => vi.restoreAllMocks());

function deferred<T>() {
	let resolve: (value: T) => void = vi.fn();
	const promise = new Promise<T>((complete) => {
		resolve = complete;
	});
	return { promise, resolve };
}

function mockSubmit(pendingCommand?: "prepare" | "start") {
	const pending = deferred<void>();
	const release = deferred<void>();
	const execute = vi.spyOn(RunnerClient.prototype, "execute").mockImplementation(async (command) => {
		if (command === pendingCommand) {
			pending.resolve();
			await release.promise;
		}
		if (command === "version") return { runnerVersion: "1.0.0", protocolVersion: 1 };
		if (command === "capabilities") return { scheduler: "direct" };
		if (command === "prepare") return {};
		if (command === "start") return started;
		throw new Error(`Unexpected command: ${command}`);
	});
	return { execute, pending, release };
}

it("rejects an already-aborted submit without starting the runner", async () => {
	const { execute } = mockSubmit();
	const executor = new DefaultComputeExecutor();
	await expect(executor.submit(spec, host, AbortSignal.abort())).rejects.toMatchObject({
		code: "aborted",
		retryable: false,
	});
	expect(execute).not.toHaveBeenCalled();
	await executor.dispose();
});

it("does not start when submit aborts during prepare", async () => {
	const { execute, pending, release } = mockSubmit("prepare");
	const signal = new AbortController();
	const executor = new DefaultComputeExecutor();
	const submission = executor.submit(spec, host, signal.signal);
	const rejected = expect(submission).rejects.toMatchObject({ code: "aborted" });
	await pending.promise;
	signal.abort();
	release.resolve();
	await rejected;
	expect(execute.mock.calls.map(([command]) => command)).not.toContain("start");
	await executor.dispose();
});

it("returns the remote ID when submit aborts during start", async () => {
	const { pending, release } = mockSubmit("start");
	const signal = new AbortController();
	const executor = new DefaultComputeExecutor();
	const submission = executor.submit(spec, host, signal.signal);
	await pending.promise;
	signal.abort();
	release.resolve();
	await expect(submission).resolves.toEqual(started);
	await executor.dispose();
});

it("rejects submit after disposal without sending a runner command", async () => {
	const { execute } = mockSubmit();
	const executor = new DefaultComputeExecutor();
	await executor.dispose();
	await expect(executor.submit(spec, host)).rejects.toMatchObject({ code: "executor-disposed" });
	expect(execute).not.toHaveBeenCalled();
});

function artifact(path: string, bytes: Uint8Array) {
	return { path, bytes: bytes.byteLength, sha256: sha256(bytes) };
}

function mockCollect(entries: ArtifactManifest["entries"], download: CollectingTransport["download"]) {
	const close = vi.fn(async () => undefined);
	vi.spyOn(RunnerClient.prototype, "execute").mockImplementation(async function (this: RunnerClient) {
		const transport = this.transport as CollectingTransport & { close(): Promise<void> };
		vi.spyOn(transport, "close").mockImplementation(close);
		vi.spyOn(transport, "download").mockImplementation(download);
		return { manifest: { version: 1, entries } };
	});
	return close;
}

it("keeps the first artifact and removes the second temporary when its download is aborted", async () => {
	const first = Buffer.from("first output");
	const second = Buffer.from("second output");
	const pending = deferred<void>();
	const release = deferred<Uint8Array>();
	mockCollect([artifact("first.txt", first), artifact("second.txt", second)], ({ source }) => {
		if (source === "first.txt") return Promise.resolve(first);
		expect(source).toBe("second.txt");
		pending.resolve();
		return release.promise;
	});
	const targetDir = await mkdtemp(join(tmpdir(), "drone-collect-abort-"));
	const signal = new AbortController();
	const executor = new DefaultComputeExecutor();
	const collection = executor.collect(job, host, { targetDir }, signal.signal);
	const rejected = expect(collection).rejects.toMatchObject({ code: "aborted" });
	await pending.promise;
	signal.abort();
	release.resolve(second);
	await rejected;
	expect(await readFile(join(targetDir, "first.txt"))).toEqual(first);
	expect(await readdir(targetDir)).toEqual(["first.txt"]);
	await executor.dispose();
});

it("keeps an existing destination unchanged on a checksum mismatch", async () => {
	const targetDir = await mkdtemp(join(tmpdir(), "drone-collect-checksum-"));
	const target = join(targetDir, "artifact.txt");
	const original = Buffer.from("original");
	await writeFile(target, original);
	mockCollect([artifact("artifact.txt", Buffer.from("expected"))], async () => Buffer.from("tampered"));
	const executor = new DefaultComputeExecutor();
	await expect(executor.collect(job, host, { targetDir })).rejects.toMatchObject({
		code: "artifact-checksum",
	});
	expect(await readFile(target)).toEqual(original);
	expect(await readdir(targetDir)).toEqual(["artifact.txt"]);
	await executor.dispose();
});

it("waits for the blocked collection before disposal completes", async () => {
	const bytes = Buffer.from("output");
	const pending = deferred<void>();
	const release = deferred<Uint8Array>();
	const close = mockCollect([artifact("artifact.txt", bytes)], () => {
		pending.resolve();
		return release.promise;
	});
	const targetDir = await mkdtemp(join(tmpdir(), "drone-collect-dispose-"));
	const executor = new DefaultComputeExecutor();
	const callerSignal = new AbortController().signal;
	const settled = vi.fn();
	const collection = executor.collect(job, host, { targetDir }, callerSignal).finally(settled);
	const rejected = expect(collection).rejects.toMatchObject({ code: "aborted" });
	await pending.promise;
	const disposed = executor.dispose().then(() => expect(settled).toHaveBeenCalledOnce());
	await Promise.resolve();
	expect(close).not.toHaveBeenCalled();
	release.resolve(bytes);
	await Promise.all([rejected, disposed]);
	expect(close).toHaveBeenCalledOnce();
	expect(await readdir(targetDir)).toEqual([]);
});
