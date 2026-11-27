import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { fileCapabilityHandlers, PluginFileCapabilities } from "./file-capabilities";
import { PluginCapabilityBroker } from "./runtime-capabilities";

vi.mock("node:fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs/promises")>();
	return { ...actual, link: vi.fn(actual.link), rm: vi.fn(actual.rm) };
});
const disk = await vi.importActual<typeof fs>("node:fs/promises");
type RequestOptions = { bootstrap?: boolean; effect?: "read" | "write"; approve?: boolean };
const original = Buffer.from([0, 255, 13, 10]);
const from = "source.bin";
const to = "results/target.bin";

async function createFixture(directory: string) {
	const data = join(directory, "data");
	const outside = join(directory, "outside");
	const cache = join(directory, "cache");
	await fs.mkdir(join(data, "results"), { recursive: true });
	await fs.mkdir(outside);
	await fs.mkdir(cache);
	await fs.writeFile(join(data, from), original);
	await fs.writeFile(join(outside, from), original);
	const ports = await PluginFileCapabilities.create(
		[
			{ handle: "data", kind: "files", path: data, fileWrite: true, scope: { kind: "application" } },
			{ handle: "other", kind: "files", path: outside, fileWrite: true, scope: { kind: "application" } },
			{ handle: "readonly", kind: "files", path: data, scope: { kind: "application" } },
			{ handle: "state", kind: "state", path: outside, scope: { kind: "application" } },
		],
		cache,
	);
	const call = {
		scope: { kind: "application" } as const,
		signal: new AbortController().signal,
		bootstrap: false,
	};
	const broker = new PluginCapabilityBroker({ handlers: fileCapabilityHandlers(ports), resources: [] });
	const request = (
		operation: string,
		input: unknown,
		{ bootstrap = false, effect = "write", approve = true }: RequestOptions = {},
	) =>
		broker.run(
			{ ...call, bootstrap, pluginId: "fixture", applicationId: "app", callerIdentity: {} },
			effect,
			() => undefined,
			async () => approve,
			() => broker.port.call(operation, input),
		);
	const root = "data";
	const { version: expectedVersion } = (await request("files.stat", { root, path: from })) as Awaited<
		ReturnType<typeof ports.stat>
	>;
	const move = (overrides: Readonly<Record<string, unknown>> = {}, settings?: RequestOptions) =>
		request("files.move", { root, from, to, expectedVersion, ...overrides }, settings);
	return { data, outside, move, request, expectedVersion };
}

const test = it.extend<{ fixture: Awaited<ReturnType<typeof createFixture>> }>({
	fixture: async ({ task: _task }, use) => {
		const directory = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "drone-file-move-")));
		try {
			await use(await createFixture(directory));
		} finally {
			vi.mocked(fs.link).mockReset().mockImplementation(disk.link);
			vi.mocked(fs.rm).mockReset().mockImplementation(disk.rm);
			await disk.rm(directory, { recursive: true, force: true });
		}
	},
});

test("moves exact bytes, confirms both paths and refuses a second move from the old path", async ({
	fixture,
}) => {
	const result = await fixture.move();
	expect(result).toEqual({
		moved: true,
		version: expect.objectContaining({ ...fixture.expectedVersion, ctimeMs: expect.any(Number) }),
	});
	const target = await fixture.request("files.readBinary", { root: "data", path: to });
	expect(target).toMatchObject({
		base64: original.toString("base64"),
		sha256: createHash("sha256").update(original).digest("hex"),
	});
	const info = await fixture.request("files.stat", { root: "data", path: to });
	expect(info).toEqual({ kind: "file", version: expect.any(Object) });
	expect(result).toHaveProperty("version", (info as { version: unknown }).version);
	await expect(fs.lstat(join(fixture.data, from))).rejects.toMatchObject({ code: "ENOENT" });
	await expect(fixture.move({ to: "results/second.bin" })).rejects.toMatchObject({ code: "ENOENT" });
});

test.for([{ from: "../outside/source.bin" }, { to: "../outside/target.bin" }])(
	"rejects traversal in %j",
	async (overrides, { fixture }) => {
		await expect(fixture.move(overrides)).rejects.toThrow("root-relative");
	},
);

test.for([{ from: "alias/source.bin" }, { to: "alias/target.bin" }])(
	"rejects a parent symlink leading outside in %j",
	async (overrides, { fixture }) => {
		await fs.symlink(fixture.outside, join(fixture.data, "alias"), "dir");
		await expect(fixture.move(overrides)).rejects.toThrow("symlinks");
		expect(await fs.readdir(fixture.outside)).toEqual([from]);
	},
);

