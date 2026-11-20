import { mkdir, mkdtemp, realpath, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type P5AdoptedWriter,
	type PluginCapabilityContext,
	PluginFileCapabilities,
	StorageRegistry,
} from "@drone/backend";
import { expect, it, onTestFinished, vi } from "vitest";
import { createDesktopResourceCapabilities } from "./desktop-resource-capabilities";
import { p5WriterQueryFor } from "./p5-writer-query";

function context(signal: AbortSignal): PluginCapabilityContext {
	return {
		pluginId: "writer-fixture",
		applicationId: "app",
		scope: { kind: "application" },
		callerIdentity: {},
		signal,
		bootstrap: false,
		capabilities: {
			call: async () => {
				throw new Error("Unexpected nested capability");
			},
		},
	};
}

async function open(kind: "state" | "binary-state" | "read-only" = "state") {
	const directory = await realpath(await mkdtemp(join(tmpdir(), "drone-p5-writer-query-")));
	const state = join(directory, "state");
	const binary = join(directory, "binary");
	const profile = join(directory, "profile");
	await Promise.all([state, binary, profile].map((path) => mkdir(path)));
	const create = PluginFileCapabilities.create;
	const creation = vi
		.spyOn(PluginFileCapabilities, "create")
		.mockImplementationOnce((grants, cache) => create(grants, cache, join(directory, "leases")));
	onTestFinished(() => creation.mockRestore());
	const controller = new AbortController();
	const activation = {
		pluginId: "writer-fixture",
		applicationId: "app",
		signal: controller.signal,
		events: { changed: vi.fn() },
	};
	const ports = await createDesktopResourceCapabilities(
		{
			pluginId: activation.pluginId,
			packageRoot: directory,
			entrypoint: join(directory, "runtime.js"),
			requestsStateRead: true,
			requestsBinaryStateRead: true,
			requestsStateWrite: kind === "state",
			requestsBinaryStateWrite: kind === "binary-state",
		},
		directory,
		{
			profileDirectory: profile,
			storage: new StorageRegistry(),
			selectDirectories: async (selection) => [selection.startsWith("binary-") ? binary : state],
		},
	)(activation);
	const dispose = ports.dispose;
	const finalRelease = ports.finalRelease;
	if (!dispose || !finalRelease) throw new Error("Missing resource lifecycle");
	onTestFinished(async () => {
		await dispose();
		await finalRelease();
		await rm(directory, { recursive: true, force: true });
	});
	return { directory, state, binary, controller, activation, ports, dispose, finalRelease };
}

async function fixture(kind: "state" | "binary-state" = "state") {
	const opened = await open(kind);
	const query = p5WriterQueryFor(opened.activation);
	const root = opened.ports.resources.find((root) => root.kind === kind);
	const reserve = opened.ports.handlers["state.reserve"];
	if (!query || !root || !reserve) throw new Error("Missing selected writer ports");
	const writer: P5AdoptedWriter = {
		attachment: {},
		scope: {
			workspaceId: "workspace-a",
			sessionId: "session-a",
			callerSourceHash: "caller-a",
			providerSourceHash: "provider-a",
		},
		rootHandle: root.handle,
		relativeDirectory: "",
		signal: new AbortController().signal,
	};
	query.adopt(writer);
	await reserve.execute({ root: writer.rootHandle, path: "" }, context(opened.controller.signal));
	return { ...opened, query, writer };
}

it.each(["state", "binary-state"] as const)("authorizes a reserved selected %s writer", async (kind) => {
	const { query, writer } = await fixture(kind);
	expect(await query.authorizeDelivery(writer)).toBe(true);
});

it("denies the next delivery after activation abort, even with an independently live writer", async () => {
	const { query, writer, controller } = await fixture();
	expect(await query.authorizeDelivery(writer)).toBe(true);
	controller.abort();
	expect(writer.signal.aborted).toBe(false);
	expect(await query.authorizeDelivery(writer)).toBe(false);
});

it("invalidates the query before draining ports on provider disposal", async () => {
	const { query, writer, activation, dispose } = await fixture();
	expect(await query.authorizeDelivery(writer)).toBe(true);
	const drain = vi.spyOn(PluginFileCapabilities.prototype, "drain").mockImplementationOnce(async () => {
		expect(p5WriterQueryFor(activation)).toBeUndefined();
		expect(await query.authorizeDelivery(writer)).toBe(false);
	});
	onTestFinished(() => drain.mockRestore());
	await dispose();
	expect(drain).toHaveBeenCalledOnce();
	expect(p5WriterQueryFor(activation)).toBeUndefined();
	query.adopt(writer);
	expect(await query.authorizeDelivery(writer)).toBe(false);
});

it("denies a different handle and an adopted read-only grant in the same activation", async () => {
	const { query, writer, ports } = await fixture();
	expect(await query.authorizeDelivery({ ...writer, rootHandle: "unselected" })).toBe(false);
	const readOnly = ports.resources.find((root) => root.access === "read");
	if (!readOnly) throw new Error("Missing read-only grant");
	const other = { ...writer, rootHandle: readOnly.handle };
	query.adopt(other);
	expect(await query.authorizeDelivery(other)).toBe(false);
});

it("denies adoption of another activation's reserved handle", async () => {
	const first = await fixture();
	const second = await fixture();
	first.query.adopt(second.writer);
	expect(await second.query.authorizeDelivery(second.writer)).toBe(true);
	expect(await first.query.authorizeDelivery(second.writer)).toBe(false);
});

it("releases only the matching attachment and replaces earlier adoptions", async () => {
	const { query, writer } = await fixture();
	query.release({});
	expect(await query.authorizeDelivery(writer)).toBe(true);
	const replacement = { ...writer, attachment: {} };
	query.adopt(replacement);
	query.release(writer.attachment);
	expect(await query.authorizeDelivery(writer)).toBe(false);
	expect(await query.authorizeDelivery(replacement)).toBe(true);
	query.release(replacement.attachment);
	expect(await query.authorizeDelivery(replacement)).toBe(false);
});

it("denies a writer differing only in sessionId", async () => {
	const { query, writer } = await fixture();
	expect(
		await query.authorizeDelivery({ ...writer, scope: { ...writer.scope, sessionId: "session-b" } }),
	).toBe(false);
});

it("rechecks the root identity on the next delivery", async () => {
	const { query, writer, directory, state } = await fixture();
	expect(await query.authorizeDelivery(writer)).toBe(true);
	await rename(state, join(directory, "previous-state"));
	await mkdir(state);
	expect(await query.authorizeDelivery(writer)).toBe(false);
});

it("denies delivery after the real reservation is released", async () => {
	const { query, writer, finalRelease } = await fixture();
	expect(await query.authorizeDelivery(writer)).toBe(true);
	await finalRelease();
	expect(await query.authorizeDelivery(writer)).toBe(false);
});

it("exposes only host query methods and keeps the query out of the provider result", async () => {
	const { query, ports, activation } = await fixture();
	expect(p5WriterQueryFor(activation)).toBe(query);
	expect(Object.keys(query).sort()).toEqual(["adopt", "authorizeDelivery", "release"]);
	expect(Object.values(ports)).not.toContain(query);
	expect(p5WriterQueryFor({})).toBeUndefined();
});

it("creates no query for read-only grants", async () => {
	const { activation } = await open("read-only");
	expect(p5WriterQueryFor(activation)).toBeUndefined();
});
