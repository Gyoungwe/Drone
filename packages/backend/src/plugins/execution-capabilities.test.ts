import { randomBytes } from "node:crypto";
import { chmod, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { canonicalProjectId } from "../project-id";
import { StorageRegistry } from "../storage/registry";
import { createPluginExecutionCapabilities } from "./execution-capabilities";
import { PluginRuntimeRegistry } from "./runtime";
import type { PluginCapabilityContext } from "./runtime-capabilities";
import type { PluginSessionCallerContext } from "./session-caller";

let root: string;
let selected: PluginSessionCallerContext;
beforeEach(async () => {
	root = await realpath(await mkdtemp(join(tmpdir(), "execution-capability-test-")));
	selected = {
		identity: {},
		scope: {
			kind: "session",
			sessionId: "live-session",
			workspaceDirectory: root,
			workspaceId: canonicalProjectId(root),
		},
		signal: new AbortController().signal,
		readOnly: false,
		projectTrusted: true,
	};
});
afterEach(async () => {
	vi.unstubAllEnvs();
	await rm(root, { recursive: true, force: true });
});
const request = {
	requestId: "missing-image-1",
	language: "python",
	code: "print('never executes without the exact cached image')",
	runDirectory: "runs/never-started",
	image: `sha256:${"0".repeat(64)}`,
	timeoutMs: 1000,
	maxOutputBytes: 1024,
	dataClassification: "public",
};
async function capabilities(
	container: {
		pythonImage?: string;
		rImage?: string;
		runtime?: "docker" | "podman";
		reservationDirectory?: string;
	} = { pythonImage: "drone-execution-fixture-missing:never-installed" },
) {
	return createPluginExecutionCapabilities({
		directory: join(root, "private-receipts"),
		sourceIdentity: "actual-installed-content",
		integrityKey: randomBytes(32),
		acceptedFacts: new Map(),
		storage: new StorageRegistry(),
		container,
		getSessionContext: (id) => (id === selected.scope.sessionId ? selected : undefined),
	});
}
const context = (): PluginCapabilityContext => ({
	pluginId: "@example/runner",
	applicationId: "application",
	scope: selected.scope,
	signal: selected.signal,
	callerIdentity: {},
	sessionIdentity: selected.identity,
	bootstrap: false,
	capabilities: {
		call: async () => {
			throw new Error("No nested calls");
		},
	},
});
it("requires actual per-call approval before even a missing-image execution is accepted", async () => {
	const ports = await capabilities();
	const registry = new PluginRuntimeRegistry(
		{
			authorizeActivation: async () => true,
			authorizeInvocation: async (input) => input.operation !== "capability:execution.run",
		},
		"application",
		async () => ({ resources: [], handlers: ports.handlers, dispose: ports.dispose }),
	);
	registry.register("@example/runner", async ({ capabilities }) => ({
		operations: {
			run: {
				effect: "write",
				inputSchema: { type: "null" },
				resultSchema: { type: "object" },
				execute: () => capabilities.call("execution.run", request),
			},
		},
		dispose: async () => {},
	}));
	const client = await registry.activate("@example/runner", () => selected);
	await expect(client.invoke("run", null)).rejects.toThrow("denied");
	expect(await readdir(join(root, "private-receipts"))).toEqual([]);
	expect(await readdir(root)).toEqual(["private-receipts"]);
	await registry.deactivate("@example/runner");
});
it("returns an honest unavailable error for an exact image that is not cached and creates no accepted receipt or run directory", async () => {
	const ports = await capabilities();
	await expect(ports.handlers["execution.run"].execute(request, context())).rejects.toThrow("not cached");
	expect(
		await ports.handlers["execution.receipt"].execute({ requestId: request.requestId }, context()),
	).toEqual({ kind: "missing" });
	expect(await readdir(join(root, "private-receipts"))).toEqual([]);
	expect(await readdir(root)).toEqual(["private-receipts"]);
	await ports.dispose();
});
it("rejects stale, read-only and untrusted callers before any execution infrastructure is probed", async () => {
	const ports = await capabilities();
	const original = context();
	selected = { ...selected, identity: {} };
	await expect(ports.handlers["execution.describe"].execute(null, original)).rejects.toThrow("stale");
	selected = { ...selected, readOnly: true };
	await expect(ports.handlers["execution.run"].execute(request, context())).rejects.toThrow("read-only");
	selected = { ...selected, readOnly: false, projectTrusted: false };
	await expect(ports.handlers["execution.run"].execute(request, context())).rejects.toThrow("untrusted");
	expect(await readdir(join(root, "private-receipts"))).toEqual([]);
	await ports.dispose();
});

it("does not accept a selection object in place of the actual session identity", async () => {
	const ports = await capabilities();
	await expect(
		ports.handlers["execution.describe"].execute(null, {
			...context(),
			callerIdentity: selected.identity,
			sessionIdentity: {},
		}),
	).rejects.toThrow("stale");
	await ports.dispose();
});

it("uses the host's configured reference instead of letting a request self-declare its cached image (explicit synthetic engine fixture)", async () => {
	const configuredImage = "configured-python-fixture:local";
	const configuredId = `sha256:${"a".repeat(64)}`;
	await writeFile(
		join(root, "docker"),
		`#!${process.execPath}
const fs=require('node:fs'),path=require('node:path');
const args=process.argv.slice(2);
fs.appendFileSync(path.join(${JSON.stringify(root)},'engine-calls.jsonl'),JSON.stringify(args)+'\\n');
if(args[0]==='version'){console.log('synthetic-engine');process.exit(0);}
if(args[0]==='image'&&args.at(-1)===${JSON.stringify(configuredImage)}){console.log(${JSON.stringify(configuredId)});process.exit(0);}
if(args[0]==='image')process.exit(1);
if(args[0]==='run'){console.log('[summary] synthetic-only');process.exit(0);}
if(args[0]==='inspect')process.exit(1);
if(args[0]==='container'&&args[1]==='ls')process.exit(0);
process.exit(2);
`,
	);
	await chmod(join(root, "docker"), 0o755);
	vi.stubEnv("PATH", `${root}${delimiter}${process.env.PATH}`);
	const ports = await capabilities({
		runtime: "docker",
		pythonImage: configuredImage,
		rImage: "missing-r-fixture",
		reservationDirectory: join(root, "test-leases"),
	});
	expect(await ports.handlers["execution.describe"].execute(null, context())).toMatchObject({
		images: { python: configuredId },
	});
	await expect(ports.handlers["execution.run"].execute(request, context())).rejects.toThrow("does not match");
	expect(
		await ports.handlers["execution.receipt"].execute({ requestId: request.requestId }, context()),
	).toEqual({ kind: "missing" });
	const matched = await ports.handlers["execution.run"].execute(
		{ ...request, requestId: "matched-configured-id", image: configuredId },
		context(),
	);
	expect(matched).toMatchObject({ receipt: { status: "succeeded", image: configuredId } });
	const calls = (await readFile(join(root, "engine-calls.jsonl"), "utf8"))
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line) as string[]);
	expect(
		calls
			.filter((args) => args[0] === "image")
			.every((args) => args.at(-1) === configuredImage || args.at(-1) === "missing-r-fixture"),
	).toBe(true);
	expect(calls.filter((args) => args[0] === "run")).toHaveLength(1);
	await ports.dispose();
});
