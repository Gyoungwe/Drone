import { fileURLToPath } from "node:url";
import type * as PluginKnowledge from "@gyoungwe/plugin-api/knowledge";
import ts from "typescript";
import { expect, expectTypeOf, it } from "vitest";
import type {
	CapabilitySourceReceipt,
	KnowledgeReuseLevel,
	KnowledgeSnapshot,
	VersionedRecord,
	VersionedResearchContract,
} from "./index";

const shadowedNames = [
	"CapabilitySourceReceipt",
	"ContractParentRef",
	"KnowledgeEvidenceGrade",
	"KnowledgeFreshness",
	"KnowledgeReuseLevel",
	"KnowledgeSnapshot",
	"KnowledgeSourceReceipt",
	"VersionedRecord",
	"VersionedResearchContract",
];

function moduleExports(checker: ts.TypeChecker, source: ts.SourceFile, moduleName: string) {
	const specifier = source.statements
		.filter(ts.isImportDeclaration)
		.map(({ moduleSpecifier }) => moduleSpecifier)
		.find((node) => ts.isStringLiteral(node) && node.text === moduleName);
	const moduleSymbol = specifier && checker.getSymbolAtLocation(specifier);
	if (!moduleSymbol) throw new Error(`Could not resolve ${moduleName}`);
	return new Map(
		checker
			.getExportsOfModule(moduleSymbol)
			.map((symbol) => [
				symbol.name,
				symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol,
			]),
	);
}

function diagnosticMessage(diagnostic: ts.Diagnostic): string {
	return ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
}

it("uses plugin-api declarations for all nine shadowed shared exports", () => {
	expectTypeOf<"lineage" extends keyof VersionedRecord ? true : false>().toEqualTypeOf<false>();
	expectTypeOf<"lineage" extends keyof VersionedResearchContract ? true : false>().toEqualTypeOf<false>();
	expectTypeOf<"lineage" extends keyof CapabilitySourceReceipt ? true : false>().toEqualTypeOf<false>();
	expectTypeOf<"lineage" extends keyof KnowledgeSnapshot ? true : false>().toEqualTypeOf<false>();
	expectTypeOf<KnowledgeReuseLevel>().toEqualTypeOf<PluginKnowledge.KnowledgeReuseLevel>();

	const config = ts.getParsedCommandLineOfConfigFile(
		fileURLToPath(new URL("../tsconfig.json", import.meta.url)),
		{},
		{
			...ts.sys,
			onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
				throw new Error(diagnosticMessage(diagnostic));
			},
		},
	);
	if (!config) throw new Error("Could not load shared tsconfig");
	expect(config.errors.map(diagnosticMessage)).toEqual([]);

	const testPath = fileURLToPath(import.meta.url);
	const program = ts.createProgram([testPath], config.options);
	const source = program.getSourceFile(testPath);
	if (!source) throw new Error("Could not load the barrel regression test");
	const checker = program.getTypeChecker();
	const shared = moduleExports(checker, source, "./index");
	const plugin = moduleExports(checker, source, "@gyoungwe/plugin-api/knowledge");

	const mismatches = shadowedNames.filter(
		(name) => !plugin.has(name) || shared.get(name) !== plugin.get(name),
	);
	expect.soft(mismatches, "exports not resolved to plugin-api").toEqual([]);
	expect(program.getSemanticDiagnostics(source).map(diagnosticMessage)).toEqual([]);
});
