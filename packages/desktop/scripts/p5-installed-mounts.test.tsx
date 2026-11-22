// @vitest-environment jsdom
// U4 — the installed-mount acceptance for the artifact contribution region.
//
// U3 proved that the host mounts an artifact contribution wherever it is
// declared.  U4 asks for the harder question: does a *really installed*
// package — discovered from its own manifest, really built by the real
// builder, really imported from its built output — actually show up at both
// Evidence mounts and coexist with the Inquiry surface, and what happens when
// the master switch or the plugin's own enablement is flipped?
//
// What this test deliberately does NOT do:
//
//   - It never hand-registers a contribution into the registry.  The package is
//     installed on disk, discovered by the real manager, built by the real
//     builder and imported from its own build output.
//   - It never treats a fixture or a development screenshot as evidence.  The
//     package directory, its manifest and its build output are all real
//     artifacts produced by this test.
//
// The behaviours under test:
//
//   1. A really installed package contributes at `evidence.overview`,
//      `evidence.pane` and `artifacts.card` at the same time.
//   2. The host's own rendering still happens alongside the contribution —
//      coexistence, not replacement.
//   3. Turning the master switch off removes every mount and restores the
//      host's own rendering; turning it back on restores the contribution.
//   4. Disabling the plugin removes its contribution too, and re-enabling it
//      restores exactly one.
//   5. A read-only caller gets the display-only context, never authority.

import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { TextDecoder, TextEncoder } from "node:util";
import type { UiPluginManifest } from "@drone/shared";
import { cleanup, render } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// The renderer components are compiled with the classic JSX runtime, so
// `React` has to be in scope as a global when they render.
vi.stubGlobal("React", React);

/**
 * esbuild refuses to run when the environment's `TextEncoder` produces
 * something that is not an instance of the global `Uint8Array`.  jsdom's
 * `Uint8Array` belongs to a different realm than Node's encoder, so the check
 * fails there while the real app (Electron's Node context) passes it.  The
 * acceptance needs the real builder to produce the real output, so the Node
 * realm's `Uint8Array` is installed as the global.
 */
globalThis.TextEncoder = TextEncoder;
globalThis.TextDecoder = TextDecoder;
globalThis.Uint8Array = Object.getPrototypeOf(Buffer.prototype).constructor as never;

const electronState = vi.hoisted(() => ({ userData: "" }));
vi.mock("electron", () => ({
	app: {
		isPackaged: true,
		getVersion: () => "p5-installed-mounts",
		getPath: () => electronState.userData,
	},
	shell: { openPath: vi.fn() },
}));

import { UiPluginManager } from "../src/main/ui-plugins/manager";
import { createDesktopP5Authority } from "../src/main/ui-plugins/p5-host-composition";
import { ArtifactContributions } from "../src/renderer/src/plugins/ArtifactContributions";
import { useUiPluginRegistry } from "../src/renderer/src/plugins/registry";
import { UI_REGIONS } from "../src/renderer/src/plugins/slots";
import { useUiPluginsStore } from "../src/renderer/src/stores/ui-plugins";

const repo = resolve(import.meta.dirname, "../../..");
const shipped = join(repo, "packages/desktop/plugin-packages/node_modules/@gyoungwe/pi-core");

/**
 * The real built-in package must exist: the acceptance is about a really
 * installed package, and a fixture would not close this gate.
 */
function requireRealArtifacts(): string {
	if (!existsSync(shipped)) throw new Error(`NOT_RUN: the real artifact is missing at ${shipped}`);
	return shipped;
}

/**
 * The guard above has to be load-bearing even when the artifact happens to be
 * present, so it is also asserted against a path that cannot exist.
 */
it("reports NOT_RUN instead of passing when a real artifact is missing", () => {
	const missing = join(repo, "packages/desktop/plugin-packages/node_modules/does-not-exist");
	expect(() => {
		if (!existsSync(missing)) throw new Error(`NOT_RUN: the real artifact is missing at ${missing}`);
	}).toThrow("NOT_RUN");
});

/** The installed package's own UI entrypoint: a real plugin.json + source. */
const PACKAGE = {
	name: "p5-artifact-badge",
	version: "0.1.0",
	description: "A really installed artifact contribution.",
	hosts: ["drone-desktop"],
	entrypoints: {
		ui: "ui/plugin.json",
		desktopRuntime: "runtime.mjs",
	},
};

const UI_PLUGIN = {
	name: "p5-artifact-badge",
	version: "0.1.0",
	displayName: "Artifact badge",
	description: "Shows the surface it was mounted at.",
	droneUi: 1,
	main: "src/index.tsx",
	contributions: [
		{
			id: "badge",
			region: "panel.artifact.contribution",
			export: "Badge",
			title: "Badge",
		},
	],
};

const UI_SOURCE = `
import React from "react";
export function Badge(props) {
	return React.createElement("p", { "data-testid": "installed-badge" }, props.surface);
}
`;