test("refuses an existing target without changing either file", async ({ fixture }) => {
	const target = join(fixture.data, to);
	await fs.writeFile(target, "keep");
	await expect(fixture.move()).rejects.toMatchObject({ code: "EEXIST" });
	expect(await fs.readFile(target, "utf8")).toBe("keep");
	expect(await fs.readFile(join(fixture.data, from))).toEqual(original);
});

test("rejects a second root handle or an absolute destination to another grant", async ({ fixture }) => {
	await expect(fixture.move({ toRoot: "other" })).rejects.toThrow("Invalid plugin capability input");
	await expect(fixture.move({ to: join(fixture.outside, "target.bin") })).rejects.toThrow("root-relative");
});

test("rejects non-write grants, state roots, bootstrap, read invocations and denied approvals", async ({
	fixture,
}) => {
	await expect(fixture.move({ root: "readonly" })).rejects.toThrow(
		"Plugin data write access was not granted",
	);
	await expect(fixture.move({ root: "state" })).rejects.toThrow("Plugin root capability was not granted");
	await expect(fixture.move({}, { bootstrap: true })).rejects.toThrow("unavailable during bootstrap");
	await expect(fixture.move({}, { effect: "read" })).rejects.toThrow("Read-only plugin invocation");
	await expect(fixture.move({}, { approve: false })).rejects.toThrow("Plugin capability denied");
	expect(await fs.readdir(join(fixture.data, "results"))).toEqual([]);
});

test("rejects a stale version", async ({ fixture }) => {
	const { expectedVersion } = fixture;
	await expect(
		fixture.move({ expectedVersion: { ...expectedVersion, ctimeMs: expectedVersion.ctimeMs - 1 } }),
	).rejects.toThrow("Plugin file version conflict; reread before moving");
	await fs.appendFile(join(fixture.data, from), "changed");
	await expect(fixture.move()).rejects.toThrow("Plugin file version conflict; reread before moving");
});

test("rejects a directory and a symlink as sources", async ({ fixture }) => {
	await fs.symlink(join(fixture.data, from), join(fixture.data, "source-link.bin"));
	await expect(fixture.move({ from: "results" })).rejects.toThrow("regular file");
	await expect(fixture.move({ from: "source-link.bin" })).rejects.toThrow("symlinks");
});

test("requires an existing target parent and nonempty paths", async ({ fixture }) => {
	await expect(fixture.move({ to: "missing/target.bin" })).rejects.toMatchObject({ code: "ENOENT" });
	await expect(fixture.move({ from: "" })).rejects.toThrow("Invalid plugin capability input");
	await expect(fixture.move({ to: "" })).rejects.toThrow("Invalid plugin capability input");
	expect((await fs.readdir(fixture.data)).sort()).toEqual(["results", from]);
});

test("propagates a cross-device link failure without copying or removing the source", async ({ fixture }) => {
	vi.mocked(fs.link).mockRejectedValueOnce(Object.assign(new Error("cross-device link"), { code: "EXDEV" }));
	await expect(fixture.move()).rejects.toMatchObject({ code: "EXDEV" });
	expect(await fs.readFile(join(fixture.data, from))).toEqual(original);
	await expect(fs.lstat(join(fixture.data, to))).rejects.toMatchObject({ code: "ENOENT" });
});

test("removes the new link when post-link verification fails but the source is still present", async ({
	fixture,
}) => {
	vi.mocked(fs.link).mockImplementationOnce(async (source, target) => {
		await disk.link(source, target);
		await disk.appendFile(source, "changed");
	});
	await expect(fixture.move()).rejects.toThrow("changed during move");
	expect(await fs.readFile(join(fixture.data, from))).toEqual(
		Buffer.concat([original, Buffer.from("changed")]),
	);
	await expect(fs.lstat(join(fixture.data, to))).rejects.toMatchObject({ code: "ENOENT" });
});

test("removes the new link after a failed source removal", async ({ fixture }) => {
	vi.mocked(fs.rm).mockRejectedValueOnce(Object.assign(new Error("remove denied"), { code: "EACCES" }));
	await expect(fixture.move()).rejects.toMatchObject({ code: "EACCES" });
	expect(await fs.readFile(join(fixture.data, from))).toEqual(original);
	await expect(fs.lstat(join(fixture.data, to))).rejects.toMatchObject({ code: "ENOENT" });
});

test("preserves the destination when an interrupted removal leaves it as the only link", async ({
	fixture,
}) => {
	vi.mocked(fs.rm).mockImplementationOnce(async (source) => {
		await disk.rm(source);
		throw new Error("source removal outcome unavailable");
	});
	await expect(fixture.move()).rejects.toThrow("link cleanup was not confirmed");
	await expect(fs.lstat(join(fixture.data, from))).rejects.toMatchObject({ code: "ENOENT" });
	expect(await fs.readFile(join(fixture.data, to))).toEqual(original);
});
