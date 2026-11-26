import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const config = JSON.parse(
	readFileSync(resolve(root, "packages/plugin-api/scripts/knowledge-ui-contract.json"), "utf8"),
);

test("knowledge UI exposes only its explicit routes and matches host wire signatures", () => {
	const file = resolve(root, "packages/plugin-api/test/ui-typecheck.ts");
	const source = `
import type { PiApi } from '../../shared/src/host-api';
import type { KnowledgeUiPort, KnowledgeUiRoute, SessionUiPort, ChatMessageProps, SessionMessagesHook, DroneUiRuntime } from '../src/ui';
const host = null as unknown as PiApi;
const knowledgeRoute: KnowledgeUiRoute = {
  invoke: (operation: string, input?: unknown) => host.invokeKnowledge({ operation, input }),
};
const plugin: KnowledgeUiPort = {
  knowledge: knowledgeRoute,
  daily: { invoke: (operation: string) => host.invokeDaily({ operation }) },
  zotero: { invoke: (operation: string) => host.invokeZotero({ operation }) },
};
const checked: Pick<PiApi, 'invokeKnowledge' | 'invokeDaily' | 'invokeZotero'> = {
  invokeKnowledge: host.invokeKnowledge,
  invokeDaily: host.invokeDaily,
  invokeZotero: host.invokeZotero,
};
const sessions: SessionUiPort = host;
const checkedSessions: Pick<PiApi, keyof SessionUiPort> = sessions;
declare const messageProps: ChatMessageProps;
declare const messages: SessionMessagesHook;
const messageKind: string = messageProps.message.kind;
const readOnlyMessages: readonly import('../src/ui').UIMessage[] = messages(messageProps.sessionId);
declare const runtime: DroneUiRuntime;
const openExternal: (url: string) => Promise<void> = runtime.helpers.openExternal;
const openResourceExternal: (target: string, cwd?: string) => Promise<void> = runtime.helpers.openResourceExternal;
const invokeOverview: (operation: string, input?: unknown) => Promise<unknown> = runtime.knowledge.knowledge.invoke;
const pickDirectory: () => Promise<string | null> = runtime.app.pickDirectory;
const formalVault: () => Promise<string | null> = runtime.app.formalKnowledgeVault;
const institutionalStatus: () => Promise<import('../src/ui').InstitutionalStatus> = runtime.institutional.getStatus;
void openExternal; void openResourceExternal;
void invokeOverview; void pickDirectory; void formalVault; void institutionalStatus;
void checkedSessions; void messageKind; void readOnlyMessages;
// @ts-expect-error arbitrary file writes are outside the knowledge UI contract
plugin.writeFile;
// @ts-expect-error arbitrary MCP invocation is outside the knowledge UI contract
plugin.callMcpTool;
void checked;
`;
	const options = {
		target: ts.ScriptTarget.ES2022,
		module: ts.ModuleKind.ESNext,
		moduleResolution: ts.ModuleResolutionKind.Bundler,
		strict: true,
		noEmit: true,
		skipLibCheck: true,
		types: [],
		paths: {
			"@gyoungwe/plugin-api": [resolve(root, "packages/plugin-api/src/index.ts")],
			"@gyoungwe/plugin-api/knowledge": [resolve(root, "packages/plugin-api/src/knowledge.ts")],
		},
	};
	const host = ts.createCompilerHost(options);
	const originalGetSourceFile = host.getSourceFile;
	host.getSourceFile = (name, languageVersion, ...rest) =>
		name === file
			? ts.createSourceFile(name, source, languageVersion, true)
			: originalGetSourceFile(name, languageVersion, ...rest);
	const program = ts.createProgram([file], options, host);
	const diagnostics = ts.getPreEmitDiagnostics(program);
	assert.equal(
		diagnostics.length,
		0,
		ts.formatDiagnosticsWithColorAndContext(diagnostics, {
			getCurrentDirectory: () => root,
			getCanonicalFileName: (name) => name,
			getNewLine: () => "\n",
		}),
	);
	const wire = program.getSourceFile(resolve(root, "packages/plugin-api/src/ui-wire.ts"));
	const wireModules = config.modules.map((entry) => entry.file);
	function checkStandaloneType(node, file) {
		assert.notEqual(node.kind, ts.SyntaxKind.AnyKeyword, "wire contracts must not erase host types to any");
		if (ts.isImportDeclaration(node)) {
			// A wire module may only import types from another wire module.
			assert.equal(node.importClause?.isTypeOnly, true, "wire contracts must import types only");
			const specifier = node.moduleSpecifier.text;
			assert.ok(
				wireModules.some((name) => specifier === `./${name.replace(/\.ts$/, ".js")}`),
				`wire contract must not import from ${specifier}`,
			);
		}
		assert.equal(ts.isImportTypeNode(node), false, "wire contracts must be standalone");
		ts.forEachChild(node, (child) => checkStandaloneType(child, file));
	}
	checkStandaloneType(wire);
	const declaration = wire.statements.find(
		(node) => ts.isInterfaceDeclaration(node) && node.name.text === "KnowledgeUiPort",
	);
	assert.deepEqual(declaration.members.map((member) => member.name.text).sort(), [
		"daily",
		"knowledge",
		"zotero",
	]);
});

test("UI contract exports no pretend runtime services", async () => {
	assert.deepEqual(Object.keys(await import("../dist/ui.js")), []);
});
