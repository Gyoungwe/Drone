// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginCapabilityContext, PluginRuntimeSource } from "@drone/backend";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: {}, BrowserWindow: {}, dialog: {}, webContents: {} }));

import { createDesktopResourceCapabilities } from "./runtime-host";

let root: string;
let profile: string;
let state: string;
let data: string;
let source: PluginRuntimeSource;
const activation = () => ({
	pluginId: "@example/index",
	applicationId: "app",
	signal: new AbortController().signal,
	events: { changed: vi.fn() },
});
const context = (signal: AbortSignal): PluginCapabilityContext => ({
	pluginId: "@example/index",
	applicationId: "app",
	signal,
	scope: { kind: "application" },
	bootstrap: false,
	callerIdentity: {},
	capabilities: {
		call: async () => {
			throw new Error("Unexpected nested capability");
		},
	},
});

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "drone-runtime-access-"));
	profile = join(root, "profile");
	state = join(root, "selected-state");
	data = join(root, "selected-data");
	await Promise.all([profile, state, data].map((path) => mkdir(path)));
	source = {
		pluginId: "@example/index",
		packageRoot: root,
		entrypoint: join(root, "runtime.js"),
		resources: { index: join(root, "resource.js") },
	};
});
afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe("desktop activation directory grants", () => {
	it("keeps ordinary runtimes at zero roots without showing a picker or creating caches", async () => {
		const selectDirectories = vi.fn();
		const ports = await createDesktopResourceCapabilities({ ...source, resources: undefined }, root, {
			profileDirectory: profile,
			selectDirectories,
		})(activation());
		expect(ports.resources).toEqual([]);
		expect(ports.handlers).toEqual({});
		expect(selectDirectories).not.toHaveBeenCalled();
		expect(await readdir(profile)).toEqual([]);
	});

	for (const canceled of ["state", "files"] as const) {
		it(`rejects a canceled ${canceled} selection without initializing resources`, async () => {
			const selectDirectories = vi.fn(async (kind: "state" | "files") => (kind === canceled ? [] : [state]));
			await expect(
				createDesktopResourceCapabilities(source, root, { profileDirectory: profile, selectDirectories })(
					activation(),
				),
			).rejects.toThrow("selection was canceled");
			expect(await readdir(profile)).toEqual([]);
		});
	}

	it("cancels a pending picker and ignores its late answer", async () => {
		const abort = new AbortController();
		let answer!: (paths: string[]) => void;
		const selectDirectories = vi.fn(
			() =>
				new Promise<string[]>((resolve) => {
					answer = resolve;
				}),
		);
		const pending = createDesktopResourceCapabilities(source, root, {
			profileDirectory: profile,
			selectDirectories,
		})({ ...activation(), signal: abort.signal });
		await vi.waitFor(() => expect(answer).toBeDefined());
		abort.abort(new Error("activation canceled"));
		await expect(pending).rejects.toThrow("activation canceled");
		answer([state]);
		await Promise.resolve();
		expect(selectDirectories).toHaveBeenCalledTimes(1);
		expect(await readdir(profile)).toEqual([]);
	});

	it("grants only canonical selected directories with fresh handles and a separate private cache", async () => {
		await writeFile(join(state, "binding.json"), JSON.stringify({ vault: join(root, "unselected") }));
		await writeFile(join(data, "note.md"), "selected data");
		const alias = join(root, "data-alias");
		await symlink(data, alias);
		const selectDirectories = vi.fn(async (kind: "state" | "files") =>
			kind === "state" ? [state] : [alias, data],
		);
		const provider = createDesktopResourceCapabilities(source, root, {
			profileDirectory: profile,
			selectDirectories,
		});
		const current = activation();
		const ports = await provider(current);
		expect(ports.resources.map((root) => root.kind)).toEqual(["state", "files"]);
		const stateHandle = ports.resources.find((root) => root.kind === "state")?.handle;
		const fileHandle = ports.resources.find((root) => root.kind === "files")?.handle;
		const call = context(current.signal);
		expect(
			await ports.handlers["state.readJson"]?.execute({ root: stateHandle, path: "binding.json" }, call),
		).toMatchObject({ kind: "value" });
		expect(
			await ports.handlers["files.readText"]?.execute({ root: fileHandle, path: "note.md" }, call),
		).toMatchObject({ text: "selected data" });
		await expect(
			ports.handlers["roots.resolve"]?.execute({ path: join(root, "unselected"), kind: "files" }, call),
		).rejects.toThrow("not granted");
		await expect(
			ports.handlers["files.readText"]?.execute({ root: stateHandle, path: "binding.json" }, call),
		).rejects.toThrow("not granted");
		const cache = join(
			await realpath(profile),
			"plugin-runtime-cache",
			createHash("sha256").update(source.pluginId).digest("hex"),
		);
		expect((await stat(cache)).mode & 0o777).toBe(0o700);
		expect(await readdir(state)).toEqual(["binding.json"]);
		expect(await readdir(data)).toEqual(["note.md"]);
		const again = await provider(activation());
		expect(new Set([...ports.resources, ...again.resources].map((root) => root.handle)).size).toBe(4);
		await ports.dispose?.();
		await again.dispose?.();
	});

	it("rejects a private-cache symlink before creating anything in the outside directory", async () => {
		const outside = join(root, "outside");
		await mkdir(outside);
		await symlink(outside, join(profile, "plugin-runtime-cache"));
		await expect(
			createDesktopResourceCapabilities(source, root, {
				profileDirectory: profile,
				selectDirectories: async (kind) => [kind === "state" ? state : data],
			})(activation()),
		).rejects.toThrow("inside the host profile");
		expect(await readdir(outside)).toEqual([]);
	});
});
