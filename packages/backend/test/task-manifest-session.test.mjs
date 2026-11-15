import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createEventBus } from "@earendil-works/pi-coding-agent";
import { build } from "esbuild";
import { afterEach, expect, it, vi } from "vitest";
import { createStandaloneRuntime, withRuntime } from "../../extensions/src/internal/runtime/runtime-bridge";
import { isReadOnlyTool } from "../../extensions/src/internal/runtime/tool-manifest";

const runtimes = [];
const directories = [];
afterEach(async () => {
	vi.unstubAllEnvs();
	await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()));
	await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function host() {
	const runtime = createStandaloneRuntime();
	runtimes.push(runtime);
	const pi = {
		events: createEventBus(),
		registerTool() {},
		on() {},
	};
	return { pi, runtime };
}

it("scopes the bundled knowledge read-only manifest to its standalone runtime", async () => {
	vi.stubEnv("DRONE_KNOWLEDGE_DIR", join(tmpdir(), "drone-task-manifest-test"));
	const directory = await mkdtemp(join(tmpdir(), "drone-task-manifest-bundle-"));
	directories.push(directory);
	const bundle = join(directory, "knowledge.mjs");
	await build({
		entryPoints: [createRequire(import.meta.url).resolve("@drone/extensions/knowledge-extension")],
		outfile: bundle,
		bundle: true,
		platform: "node",
		format: "esm",
		logLevel: "silent",
	});
	const { registerKnowledgeInterface } = await import(/* @vite-ignore */ pathToFileURL(bundle).href);
	const first = host();
	const other = host();
	// Load the real independently bundled knowledge extension before the inline
	// host announces its runtime, matching Desktop's extension initialization.
	registerKnowledgeInterface(first.pi, { readOnly: true });
	for (const current of [first, other]) {
		current.pi.events.emit("drone:runtime/v1", { version: 1, runtime: current.runtime });
	}
	const name = "research_prepare_knowledge";
	expect(withRuntime(first.runtime, () => isReadOnlyTool(name))).toBe(true);
	expect(withRuntime(other.runtime, () => isReadOnlyTool(name))).toBe(false);
});
