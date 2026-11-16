import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = `
import type {
  PluginApprovalCategory,
  PluginFilesystemPermission,
  PluginPermissionDeclaration,
} from "@gyoungwe/plugin-api";

const filesystem: readonly PluginFilesystemPermission[] = [
  "application-state-write", "workspace-write",
];
const categories: readonly PluginApprovalCategory[] = [
  "subprocess-install", "background-model-spend",
];
const permissions: PluginPermissionDeclaration = {
  filesystem, network: [], subprocess: ["uv", "zotero-mcp-server"], externalWrites: false,
};
const backgroundPermissions: PluginPermissionDeclaration = {
  ...permissions, model: ["background-model-spend"],
};
// @ts-expect-error Approval categories are a closed vocabulary.
const unknownCategory: PluginApprovalCategory = "unknown-category";
// @ts-expect-error Install approval does not declare background model spend.
const invalidModel: NonNullable<PluginPermissionDeclaration["model"]> = ["subprocess-install"];
void categories; void backgroundPermissions; void unknownCategory; void invalidModel;
`;

test("built package exposes additive approval declarations and closed categories", () => {
	const sourcePath = resolve(packageRoot, "test/approvals-fixture.ts");
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
			? ts.createSourceFile(name, source, languageVersion, true)
			: originalGetSourceFile(name, languageVersion, ...rest);
	const program = ts.createProgram([sourcePath], options, host);
	assert.ok(program.getSourceFile(resolve(packageRoot, "dist/index.d.ts")));
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
