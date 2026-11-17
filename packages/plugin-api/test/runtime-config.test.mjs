import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { mock, test } from "node:test";
import { fileURLToPath } from "node:url";
import { readPluginEndpointConfiguration } from "@gyoungwe/plugin-api/runtime";
import ts from "typescript";

const typeSource = `
import {
  readPluginEndpointConfiguration,
  type PluginEndpointConfigurationInput,
  type PluginEndpointConfigurationResult,
  type PluginRuntimeCapabilities,
} from "@gyoungwe/plugin-api/runtime";

type Equal<T, U> = (<V>() => V extends T ? 1 : 2) extends
  (<V>() => V extends U ? 1 : 2) ? true : false;
type Expect<T extends true> = T;
type InputMatches = Expect<Equal<PluginEndpointConfigurationInput, { readonly slot: string }>>;
type ResultMatches = Expect<Equal<PluginEndpointConfigurationResult,
  | { readonly state: "ready"; readonly endpoint: string; readonly source: "default" | "env" }
  | { readonly state: "invalid"; readonly endpoint: null; readonly source: "env";
      readonly reason: "invalid_endpoint" }
>>;
type HelperMatches = Expect<Equal<typeof readPluginEndpointConfiguration,
  (capabilities: PluginRuntimeCapabilities, input: PluginEndpointConfigurationInput,
    signal?: AbortSignal) => Promise<PluginEndpointConfigurationResult>
>>;
`;

test("runtime entry exports readPluginEndpointConfiguration", () => {
	assert.equal(typeof readPluginEndpointConfiguration, "function");
});

for (const reply of [
	{ state: "ready", endpoint: "http://dav.example:8080", source: "default" },
	{ state: "ready", endpoint: "https://dav.example:8443", source: "env" },
	{ state: "invalid", endpoint: null, source: "env", reason: "invalid_endpoint" },
]) {
	test(`returns the ${reply.state} host reply from ${reply.source} unchanged`, async () => {
		const call = mock.fn(async () => reply);
		const input = { slot: "webdav" };
		const signal = new AbortController().signal;
		const result = await readPluginEndpointConfiguration({ call }, input, signal);

		assert.equal(call.mock.callCount(), 1);
		assert.deepStrictEqual(call.mock.calls[0].arguments, ["config.endpoint", input, signal]);
		assert.strictEqual(call.mock.calls[0].arguments[1], input);
		assert.strictEqual(call.mock.calls[0].arguments[2], signal);
		assert.deepStrictEqual(result, reply);
		assert.strictEqual(result, reply);
	});
}

test("propagates the same host rejection without a fallback or retry", async () => {
	const failure = Object.assign(new Error("x"), { code: "EPLUGINENDPOINTSLOT" });
	const call = mock.fn(async () => {
		throw failure;
	});
	await assert.rejects(readPluginEndpointConfiguration({ call }, { slot: "webdav" }), (error) => {
		assert.strictEqual(error, failure);
		return true;
	});
	assert.equal(call.mock.callCount(), 1);
	assert.deepStrictEqual(call.mock.calls[0].arguments, ["config.endpoint", { slot: "webdav" }, undefined]);
});

test("built endpoint configuration helper has no Node, Electron or Pi imports", async () => {
	const output = await readFile(new URL("../dist/runtime-config.js", import.meta.url), "utf8");
	assert.doesNotMatch(output, /node:|electron|@earendil-works|@mariozechner\/pi-/u);
});

test("built runtime declarations match the exact endpoint configuration contract", () => {
	const packageRoot = fileURLToPath(new URL("..", import.meta.url));
	const sourcePath = resolve(packageRoot, "test/runtime-config-fixture.ts");
	const options = {
		target: ts.ScriptTarget.ES2022,
		module: ts.ModuleKind.ESNext,
		moduleResolution: ts.ModuleResolutionKind.Bundler,
		strict: true,
		noEmit: true,
		skipLibCheck: true,
		types: [],
	};
	const host = ts.createCompilerHost(options);
	const originalGetSourceFile = host.getSourceFile;
	host.getSourceFile = (name, languageVersion, ...rest) =>
		name === sourcePath
			? ts.createSourceFile(name, typeSource, languageVersion, true)
			: originalGetSourceFile(name, languageVersion, ...rest);
	const program = ts.createProgram([sourcePath], options, host);
	assert.ok(program.getSourceFile(resolve(packageRoot, "dist/runtime-config.d.ts")));
	const diagnostics = ts.getPreEmitDiagnostics(program);
	assert.equal(
		diagnostics.length,
		0,
		ts.formatDiagnosticsWithColorAndContext(diagnostics, {
			getCurrentDirectory: () => packageRoot,
			getCanonicalFileName: (name) => name,
			getNewLine: () => "\n",
		}),
	);
});
