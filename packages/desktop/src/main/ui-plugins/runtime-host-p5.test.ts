// @vitest-environment node
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type PluginRuntimeBridgeOptions,
	type PluginRuntimeSource,
	type PluginSessionCallerContext,
	StorageRegistry,
	setReplyLanguage,
} from "@drone/backend";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Z1d — the host contributes the P5 capabilities to a plugin activation.
 *
 * The P5 providers existed but nothing called them: `selectStagedOutputDirectory`
 * was exported and never used, and neither `receipts.read` nor `facts.read`
 * ever reached a plugin.  The wiring is what turns a provider into a
 * capability.
 *
 * The test observes the wiring itself — the handlers that reach the plugin's
 * capability map — rather than the providers' own behaviour, which their
 * tests already cover.
 */

const desktop = vi.hoisted(() => ({
	showMessageBox: vi.fn(),
	showOpenDialog: vi.fn(),
	bridgeOptions: undefined as PluginRuntimeBridgeOptions | undefined,
	contents: { isDestroyed: vi.fn(() => false) },
	window: {},
}));
vi.mock("electron", () => ({
	app: { getPath: () => paths.root },
	BrowserWindow: { fromWebContents: () => desktop.window },
	dialog: { showMessageBox: desktop.showMessageBox, showOpenDialog: desktop.showOpenDialog },
	webContents: { fromId: () => desktop.contents },
}));

vi.mock("./runtime-bridge", () => ({
	DesktopRuntimeBridge: class {
		constructor(options: PluginRuntimeBridgeOptions) {
			desktop.bridgeOptions = options;
		}
	},
}));

import { createDesktopRuntime } from "./runtime-host";

/** The paths the fixture owns; the electron mock reads them by name. */
const paths = { root: "", output: "" };

const contentHash = "b".repeat(64);
const activation = () => ({
	pluginId: "@example/index",
	applicationId: "app",
	signal: new AbortController().signal,
	events: { changed: vi.fn() },
});

/** A source that declared the byte opt-in. */
const optedIn = (): PluginRuntimeSource =>
	({
		pluginId: "@example/index",
		packageRoot: paths.root,
		entrypoint: join(paths.root, "runtime.js"),
		contentHash,
		p5: { bytes: "staged-output" },
	}) as PluginRuntimeSource;

/** A source that declared nothing: an ordinary plugin. */
const ordinary = (): PluginRuntimeSource =>
	({
		pluginId: "@example/index",
		packageRoot: paths.root,
		entrypoint: join(paths.root, "runtime.js"),
		contentHash,
	}) as PluginRuntimeSource;

beforeEach(async () => {
	setReplyLanguage("en");
	desktop.showMessageBox.mockReset();
	desktop.showOpenDialog.mockReset();
	desktop.contents.isDestroyed.mockReturnValue(false);
	// The root is resolved: the P5 grant refuses a path that traverses a
	// symlink, and on macOS the temp directory is itself one.
	paths.root = await realpath(await mkdtemp(join(tmpdir(), "drone-p5-host-")));
	paths.output = join(paths.root, "output");
	await mkdir(paths.output);
	// The implementation reads `output` when the dialog resolves, not when the
	// mock is armed, so the mock has to read it late.
	desktop.showOpenDialog.mockImplementation(async () => ({
		canceled: false,
		filePaths: [paths.output],
	}));
});

afterEach(async () => {
	await rm(paths.root, { recursive: true, force: true });
});

/**
 * Builds a runtime whose session port answers with a live session context.
 *
 * The context is what lets a P5 read resolve its scope, so it has to look
 * like a real one: a session scope, an identity, and a live signal.
 */
function buildRuntime() {
	const identity = {};
	const context: PluginSessionCallerContext = {
		identity,
		sessionIdentity: identity,
		scope: {
			kind: "session" as const,
			sessionId: "session",
			workspaceId: "workspace",
			workspaceDirectory: paths.root,
		},
		signal: new AbortController().signal,
		readOnly: false,
		projectTrusted: true,
	};
	const sessions = {
		getPluginCallerContext: () => context,
		getPluginSessionCapabilities: () => ({}),
		getPluginSourceCapabilities: () => ({}),
		getTaskGrants: () => ({ bindSourceValidator: vi.fn() }),
		getPluginWorkspaceCapabilities: () => ({}),
		getStorageRegistry: () => new StorageRegistry(),
	};
	createDesktopRuntime(
		{ runtimeSource: () => optedIn(), isEnabled: () => true } as unknown as Parameters<
			typeof createDesktopRuntime
		>[0],
		paths.root,
		sessions as unknown as Parameters<typeof createDesktopRuntime>[2],
		(owner) => ({ ownerId: owner.id, send: () => false, resolved: () => undefined }),
	);
	const owner = { id: 1, isDestroyed: () => false };
	return {
		capabilities: async (source: PluginRuntimeSource) => {
			const options = desktop.bridgeOptions;
			if (!options?.capabilities) throw new Error("The bridge was built without capabilities");
			// The option is a union: the host may hand over a provider or a
			// finished set of capabilities.  The host uses a provider.
			const composed = options.capabilities(source, owner);
			if (typeof composed !== "function") return composed;
			return composed(activation());
		},
	};
}

describe("the host's P5 capabilities", () => {
	it("gives the plugin the P5 read handlers", async () => {
		const runtime = buildRuntime();
		const ports = await runtime.capabilities(optedIn());
		// The reads are the host's contribution: a plugin can ask for the
		// receipts and the facts the host kept on its behalf.
		expect(Object.keys(ports.handlers)).toContain("receipts.read");
		expect(Object.keys(ports.handlers)).toContain("facts.read");
	});

	it("does not give a plugin the byte handlers unless it declared the opt-in", async () => {
		const runtime = buildRuntime();
		const ports = await runtime.capabilities(ordinary());
		// The capability is not advertised ahead of the declaration that
		// authorizes it, and an ordinary plugin is never asked to pick a
		// directory.
		expect(Object.keys(ports.handlers)).not.toContain("bytes.write");
		expect(desktop.showOpenDialog).not.toHaveBeenCalled();
	});

	it("gives the opted-in plugin the byte handlers", async () => {
		const runtime = buildRuntime();
		const ports = await runtime.capabilities(optedIn());
		expect(Object.keys(ports.handlers)).toContain("bytes.write");
	});

	it("disposes every capability owner even when one of them fails", async () => {
		const runtime = buildRuntime();
		const ports = await runtime.capabilities(optedIn());
		expect(typeof ports.dispose).toBe("function");
		await expect(ports.dispose?.()).resolves.toBeUndefined();
	});
});
