import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { fileCapabilityHandlers, PluginFileCapabilities } from "./file-capabilities";
import { PluginCapabilityBroker } from "./runtime-capabilities";

const entry = {
	artifactId: "artifact-1",
	sourcePath: "runs/task/run/source.txt",
	resultPath: "results/task/run/output.txt",
	sha256: "a".repeat(64),
	bytes: 12,
	purpose: "deliverable",
} as const;
const digest = (text: string) => createHash("sha256").update(text).digest("hex");

async function createFixture(directory: string) {
	const data = join(directory, "data");
	const outside = join(directory, "outside");
	const cache = join(directory, "cache");
	await fs.mkdir(join(data, "results"), { recursive: true });
	await fs.mkdir(outside);
	await fs.mkdir(cache);
	const ports = await PluginFileCapabilities.create(
		[
			{ handle: "data", kind: "files", path: data, fileWrite: true, scope: { kind: "application" } },
			{ handle: "readonly", kind: "files", path: data, scope: { kind: "application" } },
		],
		cache,
	);
	const call = {
		scope: { kind: "application" } as const,
		signal: new AbortController().signal,
		bootstrap: false,
	};
	const broker = new PluginCapabilityBroker({ handlers: fileCapabilityHandlers(ports), resources: [] });
	const request = (operation: string, input: unknown, bootstrap = false) =>
		broker.run(
			{ ...call, bootstrap, pluginId: "fixture", applicationId: "app", callerIdentity: {} },
			"write",
			() => undefined,
			async () => true,
			async () => broker.port.call(operation, input),
		);
	const write = (entries: readonly unknown[] = [entry], expectedHash: string | null = null, root = "data") =>
		request("files.writeIndex", { root, entries, expectedHash });
	return { data, outside, request, write };
}

const test = it.extend<{ fixture: Awaited<ReturnType<typeof createFixture>> }>({
	fixture: async ({ task: _task }, use) => {
		const directory = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "drone-file-index-")));
		try {
			await use(await createFixture(directory));
		} finally {
			await fs.rm(directory, { recursive: true, force: true });
		}
	},
});

test("creates and replaces only the expected index version with exact serialized readback", async ({
	fixture,
}) => {
	const firstText = `${JSON.stringify([entry], null, 2)}\n`;
	const first = (await fixture.write()) as { sha256: string };
	expect(await fs.readFile(join(fixture.data, "results/index.json"))).toEqual(Buffer.from(firstText));
	expect(first.sha256).toBe(digest(firstText));
	const nextEntry = { ...entry, artifactId: "artifact-2", resultPath: "results/task/run/next.txt" };
	const nextText = `${JSON.stringify([nextEntry], null, 2)}\n`;
	const next = await fixture.write([nextEntry], first.sha256);
	expect(next).toEqual({
		written: true,
		sha256: digest(nextText),
		bytes: Buffer.byteLength(nextText),
		entries: 1,
	});
	expect(await fs.readFile(join(fixture.data, "results/index.json"))).toEqual(Buffer.from(nextText));
	await expect(fixture.write([entry], first.sha256)).rejects.toThrow(
		"Plugin index version conflict; reread before writing",
	);
});

test("rejects a stale expected hash and create-only writes when the index already exists", async ({
	fixture,
}) => {
	await fs.writeFile(join(fixture.data, "results/index.json"), "old\n");
	await expect(fixture.write([entry], "b".repeat(64))).rejects.toThrow(
		"Plugin index version conflict; reread before writing",
	);
	await expect(fixture.write()).rejects.toThrow("Plugin index version conflict; reread before writing");
	expect(await fs.readFile(join(fixture.data, "results/index.json"), "utf8")).toBe("old\n");
});

test("requires an existing results directory inside the authorized root", async ({ fixture }) => {
	await fs.rm(join(fixture.data, "results"), { recursive: true });
	await expect(fixture.write()).rejects.toMatchObject({ code: "ENOENT" });
	await fs.symlink(fixture.outside, join(fixture.data, "results"));
	await expect(fixture.write()).rejects.toThrow("symlinks");
	expect(await fs.readdir(fixture.outside)).toEqual([]);
});

test("requires a writable files root and rejects bootstrap calls", async ({ fixture }) => {
	await expect(fixture.write([entry], null, "readonly")).rejects.toThrow(
		"Plugin data write access was not granted",
	);
	await expect(
		fixture.request("files.writeIndex", { root: "data", entries: [entry], expectedHash: null }, true),
	).rejects.toThrow("unavailable during bootstrap");
	expect(await fs.readdir(join(fixture.data, "results"))).toEqual([]);
});

test.for([
	{ label: "extra property", value: { ...entry, extra: true } },
	{ label: "missing property", value: { artifactId: entry.artifactId } },
	{ label: "invalid purpose", value: { ...entry, purpose: "other" } },
	{ label: "invalid sha256", value: { ...entry, sha256: "A".repeat(64) } },
])("rejects an index entry with $label", async ({ value }, { fixture }) => {
	await expect(fixture.write([value])).rejects.toThrow("Invalid plugin capability input: files.writeIndex");
	expect(await fs.readdir(join(fixture.data, "results"))).toEqual([]);
});

test.for([
	{ field: "resultPath", value: "draft/output.txt" },
	{ field: "sourcePath", value: "runs/../source.txt" },
	{ field: "resultPath", value: "results/task/../output.txt" },
	{ field: "sourcePath", value: "/runs/source.txt" },
	{ field: "resultPath", value: "/results/output.txt" },
	{ field: "sourcePath", value: "runs/.drone/source.txt" },
	{ field: "resultPath", value: "results/.drone/output.txt" },
	{ field: "sourcePath", value: "runs\\source.txt" },
	{ field: "resultPath", value: "results\\output.txt" },
])("rejects unsafe $field path $value", async ({ field, value }, { fixture }) => {
	const invalid = { ...entry, [field]: value };
	await expect(fixture.write([invalid])).rejects.toThrow("Plugin index");
	expect(await fs.readdir(join(fixture.data, "results"))).toEqual([]);
});

test.for([
	[{ ...entry }, { ...entry, resultPath: "results/task/run/other.txt" }],
	[{ ...entry }, { ...entry, artifactId: "artifact-2" }],
])("rejects duplicate artifact ids or result paths", async (entries, { fixture }) => {
	await expect(fixture.write(entries)).rejects.toThrow("Plugin index");
	expect(await fs.readdir(join(fixture.data, "results"))).toEqual([]);
});

test("rejects indexes larger than 1 MiB without creating the target", async ({ fixture }) => {
	const oversized = { ...entry, artifactId: "a".repeat(1024 * 1024) };
	await expect(fixture.write([oversized])).rejects.toThrow("Plugin index write exceeds the 1 MiB limit");
	expect(await fs.readdir(join(fixture.data, "results"))).toEqual([]);
});

test("keeps files.writeText from writing JSON indexes", async ({ fixture }) => {
	await expect(
		fixture.request("files.writeText", {
			root: "data",
			path: "results/index.json",
			text: "[]\n",
			expectedHash: null,
		}),
	).rejects.toThrow("JSON persistence requires a JSON state capability");
	expect(await fs.readdir(join(fixture.data, "results"))).toEqual([]);
});

test("does not accept a caller-selected index path", async ({ fixture }) => {
	await expect(
		fixture.request("files.writeIndex", {
			root: "data",
			path: "elsewhere.json",
			entries: [entry],
			expectedHash: null,
		}),
	).rejects.toThrow("Invalid plugin capability input: files.writeIndex");
	expect(await fs.readdir(join(fixture.data, "results"))).toEqual([]);
});
