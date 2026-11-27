import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { PluginFileCapabilities } from "./file-capabilities";
import { indexWriterCount, type PluginFileIndexEntry, writeIndexWithinRoot } from "./file-index-capability";

const digest = (text: string) => createHash("sha256").update(text).digest("hex");

function entry(id: string): PluginFileIndexEntry {
	return {
		artifactId: id,
		sourcePath: `runs/task/${id}/source.txt`,
		resultPath: `results/task/${id}/output.txt`,
		sha256: "a".repeat(64),
		bytes: 12,
		purpose: "custom-purpose",
	};
}

async function createFixture() {
	const directory = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "drone-index-concurrency-")));
	const data = join(directory, "data");
	const cache = join(directory, "cache");
	await fs.mkdir(join(data, "results"), { recursive: true });
	await fs.mkdir(cache);
	const grant = {
		handle: "data",
		kind: "files" as const,
		path: data,
		fileWrite: true as const,
		scope: { kind: "application" as const },
	};
	const call = (signal = new AbortController().signal) => ({
		scope: { kind: "application" } as const,
		signal,
		bootstrap: false,
	});
	const createWriter = async () => {
		const ports = await PluginFileCapabilities.create([grant], cache);
		return (entries: readonly PluginFileIndexEntry[], expectedHash: string | null, signal?: AbortSignal) =>
			ports.writeIndex({ root: "data", entries, expectedHash }, call(signal));
	};
	return { directory, data, call, createWriter };
}

const test = it.extend<{ fixture: Awaited<ReturnType<typeof createFixture>> }>({
	fixture: async ({ task: _task }, use) => {
		const fixture = await createFixture();
		try {
			await use(fixture);
		} finally {
			await fs.rm(fixture.directory, { recursive: true, force: true });
		}
	},
});

test.for(["create", "replace"] as const)(
	"serializes two activations for %s writes",
	async (mode, { fixture }) => {
		const first = await fixture.createWriter();
		const second = await fixture.createWriter();
		let expectedHash: string | null = null;
		if (mode === "replace") {
			const initial = `${JSON.stringify([entry("initial")], null, 2)}\n`;
			await fs.writeFile(join(fixture.data, "results/index.json"), initial);
			expectedHash = digest(initial);
		}
		const firstEntries = [entry("first")];
		const secondEntries = [entry("second")];
		const results = await Promise.allSettled([
			first(firstEntries, expectedHash),
			second(secondEntries, expectedHash),
		]);
		const winner = results.findIndex((result) => result.status === "fulfilled");
		expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
		const rejected = results.find((result) => result.status === "rejected");
		if (rejected?.status !== "rejected") throw new Error("One serialized index write must reject");
		expect(rejected.reason).toMatchObject({
			message: "Plugin index version conflict; reread before writing",
		});
		expect(JSON.parse(await fs.readFile(join(fixture.data, "results/index.json"), "utf8"))).toEqual(
			winner === 0 ? firstEntries : secondEntries,
		);
		expect((await fs.readdir(join(fixture.data, "results"))).filter((name) => name.endsWith(".tmp"))).toEqual(
			[],
		);
		expect(indexWriterCount()).toBe(0);
	},
);

test("an aborted queued activation rejects while the active write is held", async ({ fixture }) => {
	const root = {
		handle: "data",
		kind: "files",
		path: fixture.data,
		fileWrite: true,
		scope: { kind: "application" },
		identity: await fs.lstat(fixture.data),
	} as Parameters<typeof writeIndexWithinRoot>[0];
	let signalReadStarted: () => void = () => undefined;
	const readStarted = new Promise<void>((resolve) => {
		signalReadStarted = resolve;
	});
	let releaseRead: () => void = () => undefined;
	const readGate = new Promise<void>((resolve) => {
		releaseRead = resolve;
	});
	let shouldHold = true;
	const target = join(fixture.data, "results/index.json");
	const readCurrent = async () => {
		if (shouldHold) {
			shouldHold = false;
			signalReadStarted();
			await readGate;
		}
		try {
			return { sha256: digest(await fs.readFile(target, "utf8")) };
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
			throw error;
		}
	};
	const input = { root: "data", entries: [entry("active")], expectedHash: null };
	const active = writeIndexWithinRoot(root, input, fixture.call(), readCurrent, () => undefined);
	await readStarted;
	const controller = new AbortController();
	const queued = writeIndexWithinRoot(
		root,
		{ ...input, entries: [entry("cancelled")] },
		fixture.call(controller.signal),
		async () => null,
		() => undefined,
	);
	const queueResult: { error?: unknown } = {};
	const observedQueue = queued.then(
		() => undefined,
		(error: unknown) => {
			queueResult.error = error;
		},
	);
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
	controller.abort(new Error("cancelled while queued"));
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
	const rejectedWhileActive =
		queueResult.error instanceof Error && queueResult.error.message === "cancelled while queued";
	releaseRead();
	await observedQueue;
	expect(rejectedWhileActive).toBe(true);
	expect(queueResult.error).toMatchObject({ message: "cancelled while queued" });
	await expect(active).resolves.toMatchObject({ written: true, entries: 1 });
	expect(indexWriterCount()).toBe(0);
});
