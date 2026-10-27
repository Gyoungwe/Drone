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

test("knowledge UI exposes only its explicit methods and matches host wire signatures", () => {
	const file = resolve(root, "packages/plugin-api/test/ui-typecheck.ts");
	const source = `
import type { PiApi } from '../../shared/src/ipc';
import type { KnowledgeUiPort, SessionUiPort, ChatMessageProps, SessionMessagesHook } from '../src/ui';
const host = null as unknown as PiApi;
const plugin: KnowledgeUiPort = host;
const checked: Pick<PiApi, keyof KnowledgeUiPort> = plugin;
const sessions: SessionUiPort = host;
const checkedSessions: Pick<PiApi, keyof SessionUiPort> = sessions;
declare const messageProps: ChatMessageProps;
declare const messages: SessionMessagesHook;
const messageKind: string = messageProps.message.kind;
const readOnlyMessages: readonly import('../src/ui').UIMessage[] = messages(messageProps.sessionId);
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
	function checkStandaloneType(node) {
		assert.notEqual(node.kind, ts.SyntaxKind.AnyKeyword, "wire contracts must not erase host types to any");
		assert.equal(
			ts.isImportDeclaration(node) || ts.isImportTypeNode(node),
			false,
			"wire contracts must be standalone",
		);
		ts.forEachChild(node, checkStandaloneType);
	}
	checkStandaloneType(wire);
	const declaration = wire.statements.find(
		(node) => ts.isInterfaceDeclaration(node) && node.name.text === "KnowledgeUiPort",
	);
	assert.deepEqual(declaration.members.map((member) => member.name.text).sort(), config.methods);
});

test("UI contract exports no pretend runtime services", async () => {
	assert.deepEqual(Object.keys(await import("../dist/ui.js")), []);
});
