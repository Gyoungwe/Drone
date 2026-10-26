import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JsonStoreCorruptedError } from "../json-store";
import { type PluginFileCall, PluginFileCapabilities } from "./file-capabilities";

vi.mock("node:fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs/promises")>();
	return { ...actual, open: vi.fn(actual.open), lstat: vi.fn(actual.lstat) };
});
const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");

let root: string;
let files: string;
let state: string;
let privateCache: string;
let ports: PluginFileCapabilities;
let controller: AbortController;
let call: PluginFileCall;

beforeEach(async () => {
	vi.mocked(fs.open).mockImplementation(actualFs.open);
	vi.mocked(fs.lstat).mockImplementation(actualFs.lstat);
	root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "drone-root-ports-")));
	files = join(root, "files");
	state = join(root, "state");
	await fs.mkdir(files);
	await fs.mkdir(state);
	privateCache = join(root, "host-private-cache");
	await fs.mkdir(privateCache);
	controller = new AbortController();
	call = {
		scope: {
			kind: "session",
			workspaceId: "workspace-a",
			workspaceDirectory: "/Work/Files",
			sessionId: "session-a",
		},
		signal: controller.signal,
		bootstrap: false,
	};
	ports = await PluginFileCapabilities.create(
		[
			{
				handle: "selected-files",
				path: files,
				kind: "files",
				scope: { kind: "workspace", workspaceId: "workspace-a" },
			},
			{ handle: "application-state", path: state, kind: "state", scope: { kind: "application" } },
		],
		privateCache,
	);
});

afterEach(async () => {
	vi.restoreAllMocks();
	await fs.rm(root, { recursive: true, force: true });
});

