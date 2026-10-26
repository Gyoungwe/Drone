import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fileCapabilityHandlers, type PluginFileCall, PluginFileCapabilities } from "./file-capabilities";
import { PluginCapabilityBroker } from "./runtime-capabilities";

vi.mock("node:fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs/promises")>();
	return { ...actual, rename: vi.fn(actual.rename) };
});
const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
let root: string, data: string, cache: string;
let ports: PluginFileCapabilities;
let call: PluginFileCall;
const input = { root: "notes", path: "note.md" };
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
beforeEach(async () => {
	vi.mocked(fs.rename).mockImplementation(actualFs.rename);
	root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "plugin-file-write-")));
	data = join(root, "data");
	cache = join(root, "cache");
	await fs.mkdir(data);
	await fs.mkdir(cache);
	ports = await PluginFileCapabilities.create(
		[
			{
				handle: "notes",
				path: data,
				kind: "files",
				fileWrite: true,
				scope: { kind: "workspace", workspaceId: "alpha" },
			},
		],
		cache,
	);
	call = {
		scope: { kind: "session", workspaceId: "alpha", workspaceDirectory: data, sessionId: "one" },
		signal: new AbortController().signal,
		bootstrap: false,
	};
});
afterEach(async () => {
	vi.restoreAllMocks();
	await fs.rm(root, { recursive: true, force: true });
});

