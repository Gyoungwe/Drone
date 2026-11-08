import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeMemory } from "./project-memory";
import { desktopLoaderOptions } from "./trust-loader";

const integration = {
	appendSystemPrompt: ["desktop"],
	additionalSkillPaths: [],
};
/** The temp project of the running test. */
const temp: { cwd?: string } = {};
afterEach(() => {
	if (temp.cwd) rmSync(temp.cwd, { recursive: true, force: true });
	delete temp.cwd;
});
const project = () => {
	temp.cwd = mkdtempSync(join(tmpdir(), "drone-trust-memory-"));
	return temp.cwd;
};
const prompt = (dir: string) =>
	(desktopLoaderOptions(integration, dir) as { appendSystemPrompt: string[] }).appendSystemPrompt;

describe("trust loader project memory", () => {
	it("adds nothing for a project without memory", () => {
		const cwd = project();
		expect(prompt(cwd)).toEqual(["desktop"]);
	});

	it("injects the project's memory index from the host, without a core plugin", () => {
		const cwd = project();
		writeMemory(cwd, {
			name: "Cluster",
			description: "SLURM on hpc01",
			type: "reference",
			body: "ssh hpc01",
		});
		expect(prompt(cwd).some((part) => part.includes("SLURM on hpc01"))).toBe(true);
	});
});

describe("trust loader built-in packages", () => {
	const nativeRuntime = (paths: string[]) => ({
		begin: () => {
			throw new Error("not activated here");
		},
		manages: () => true,
		childExtensionPaths: () => [],
		extensionPaths: () => paths,
	});
	type Loaded = { additionalExtensionPaths?: string[] };

	it("loads the enabled built-in entries each time, after the configured ones", () => {
		const cwd = project();
		const research = join(cwd, "research.mjs");
		writeFileSync(research, "export default () => {};\n");
		const enabled = ["/builtin/core/native.mjs"];
		const options = {
			...integration,
			additionalExtensionPaths: [research],
			pluginRuntimeDirectory: "/runtime",
			nativeRuntime: nativeRuntime(enabled),
		};
		expect((desktopLoaderOptions(options, cwd) as Loaded).additionalExtensionPaths).toEqual([
			research,
			"/builtin/core/native.mjs",
		]);
		enabled.length = 0;
		expect((desktopLoaderOptions(options, cwd) as Loaded).additionalExtensionPaths).toEqual([research]);
	});

	it("never loads a built-in entry without the managed factory that owns it", () => {
		const options = { ...integration, nativeRuntime: nativeRuntime(["/builtin/core/native.mjs"]) };
		expect((desktopLoaderOptions(options, project()) as Loaded).additionalExtensionPaths).toBeUndefined();
		const noCwd = { ...options, pluginRuntimeDirectory: "/runtime" };
		expect((desktopLoaderOptions(noCwd) as Loaded).additionalExtensionPaths).toBeUndefined();
	});
});