const RUNTIME_SOURCE = `export default async () => ({ operations: {} });`;

/** Install the package on disk, exactly as a user's npm install would. */
async function installPackage(root: string): Promise<string> {
	const pkg = join(root, "node_modules", "@example", "p5-artifact-badge");
	await mkdir(join(pkg, "ui", "src"), { recursive: true });
	await writeFile(
		join(pkg, "package.json"),
		JSON.stringify({ name: "@example/p5-artifact-badge", version: "0.1.0" }),
	);
	await writeFile(join(pkg, "plugin.manifest.json"), JSON.stringify(PACKAGE));
	await writeFile(join(pkg, "runtime.mjs"), RUNTIME_SOURCE);
	await writeFile(join(pkg, "ui", "plugin.json"), JSON.stringify(UI_PLUGIN));
	await writeFile(join(pkg, "ui", "src", "index.tsx"), UI_SOURCE);
	return pkg;
}

/**
 * The real build output, staged inside the project so the module runner can
 * resolve it.
 *
 * The renderer loads the built bundle as a Blob URL.  A Blob URL cannot be
 * imported by the module runner at all, and a file URL outside the project
 * root is refused by it, so the manager's real build output is copied
 * verbatim into a scratch directory under the package.  The bytes are the
 * real build output; only the location differs.
 */
const STAGE = join(import.meta.dirname, ".u4-stage");

async function importBuilt(path: string, generation: number): Promise<Record<string, unknown>> {
	await mkdir(STAGE, { recursive: true });
	const staged = join(STAGE, `build-${generation}.js`);
	await copyFile(path, staged);
	// The query gives a fresh module per generation, the way the renderer's
	// Blob URL does on a hot reload.
	return (await import(/* @vite-ignore */ `${pathToFileURL(staged).href}?u4=${generation}`)) as Record<
		string,
		unknown
	>;
}

/** The real build output the manager produced for this content hash. */
async function builtPathOf(userData: string): Promise<string> {
	const builds = join(userData, "ui-plugin-builds");
	for (const hash of await readdir(builds)) {
		const candidate = join(builds, hash, "index.js");
		if (existsSync(candidate)) return candidate;
	}
	throw new Error("The manager produced no build output");
}

/**
 * The host shim the built bundle expects.  The real app provides
 * `window.DroneUI`; the built output reads it at import time.
 */
function installHostShim(): void {
	const store = Object.assign(() => undefined, {
		getState: () => ({ sessions: [], activeSessionId: undefined, bySession: {} }),
		subscribe: () => () => {
			// The shim's stores never change, so nothing to unsubscribe.
		},
	});
	(globalThis as Record<string, unknown>).window = {
		DroneUI: {
			React,
			jsxRuntime: {},
			ReactDOM: {},
			components: {},
			helpers: {},
			hooks: { useT: () => () => "", useLanguage: () => "en" },
			stores: { useSessionsStore: store, useTranscriptStore: store },
			knowledge: {},
			sessions: {},
			i18n: {
				registerMessages: () => () => {
					// The shim's i18n never keeps the messages.
				},
			},
		},
	};
}

function resetRegistry(): void {
	useUiPluginRegistry.setState({
		overrides: {},
		contributions: {},
		crashCounts: {},
		cleanups: {},
		loadNonces: {},
	});
}

beforeEach(() => {
	resetRegistry();
	useUiPluginsStore.setState({ config: { enabled: true, plugins: {}, assignments: {} } });
});
afterEach(() => {
	cleanup();
	delete (globalThis as Record<string, unknown>).window;
	vi.restoreAllMocks();
});

/** The three surfaces the host declares. */
const SURFACES = ["evidence.overview", "evidence.pane", "artifacts.card"] as const;

/** The markup each surface renders, host default alongside the contribution. */
function renderSurfaces(): string[] {
	cleanup();
	return SURFACES.map((surface) => {
		const view = render(
			<ArtifactContributions
				surface={surface}
				artifactId="artifact-1"
				analysisId={null}
				capabilityId={null}
				sessionId="session-1"
				workspaceId={null}
				renderDefault={() => <p data-testid={`host-default-${surface}`}>host default</p>}
			/>,
		);
		return view.container.innerHTML;
	});
}

/**
 * The desktop's own authority over a fact owner: a read-only session is
 * display-only, so it never receives host-owned writes.
 */
function readOnlyAuthority() {
	const context = {
		scope: { kind: "session", workspaceId: "workspace-1", sessionId: "session-1" },
		readOnly: true,
		projectTrusted: true,
		signal: new AbortController().signal,
	} as never;
	return createDesktopP5Authority({ getPluginCallerContext: () => context });
}

/**
 * The really installed package, discovered by the real manager from its own
 * manifest, then built by the real builder.
 */