describe("approved plugin text mutations", () => {
	it("creates, replaces and removes exact versions with real readbacks and preserved mode", async () => {
		const first = await ports.writeText({ ...input, text: "# First\n", expectedHash: null }, call);
		expect(first).toMatchObject({ text: "# First\n", sha256: hash("# First\n") });
		expect((await fs.stat(join(data, input.path))).mode & 0o777).toBe(0o600);
		await fs.chmod(join(data, input.path), 0o640);
		const second = await ports.writeText({ ...input, text: "# Second\n", expectedHash: first.sha256 }, call);
		expect(second.sha256).toBe(hash("# Second\n"));
		expect((await fs.stat(join(data, input.path))).mode & 0o777).toBe(0o640);
		await expect(ports.removeText({ ...input, expectedHash: first.sha256 }, call)).rejects.toThrow(
			"version conflict",
		);
		expect(await ports.removeText({ ...input, expectedHash: second.sha256 }, call)).toEqual({
			removed: true,
		});
		expect(await fs.readdir(data)).toEqual([]);
		await expect(ports.removeText({ ...input, expectedHash: second.sha256 }, call)).rejects.toMatchObject({
			code: "ENOENT",
		});
	});
	it("rejects two create-only contenders and two edits using the same old content hash", async () => {
		const creates = await Promise.allSettled([
			ports.writeText({ ...input, text: "a", expectedHash: null }, call),
			ports.writeText({ ...input, text: "b", expectedHash: null }, call),
		]);
		expect(creates.filter((r) => r.status === "fulfilled")).toHaveLength(1);
		const initial = await ports.readText(input, call);
		const updates = await Promise.allSettled([
			ports.writeText({ ...input, text: "c", expectedHash: initial.sha256 }, call),
			ports.writeText({ ...input, text: "d", expectedHash: initial.sha256 }, call),
		]);
		expect(updates.filter((r) => r.status === "fulfilled")).toHaveLength(1);
		expect(updates.filter((r) => r.status === "rejected")[0]).toMatchObject({
			reason: expect.objectContaining({ message: expect.stringContaining("version conflict") }),
		});
	});
	it("rejects a stale edit before commit when two case aliases name one file", async (context) => {
		await ports.writeText({ ...input, text: "old", expectedHash: null }, call);
		try {
			await fs.stat(join(data, "NOTE.md"));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			context.skip();
			return;
		}
		const results = await Promise.allSettled([
			ports.writeText({ ...input, text: "first", expectedHash: hash("old") }, call),
			ports.writeText({ ...input, path: "NOTE.md", text: "second", expectedHash: hash("old") }, call),
		]);
		expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
		expect(results.filter((result) => result.status === "rejected")).toEqual([
			expect.objectContaining({
				reason: expect.objectContaining({ message: "Plugin file version conflict; reread before writing" }),
			}),
		]);
		expect(await fs.readFile(join(data, input.path), "utf8")).toBe("first");
	});

	it("drains an entered write and refuses a canceled mutation waiting behind it", async () => {
		await ports.writeText({ ...input, text: "old", expectedHash: null }, call);
		let entered!: () => void;
		let release!: () => void;
		const started = new Promise<void>((resolve) => {
			entered = resolve;
		});
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		vi.mocked(fs.rename).mockImplementationOnce(async (...args) => {
			entered();
			await gate;
			return actualFs.rename(...args);
		});
		const first = ports.writeText({ ...input, text: "first", expectedHash: hash("old") }, call);
		await started;
		const controller = new AbortController();
		const waiting = ports.writeText(
			{ ...input, text: "late", expectedHash: hash("first") },
			{ ...call, signal: controller.signal },
		);
		const canceled = expect(waiting).rejects.toThrow("session closed");
		controller.abort(new Error("session closed"));
		expect(await fs.readFile(join(data, input.path), "utf8")).toBe("old");
		release();
		await first;
		await canceled;
		expect(await fs.readFile(join(data, input.path), "utf8")).toBe("first");
		expect(await fs.readdir(data)).toEqual([input.path]);
	});

	it("preserves the original and cleans temporary bytes after a real commit error", async () => {
		await ports.writeText({ ...input, text: "old", expectedHash: null }, call);
		vi.mocked(fs.rename).mockRejectedValueOnce(Object.assign(new Error("disk denied"), { code: "EACCES" }));
		await expect(ports.writeText({ ...input, text: "new", expectedHash: hash("old") }, call)).rejects.toThrow(
			"disk denied",
		);
		expect(await fs.readFile(join(data, input.path), "utf8")).toBe("old");
		expect(await fs.readdir(data)).toEqual([input.path]);
	});
	it("creates only an explicitly requested directory and does not grant JSON persistence or recursive initialization", async () => {
		await expect(
			ports.writeText({ ...input, path: "new/note.md", text: "new", expectedHash: null }, call),
		).rejects.toMatchObject({ code: "ENOENT" });
		expect(await fs.readdir(data)).toEqual([]);
		expect(await ports.ensureFileDirectory({ root: "notes", path: "new" }, call)).toEqual({ created: true });
		expect(await ports.ensureFileDirectory({ root: "notes", path: "new" }, call)).toEqual({ created: false });
		await ports.writeText({ ...input, path: "new/note.md", text: "new", expectedHash: null }, call);
		await expect(
			ports.writeText({ ...input, path: "config.json", text: "{}", expectedHash: null }, call),
		).rejects.toThrow("JSON persistence");
		await fs.writeFile(join(data, "config.json"), "{}");
		await expect(
			ports.removeText({ root: "notes", path: "config.json", expectedHash: hash("{}") }, call),
		).rejects.toThrow("JSON removal");
	});
	it("never upgrades a read-only data grant and rejects cross-workspace or escaped paths", async () => {
		const readonly = await PluginFileCapabilities.create(
			[{ handle: "notes", path: data, kind: "files", scope: { kind: "application" } }],
			cache,
		);
		await expect(readonly.writeText({ ...input, text: "new", expectedHash: null }, call)).rejects.toThrow(
			"not granted",
		);
		await expect(
			ports.writeText(
				{ ...input, text: "new", expectedHash: null },
				{ ...call, scope: { kind: "application" } },
			),
		).rejects.toThrow("another workspace");
		await expect(
			ports.writeText({ ...input, path: "../escaped.md", text: "new", expectedHash: null }, call),
		).rejects.toThrow("root-relative");
		await fs.mkdir(join(root, "outside"));
		await fs.writeFile(join(root, "outside/note.md"), "keep");
		await fs.symlink(join(root, "outside"), join(data, "alias"));
		await fs.symlink(join(root, "outside/note.md"), join(data, "linked.md"));
		for (const path of ["alias/note.md", "linked.md"]) {
			await expect(
				ports.writeText({ ...input, path, text: "replace", expectedHash: hash("keep") }, call),
			).rejects.toThrow("symlinks");
			await expect(ports.removeText({ ...input, path, expectedHash: hash("keep") }, call)).rejects.toThrow(
				"symlinks",
			);
		}
		expect(await fs.readFile(join(root, "outside/note.md"), "utf8")).toBe("keep");
	});
	it("requires real broker write approval and cancels an approval before touching data", async () => {
		const broker = new PluginCapabilityBroker({ handlers: fileCapabilityHandlers(ports), resources: [] });
		const controller = new AbortController();
		const ctx = {
			pluginId: "test",
			applicationId: "app",
			callerIdentity: {},
			...call,
			signal: controller.signal,
		};
		const create = () => broker.port.call("files.writeText", { ...input, text: "new", expectedHash: null });
		await expect(
			broker.run(
				ctx,
				"read",
				() => {},
				async () => true,
				create,
			),
		).rejects.toThrow("Read-only");
		await expect(
			broker.run(
				ctx,
				"write",
				() => {},
				async () => false,
				create,
			),
		).rejects.toThrow("denied");
		await expect(
			broker.run(
				ctx,
				"write",
				() => {},
				async () => {
					controller.abort(new Error("session closed"));
					return true;
				},
				create,
			),
		).rejects.toThrow("session closed");
		expect(await fs.readdir(data)).toEqual([]);
	});
});
