import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it, onTestFinished, vi } from "vitest";
import { measuredEnvelopeBytes } from "./p5-byte-capabilities";
import { createProcessPluginRuntime } from "./process-runtime";
import { PluginRuntimeRegistry } from "./runtime";
import { PluginCapabilityBroker } from "./runtime-capabilities";

const runtimeDirectory = resolve(
	import.meta.dirname,
	"../../../desktop/plugin-runtime",
	`${process.platform}-${process.arch}`,
);

const workerSource = String.raw`
export default async () => ({
  operations: {
    run: {
      inputSchema: { type: "null" },
      resultSchema: { type: "object" },
      effect: "read",
      async execute(_, { capabilities }) {
        const write = process.stdout.write;
        let writtenLine;
        process.stdout.write = function (line, ...args) {
          const message = JSON.parse(line);
          if (message.type !== "capability") return write.call(this, line, ...args);
          message.cancelKey = "test-cancel-key";
          message.envelopeBytes = 1;
          writtenLine = "  " + JSON.stringify(message, null, 1).replaceAll("\n", " ") + "  ";
          return write.call(this, writtenLine + "\r\n", ...args);
        };
        try {
          const observed = await capabilities.call("measure", { label: "雪🌊", envelopeBytes: 1 });
          return { writtenLine, observed };
        } finally {
          process.stdout.write = write;
        }
      },
    },
  },
  dispose: async () => {},
});`;

async function workerFixture() {
	const packageRoot = await mkdtemp(join(tmpdir(), "drone-runtime-envelope-"));
	onTestFinished(() => rm(packageRoot, { recursive: true, force: true }));
	const entrypoint = join(packageRoot, "runtime.mjs");
	await writeFile(entrypoint, workerSource);
	return createProcessPluginRuntime({ pluginId: "example", packageRoot, entrypoint, runtimeDirectory });
}

it("measures the exact worker line without trusting request fields or lending the count to nested calls", async () => {
	const registry = new PluginRuntimeRegistry(
		{ authorizeActivation: async () => true, authorizeInvocation: async () => true },
		"app",
		{
			resources: [],
			handlers: {
				measure: {
					inputSchema: { type: "object" },
					resultSchema: { type: "object" },
					effect: "read",
					execute: async (_input, context) => ({
						envelopeBytes: context.envelopeBytes,
						accessorBytes: measuredEnvelopeBytes(context),
						nestedHasEnvelope: await context.capabilities.call("nested", null),
					}),
				},
				nested: {
					inputSchema: { type: "null" },
					resultSchema: { type: "boolean" },
					effect: "read",
					execute: async (_input, context) => "envelopeBytes" in context,
				},
			},
		},
	);
	registry.register("example", await workerFixture());
	try {
		const caller = {
			identity: {},
			scope: { kind: "application" as const },
			signal: new AbortController().signal,
		};
		const client = await registry.activate("example", () => caller);
		const { writtenLine, observed } = (await client.invoke("run", null)) as {
			writtenLine: string;
			observed: unknown;
		};
		const bytes = Buffer.byteLength(writtenLine, "utf8");
		expect(bytes).toBeGreaterThan(writtenLine.length);
		expect(bytes).toBeGreaterThan(Buffer.byteLength(JSON.stringify(JSON.parse(writtenLine)), "utf8"));
		expect(observed).toEqual({ envelopeBytes: bytes, accessorBytes: bytes, nestedHasEnvelope: false });
	} finally {
		await registry.deactivate("example");
	}
});

it.each([
	{ port: "per-invocation", signal: undefined },
	{ port: "signal-wrapped", signal: new AbortController().signal },
])("measures worker calls through the $port port", async ({ signal }) => {
	const factory = await workerFixture();
	const broker = new PluginCapabilityBroker({
		resources: [],
		handlers: {
			run: {
				inputSchema: { type: "null" },
				resultSchema: { type: "object" },
				effect: "read",
				execute: async (_input, context) => {
					const runtime = await factory({ ...context, resources: [], events: { changed: () => undefined } });
					try {
						const operation = runtime.operations.run;
						if (!operation) throw new Error("Worker did not declare the run operation");
						return await operation.execute(null, context);
					} finally {
						await runtime.dispose();
					}
				},
			},
			measure: {
				inputSchema: { type: "object" },
				resultSchema: { type: "number" },
				effect: "read",
				execute: async (_input, context) => measuredEnvelopeBytes(context),
			},
		},
	});
	const result = (await broker.run(
		{
			pluginId: "example",
			applicationId: "app",
			scope: { kind: "application" },
			callerIdentity: undefined,
			signal: new AbortController().signal,
			bootstrap: false,
		},
		"read",
		() => undefined,
		async () => true,
		() => broker.port.call("run", null, signal),
	)) as { writtenLine: string; observed: unknown };
	expect(result.observed).toBe(Buffer.byteLength(result.writtenLine, "utf8"));
});

it("returns a capability error without falling back to an unmeasured public port", async () => {
	const factory = await workerFixture();
	const capabilities = { call: vi.fn(async () => null) };
	const signal = new AbortController().signal;
	const runtime = await factory({
		applicationId: "app",
		resources: [],
		signal,
		capabilities,
		events: { changed: () => undefined },
	});
	try {
		const operation = runtime.operations.run;
		if (!operation) throw new Error("Worker did not declare the run operation");
		await expect(
			operation.execute(null, { capabilities, signal, scope: { kind: "application" } }),
		).rejects.toThrow("Plugin capability port does not support measured envelopes");
		expect(capabilities.call).not.toHaveBeenCalled();
	} finally {
		await runtime.dispose();
	}
});