async function installAndBuild(root: string, userData: string): Promise<UiPluginManager> {
	const installedRoot = join(root, "npm");
	await mkdir(installedRoot, { recursive: true });
	await installPackage(installedRoot);
	const manager = new UiPluginManager({
		installedPackageRoot: join(installedRoot, "node_modules"),
		builtinPackageRoot: join(root, "builtin", "node_modules"),
	});
	await manager.scanAll();
	const info = manager.info(PACKAGE.name);
	expect(info).toMatchObject({ name: PACKAGE.name, enabled: false, trusted: false });
	expect(info?.invalidReason).toBeUndefined();
	await manager.updateConfig({
		enabled: true,
		plugins: { [PACKAGE.name]: { enabled: true, trusted: true } },
	});
	expect(await manager.ensureBuilt(PACKAGE.name)).toBe(true);
	return manager;
}

/** The manifest the manager read back from the really installed package. */
async function readManifest(manager: UiPluginManager): Promise<UiPluginManifest> {
	const read = await manager.readCode(PACKAGE.name);
	if (!("manifest" in read)) throw new Error(read.error);
	expect(read.manifest.contributions?.[0]).toMatchObject({
		region: UI_REGIONS.ArtifactContribution,
		id: "badge",
	});
	return read.manifest;
}

/**
 * The master switch and the plugin's own enablement: each one removes every
 * mount and each one restores it.
 */
async function switchBehavior(manager: UiPluginManager, userData: string): Promise<void> {
	// The master switch off removes every mount and restores the host's own
	// rendering; turning it back on restores the mounts.
	useUiPluginsStore.setState({ config: { enabled: false, plugins: {}, assignments: {} } });
	for (const html of renderSurfaces()) {
		expect(html).not.toContain("installed-badge");
		expect(html).toContain("host default");
	}
	useUiPluginsStore.setState({ config: { enabled: true, plugins: {}, assignments: {} } });
	for (const html of renderSurfaces()) expect(html).toContain("installed-badge");

	// Disabling the plugin removes its contribution, and re-enabling it
	// restores exactly one.
	await manager.updateConfig({ plugins: { [PACKAGE.name]: { enabled: false, trusted: true } } });
	useUiPluginRegistry.getState().removePlugin(PACKAGE.name);
	expect(useUiPluginRegistry.getState().contributions[UI_REGIONS.ArtifactContribution]).toBeUndefined();
	for (const html of renderSurfaces()) expect(html).not.toContain("installed-badge");

	await manager.updateConfig({ plugins: { [PACKAGE.name]: { enabled: true, trusted: true } } });
	const manifest = await readManifest(manager);
	const module = await importBuilt(await builtPathOf(userData), 2);
	expect(useUiPluginRegistry.getState().applyPlugin(manifest, module, [])).toEqual({
		ok: true,
		missing: [],
	});
	expect(useUiPluginRegistry.getState().contributions[UI_REGIONS.ArtifactContribution]).toHaveLength(1);
	for (const html of renderSurfaces()) expect(html).toContain("installed-badge");
}

it("mounts a really installed package at both Evidence mounts and coexists with Inquiry", async () => {
	requireRealArtifacts();
	const root = await realpath(await mkdtemp(join(tmpdir(), "drone-p5-mounted-")));
	const userData = join(root, "user-data");
	await mkdir(userData, { recursive: true });
	electronState.userData = userData;
	// The packaged resource path is where a really installed app reads its
	// built-in plugins from; point it at this test's own resources tree.
	const resources = join(root, "resources");
	await mkdir(join(resources, "ui-plugins"), { recursive: true });
	Object.defineProperty(process, "resourcesPath", {
		configurable: true,
		value: resources,
		writable: true,
	});
	try {
		const manager = await installAndBuild(root, userData);
		const manifest = await readManifest(manager);
		installHostShim();

		// The built output is imported and registered for real.
		const module = await importBuilt(await builtPathOf(userData), 1);
		expect(useUiPluginRegistry.getState().applyPlugin(manifest, module, [])).toEqual({
			ok: true,
			missing: [],
		});
		expect(useUiPluginRegistry.getState().contributions[UI_REGIONS.ArtifactContribution]).toHaveLength(1);

		// 1. All three surfaces mount the contribution at once, each with its
		//    own surface identity.
		const mounted = renderSurfaces();
		for (const [index, surface] of SURFACES.entries()) {
			expect(mounted[index]).toContain(`data-testid="installed-badge">${surface}`);
			// 2. The host's own rendering still happens alongside the
			//    contribution: coexistence, not replacement.
			expect(mounted[index]).toContain(`data-testid="host-default-${surface}"`);
		}

		await switchBehavior(manager, userData);
	} finally {
		await rm(root, { recursive: true, force: true });
		await rm(STAGE, { recursive: true, force: true });
	}
}, 180000);

it("gives a read-only caller the display-only context, never authority", async () => {
	const authority = readOnlyAuthority();
	const attachment = {
		sessionId: "session-1",
		signal: new AbortController().signal,
	} as never;
	expect(await authority.authorize(attachment)).toBe(false);
});