describe("authorized plugin file ports", () => {
	it("returns stable file bytes, content hash and metadata under the authorized root", async () => {
		const bytes = Buffer.from("# 方法笔记\n");
		await fs.writeFile(join(files, "note.md"), bytes);
		const result = await ports.readText({ root: "selected-files", path: "note.md" }, call);
		expect(result.text).toBe(bytes.toString("utf8"));
		expect(result.bytes).toBe(bytes.length);
		expect(result.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
		expect(result.version).toEqual(expect.objectContaining({ size: bytes.length }));
		expect(await ports.stat({ root: "selected-files", path: "note.md" }, call)).toEqual({
			kind: "file",
			version: result.version,
		});
		expect(await ports.list({ root: "selected-files", path: "" }, call)).toEqual([
			{ name: "note.md", kind: "file" },
		]);
	});

	it("distinguishes missing, JSON null and corrupt state without overwriting it", async () => {
		const input = { root: "application-state", path: "binding.json" };
		const bootstrap = { ...call, scope: { kind: "application" } as const, bootstrap: true };
		expect(await ports.readJson(input, bootstrap)).toEqual({ kind: "missing" });
		await fs.writeFile(join(state, "binding.json"), "null\n");
		expect(await ports.readJson(input, bootstrap)).toEqual({ kind: "value", value: null });
		await fs.writeFile(join(state, "binding.json"), "{broken");
		await expect(ports.readJson(input, bootstrap)).rejects.toBeInstanceOf(JsonStoreCorruptedError);
		expect(await fs.readFile(join(state, "binding.json"), "utf8")).toBe("{broken");
	});

	it("rejects ungranted handles, cross-workspace callers and bootstrap file access", async () => {
		await fs.writeFile(join(files, "note.md"), "private to the selected root");
		await expect(ports.readText({ root: "forged", path: "note.md" }, call)).rejects.toThrow("not granted");
		await expect(ports.readText({ root: "application-state", path: "binding.json" }, call)).rejects.toThrow(
			"not granted",
		);
		await expect(
			ports.readText(
				{ root: "selected-files", path: "note.md" },
				{
					...call,
					scope: { kind: "workspace", workspaceId: "workspace-b", workspaceDirectory: "/Work/Other" },
				},
			),
		).rejects.toThrow("another workspace");
		await expect(
			ports.readText({ root: "selected-files", path: "note.md" }, { ...call, bootstrap: true }),
		).rejects.toThrow("Bootstrap");
	});

	it.each([
		"../outside.md",
		"/outside.md",
		"nested/../outside.md",
		"nested\\outside.md",
		"nested//outside.md",
	])("rejects path traversal %s", async (path) => {
		await expect(ports.readText({ root: "selected-files", path }, call)).rejects.toThrow("root-relative");
	});

	it("lists a symlink as metadata but never follows it or a linked parent", async () => {
		await fs.writeFile(join(state, "secret.txt"), "outside grant");
		await fs.symlink(join(state, "secret.txt"), join(files, "alias.md"));
		await fs.symlink(state, join(files, "linked-directory"));
		expect(await ports.list({ root: "selected-files", path: "" }, call)).toEqual(
			expect.arrayContaining([{ name: "alias.md", kind: "symlink" }]),
		);
		await expect(ports.readText({ root: "selected-files", path: "alias.md" }, call)).rejects.toThrow(
			"symlinks",
		);
		await expect(
			ports.readText({ root: "selected-files", path: "linked-directory/secret.txt" }, call),
		).rejects.toThrow("symlinks");
	});

	it("revokes a grant when the authorized root is replaced", async () => {
		await fs.rename(files, join(root, "old-files"));
		await fs.mkdir(files);
		await fs.writeFile(join(files, "note.md"), "replacement");
		await expect(ports.readText({ root: "selected-files", path: "note.md" }, call)).rejects.toThrow(
			"changed after authorization",
		);
	});

	it("does not deliver a read accepted before its caller was canceled", async () => {
		await fs.writeFile(join(files, "note.md"), "accepted before close");
		const original = actualFs.open;
		vi.mocked(fs.open).mockImplementation(async (...args) => {
			const handle = await original(...args);
			controller.abort(new Error("session closed"));
			return handle;
		});
		await expect(ports.readText({ root: "selected-files", path: "note.md" }, call)).rejects.toThrow(
			"session closed",
		);
	});

	it("rejects a replaced file instead of returning bytes from an old descriptor", async () => {
		const note = join(files, "note.md");
		await fs.writeFile(note, "original");
		const original = actualFs.open;
		vi.mocked(fs.open).mockImplementation(async (...args) => {
			const handle = await original(...args);
			await fs.rename(note, join(files, "old-note.md"));
			await fs.writeFile(note, "replaced");
			return handle;
		});
		await expect(ports.readText({ root: "selected-files", path: "note.md" }, call)).rejects.toThrow(
			"changed during read",
		);
	});

	it("rejects files beyond the existing text-read bound", async () => {
		await fs.writeFile(join(files, "large.md"), Buffer.alloc(1024 * 1024 + 1));
		await expect(ports.readText({ root: "selected-files", path: "large.md" }, call)).rejects.toThrow("1 MiB");
	});
	it("rechecks containment when a parent changes between resolving and inspecting metadata", async () => {
		const directory = join(files, "nested"),
			outside = join(root, "outside");
		await fs.mkdir(directory);
		await fs.mkdir(outside);
		const note = join(directory, "note.md");
		await fs.writeFile(note, "inside");
		await fs.writeFile(join(outside, "note.md"), "outside");
		let inspections = 0;
		vi.mocked(fs.lstat).mockImplementation(async (...args) => {
			if (args[0] === note && ++inspections === 2) {
				await fs.rename(directory, join(files, "old-nested"));
				await fs.symlink(outside, directory);
			}
			return actualFs.lstat(...args);
		});
		await expect(ports.stat({ root: "selected-files", path: "nested/note.md" }, call)).rejects.toThrow(
			"symlinks",
		);
	});

	it("matches only previously granted roots and keeps resource caches in a separate private host directory", async () => {
		expect(await ports.resolveRoot({ path: files, kind: "files" }, call)).toEqual({
			handle: "selected-files",
		});
		await expect(ports.resolveRoot({ path: root, kind: "files" }, call)).rejects.toThrow("not granted");
		const cache = await ports.storageDirectory(
			{ root: "application-state", key: "../../binding.json" },
			"index",
			call,
		);
		expect(cache.startsWith(`${privateCache}/`)).toBe(true);
		expect((await fs.stat(cache)).isDirectory()).toBe(true);
		expect(
			await ports.storageDirectory({ root: "application-state", key: "../../binding.json" }, "index", call),
		).toBe(cache);
		await expect(
			ports.storageDirectory({ root: "selected-files", key: "cache" }, "index", call),
		).rejects.toThrow("not granted");
	});
	it("distinguishes an unavailable authorized root from an individual deleted file", async () => {
		await expect(ports.readText({ root: "selected-files", path: "missing.md" }, call)).rejects.toMatchObject({
			code: "ENOENT",
		});
		await fs.rename(files, join(root, "removed-files"));
		await expect(ports.readText({ root: "selected-files", path: "missing.md" }, call)).rejects.toThrow(
			"root disappeared",
		);
	});
});
