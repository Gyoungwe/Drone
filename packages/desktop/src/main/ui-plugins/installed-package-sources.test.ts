// @vitest-environment node
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
	discoverInstalledPackages,
	discoverInstalledUiPackages,
	installedPackageHash,
} from "./installed-package-sources";

let root: string;
let modules: string;
let directory: string;

async function manifest(extra: Record<string, unknown> = {}) {
	await writeFile(
		join(directory, "plugin.manifest.json"),
		JSON.stringify({
			hosts: ["drone-desktop"],
			entrypoints: { desktopRuntime: "./runtime.mjs", extension: "./native.mjs" },
			...extra,
		}),
	);
}

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "drone-native-package-sources-"));
	modules = join(root, "node_modules");
	directory = join(modules, "@example", "native");
	await mkdir(directory, { recursive: true });
	await writeFile(
		join(root, "package.json"),
		JSON.stringify({ dependencies: { "@example/native": "1.0.0" } }),
	);
	await writeFile(
		join(directory, "package.json"),
		JSON.stringify({ name: "@example/native", version: "1.0.0" }),
	);
	for (const file of ["runtime.mjs", "native.mjs"])
		await writeFile(join(directory, file), 'throw new Error("Discovery must never execute this file");\n');
	await manifest();
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

it("discovers a native owner without inventing a UI contribution or executing package code", async () => {
	const sources = await discoverInstalledPackages(modules);
	expect(sources).toEqual([
		{
			packageName: "@example/native",
			packageRoot: await realpath(directory),
			runtime: {
				pluginId: "@example/native",
				packageRoot: await realpath(directory),
				installationPath: await realpath(directory),
				entrypoint: await realpath(join(directory, "runtime.mjs")),
				nativeEntrypoint: await realpath(join(directory, "native.mjs")),
				nativeDeclaredPath: await realpath(join(directory, "native.mjs")),
				contentHash: installedPackageHash(directory),
			},
		},
	]);
	expect(await discoverInstalledUiPackages(modules)).toEqual([]);
});

it("changes the source generation when a transitive dependency changes at the same paths", async () => {
	const dependency = join(directory, "node_modules", "library");
	await mkdir(dependency, { recursive: true });
	const file = join(dependency, "index.mjs");
	await writeFile(file, "export const version = 1;\n");
	const [before] = await discoverInstalledPackages(modules);
	await writeFile(file, "export const version = 2;\n");
	const [after] = await discoverInstalledPackages(modules);
	if (!before || "error" in before || !after || "error" in after)
		throw new Error("Expected a validated package source");
	expect(after.runtime?.entrypoint).toBe(before.runtime?.entrypoint);
	expect(after.runtime?.contentHash).not.toBe(before.runtime?.contentHash);
});

it("retains a required publisher declaration for a native package without UI", async () => {
	await manifest({ drone: { deliveryProjection: "required" } });
	expect(await discoverInstalledPackages(modules)).toMatchObject([
		{ runtime: { deliveryProjection: "required", contentHash: installedPackageHash(directory) } },
	]);
});

it("decodes service-only declarations from the same native source without loading plugin code", async () => {
	await manifest({
		requires: { hostCapabilities: ["vault-read"] },
		drone: {
			provides: { "checkpoint.runtime": { version: 1, operations: ["status", "update"] } },
			requires: { audit: { service: "audit.runtime", version: 2 } },
		},
	});
	expect(await discoverInstalledPackages(modules)).toMatchObject([
		{
			runtime: {
				provides: { "checkpoint.runtime": { version: 1, operations: ["status", "update"] } },
				requires: { audit: { service: "audit.runtime", version: 2 } },
				contentHash: installedPackageHash(directory),
			},
		},
	]);
	expect(await discoverInstalledUiPackages(modules)).toEqual([]);
});

it.each([
	{ drone: { provides: { "checkpoint.runtime": { version: 1, operations: ["status", "status"] } } } },
	{ drone: { provides: { "checkpoint.runtime": { version: 0, operations: ["status"] } } } },
	{ drone: { requires: { audit: { service: "audit.runtime", version: 1, package: "optional-package" } } } },
	{ drone: { provides: ["checkpoint.runtime"] } },
])("diagnoses an invalid installed service contract without activating it: %j", async (extra) => {
	await manifest(extra);
	expect(await discoverInstalledPackages(modules)).toEqual([
		{ packageName: "@example/native", error: expect.stringContaining("Invalid desktopRuntime:") },
	]);
});

it("refuses service declarations without a managed owner", async () => {
	await manifest({
		entrypoints: { extension: "./native.mjs" },
		drone: { provides: { "checkpoint.runtime": { version: 1, operations: ["status"] } } },
	});
	expect(await discoverInstalledPackages(modules)).toEqual([
		{ packageName: "@example/native", error: "drone service declarations require a desktopRuntime owner" },
	]);
});

it("decodes exact temporary legacy adoption declarations from the installed source", async () => {
	const recordAdoptions = {
		recovery: {
			legacyType: "legacy-recovery-v1",
			fromVersions: ["0.2.0", "0.2.1"],
			removeBeforeVersion: "2.0.0",
		},
	};
	await manifest({ drone: { recordAdoptions } });
	expect(await discoverInstalledPackages(modules)).toMatchObject([{ runtime: { recordAdoptions } }]);
});
it.each([
	{
		legacyType: "plugin-record:another-source:private",
		fromVersions: ["0.2.1"],
		removeBeforeVersion: "2.0.0",
	},
	{ legacyType: "legacy-recovery-v1", fromVersions: ["0.2.x"], removeBeforeVersion: "2.0.0" },
	{ legacyType: "legacy-recovery-v1", fromVersions: ["0.2.1"], removeBeforeVersion: "1.0.0" },
])(
	"rejects an adoption namespace escape, unsupported version range or expired deletion version: %j",
	async (declaration) => {
		await manifest({ drone: { recordAdoptions: { recovery: declaration } } });
		expect(await discoverInstalledPackages(modules)).toEqual([
			{ packageName: "@example/native", error: expect.stringContaining("Invalid desktopRuntime:") },
		]);
	},
);
it("requires a managed owner before exposing a legacy migration declaration", async () => {
	await manifest({
		entrypoints: { extension: "./native.mjs" },
		drone: {
			recordAdoptions: {
				recovery: { legacyType: "legacy-recovery-v1", fromVersions: ["0.2.1"], removeBeforeVersion: "2.0.0" },
			},
		},
	});
	expect(await discoverInstalledPackages(modules)).toEqual([
		{ packageName: "@example/native", error: "drone.recordAdoptions requires a desktopRuntime owner" },
	]);
});

it("rejects a required publisher without an actual desktop owner", async () => {
	await manifest({ entrypoints: { extension: "./native.mjs" }, drone: { deliveryProjection: "required" } });
	expect(await discoverInstalledPackages(modules)).toEqual([
		{ packageName: "@example/native", error: "drone.deliveryProjection requires a desktopRuntime owner" },
	]);
});

it("rejects a native entrypoint that resolves outside the installed package", async () => {
	const outside = join(root, "external.mjs");
	await writeFile(outside, "export default function () {}\n");
	await rm(join(directory, "native.mjs"));
	await symlink(outside, join(directory, "native.mjs"));
	expect(await discoverInstalledPackages(modules)).toEqual([
		{
			packageName: "@example/native",
			error: expect.stringContaining("extension escapes the installed package"),
		},
	]);
});
