// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { type InstalledP5Optins, p5Optins } from "./installed-p5-optins";
import { discoverInstalledPackages, type InstalledUiRuntimeSource } from "./installed-package-sources";

const p5: InstalledP5Optins = {
	bytes: "staged-output",
	exportBundle: "request",
	batch: "request",
	rerun: "request",
	critic: "request",
	delivery: "request",
};

const lanes = [
	["bytes", "staged-output"],
	["exportBundle", "request"],
	["batch", "request"],
	["rerun", "request"],
	["critic", "request"],
	["delivery", "request"],
] as const;

const test = it.extend<{ modules: string }>({
	modules: async ({ task: _task }, use) => {
		const root = await mkdtemp(join(tmpdir(), "drone-p5-optins-"));
		const modules = join(root, "node_modules");
		const directory = join(modules, "example-p5");
		await mkdir(directory, { recursive: true });
		await writeFile(join(root, "package.json"), JSON.stringify({ dependencies: { "example-p5": "1.0.0" } }));
		await writeFile(
			join(directory, "package.json"),
			JSON.stringify({ name: "example-p5", version: "1.0.0" }),
		);
		await writeFile(
			join(directory, "runtime.mjs"),
			'throw new Error("Discovery must never execute this file");\n',
		);
		await use(modules);
		await rm(root, { recursive: true, force: true });
	},
});

async function manifest(modules: string, extra: Record<string, unknown>) {
	await writeFile(
		join(modules, "example-p5", "plugin.manifest.json"),
		JSON.stringify({
			hosts: ["drone-desktop"],
			entrypoints: { desktopRuntime: "./runtime.mjs" },
			...extra,
		}),
	);
}

async function runtime(modules: string): Promise<InstalledUiRuntimeSource> {
	const sources = await discoverInstalledPackages(modules);
	expect(sources).toHaveLength(1);
	const [source] = sources;
	if (!source || "error" in source || !source.runtime) throw new Error("Expected an installed runtime");
	return source.runtime;
}

function requests(source: InstalledUiRuntimeSource) {
	return Object.fromEntries(Object.entries(source).filter(([key]) => key.startsWith("requests")));
}

test("discovers all explicit P5 lane declarations as a frozen record", async ({ modules }) => {
	await manifest(modules, { drone: { p5 } });
	const source = await runtime(modules);
	expect(source.p5).toEqual(p5);
	expect(Object.isFrozen(source.p5)).toBe(true);
	expect(requests(source)).toEqual({});
});

test.for(lanes)("accepts the %s lane independently with %s", async ([key, literal], { modules }) => {
	await manifest(modules, { drone: { p5: { [key]: literal } } });
	const source = await runtime(modules);
	expect(source.p5).toEqual({ [key]: literal });
	expect(Object.isFrozen(source.p5)).toBe(true);
	expect(requests(source)).toEqual({});
});

test.for(lanes)("rejects incorrect literals for %s", async ([key, literal], { modules }) => {
	for (const value of ["request", "staged-output", "always", "", true, false, 0, null, {}, []]) {
		if (value === literal) continue;
		await manifest(modules, { drone: { p5: { [key]: value } } });
		expect(await discoverInstalledPackages(modules)).toEqual([
			{
				packageName: "example-p5",
				error: `Invalid desktopRuntime: Error: drone.p5.${key} must be ${literal} when declared`,
			},
		]);
	}
});

test.for(["unknown", "requestsExecution", "Bytes", "__proto__", "constructor", "toString"])(
	"rejects the unknown P5 key %s as a package discovery error",
	async (key, { modules }) => {
		await manifest(modules, { drone: { p5: { ...p5, [key]: "request" } } });
		expect(await discoverInstalledPackages(modules)).toEqual([
			{ packageName: "example-p5", error: `Invalid desktopRuntime: Error: drone.p5 has unknown key ${key}` },
		]);
	},
);

test.for([null, "request", true, 1, []])(
	"rejects a non-object P5 declaration: %j",
	async (p5, { modules }) => {
		await manifest(modules, { drone: { p5 } });
		expect(await discoverInstalledPackages(modules)).toEqual([
			{ packageName: "example-p5", error: "Invalid desktopRuntime: Error: drone.p5 must be an object" },
		]);
	},
);

test.for([{}, { drone: {} }])("leaves absent P5 declarations absent: %j", async (extra, { modules }) => {
	await manifest(modules, extra);
	const source = await runtime(modules);
	expect(source).not.toHaveProperty("p5");
	expect(requests(source)).toEqual({});
});

test("accepts an empty P5 object without opting into any lane", async ({ modules }) => {
	await manifest(modules, { drone: { p5: {} } });
	const source = await runtime(modules);
	expect(source.p5).toEqual({});
	expect(Object.isFrozen(source.p5)).toBe(true);
	expect(requests(source)).toEqual({});
});

test("keeps existing request flags independent in both directions", async ({ modules }) => {
	const drone = { taskGrants: "request", workspaceRead: "session" };
	const permissions = {
		filesystem: ["application-state-write", "binary-state-write", "workspace-write"],
		network: ["configured-services"],
		subprocess: ["container"],
	};
	const expected = {
		requestsStateRead: true,
		requestsStateWrite: true,
		requestsBinaryStateRead: true,
		requestsBinaryStateWrite: true,
		requestsFileRead: true,
		requestsFileWrite: true,
		requestsModel: true,
		requestsExecution: true,
		requestsTaskGrant: true,
		requestsWorkspaceRead: true,
	};
	await manifest(modules, { drone, permissions });
	const before = await runtime(modules);
	expect(before).not.toHaveProperty("p5");
	expect(requests(before)).toEqual(expected);
	await manifest(modules, { drone: { ...drone, p5 }, permissions });
	const after = await runtime(modules);
	expect(after.p5).toEqual(p5);
	expect(requests(after)).toEqual(expected);
});

it("decodes absent opt-ins without creating a record", () => {
	expect(p5Optins(undefined)).toEqual({});
});

it("keeps the frozen opt-ins independent of later input changes", () => {
	const declaration = { bytes: "staged-output" };
	const decoded = p5Optins(declaration);
	declaration.bytes = "request";
	expect(decoded.p5).toEqual({ bytes: "staged-output" });
	expect(Object.isFrozen(decoded.p5)).toBe(true);
});
