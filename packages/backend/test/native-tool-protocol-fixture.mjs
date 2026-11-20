import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, vi } from "vitest";
import { createProcessPluginRuntime } from "../src/plugins/process-runtime";
import { hostCapabilityPort } from "../src/plugins/runtime-capabilities";
import { SessionEngine } from "../src/session-engine/engine";

const runtimeDirectory = resolve(
	import.meta.dirname,
	`../../desktop/plugin-runtime/${process.platform}-${process.arch}`,
);

export function createNativeToolProtocolFixture(sessions, events) {
	const roots = [];
	const runtimes = [];
	afterEach(async () => {
		for (const session of sessions.splice(0)) await new SessionEngine().dispose(session);
		for (const runtime of runtimes.splice(0)) await runtime.dispose();
		vi.restoreAllMocks();
		for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
	});
	return async function fixture(
		source,
		call = async () => {
			throw new Error("No capabilities requested");
		},
	) {
		const root = await realpath(await mkdtemp(join(tmpdir(), "drone-managed-tools-")));
		roots.push(root);
		const entrypoint = join(root, "runtime.mjs");
		await writeFile(entrypoint, source);
		const runtime = await createProcessPluginRuntime({
			pluginId: "managed-tools",
			packageRoot: root,
			entrypoint,
			runtimeDirectory,
		})({
			applicationId: "managed-tools-test",
			signal: new AbortController().signal,
			resources: [],
			capabilities: hostCapabilityPort(call),
			events,
		});
		runtimes.push(runtime);
		return { root, runtime };
	};
}
