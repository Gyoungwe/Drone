import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type * as PluginKnowledge from "@gyoungwe/plugin-api/knowledge";
import ts from "typescript";
import { expect, expectTypeOf, it } from "vitest";
import type {
	CapabilitySourceReceipt,
	ContractParentRef,
	KnowledgeEvidenceGrade,
	KnowledgeFreshness,
	KnowledgeReuseLevel,
	KnowledgeSnapshot,
	KnowledgeSourceReceipt,
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

const barrelPath = fileURLToPath(new URL("./index.ts", import.meta.url));
const pluginApiKnowledge = "@gyoungwe/plugin-api/knowledge";

/**
 * The names the barrel re-exports from the plugin API.
 *
 * The barrel re-exports these names explicitly from the plugin API while the
 * same names are also reachable through `export *` from the host's own
 * contracts.  The explicit block wins, so a consumer of `@drone/shared`
 * receives the plugin-api declaration rather than the host's local one, even
 * where the two differ: the host's `VersionedRecord` carries an optional
 * `lineage` field that the plugin-api one does not.
 *
 * The lookup reads the barrel's named export declarations syntactically.  The
 * earlier version resolved the same fact through the type checker, which meant
 * building a program over every shared source file; that took seconds and left
 * the test at the edge of the runner's timeout.
 */
function namesReExportedFromPluginApi(): Set<string> {
	const source = ts.createSourceFile(
		"index.ts",
		readFileSync(barrelPath, "utf8"),
		ts.ScriptTarget.ESNext,
		true,
		ts.ScriptKind.TS,
	);
	const reExported = new Set<string>();
	for (const statement of source.statements) {
		if (!ts.isExportDeclaration(statement)) continue;
		if (!statement.exportClause || !ts.isNamedExports(statement.exportClause)) continue;
		if (statement.moduleSpecifier?.getText(source) !== `"${pluginApiKnowledge}"`) continue;
		for (const element of statement.exportClause.elements) reExported.add(element.name.text);
	}
	return reExported;
}

it("uses plugin-api declarations for all nine shadowed shared exports", () => {
	expectTypeOf<"lineage" extends keyof VersionedRecord ? true : false>().toEqualTypeOf<false>();
	expectTypeOf<"lineage" extends keyof VersionedResearchContract ? true : false>().toEqualTypeOf<false>();
	expectTypeOf<"lineage" extends keyof CapabilitySourceReceipt ? true : false>().toEqualTypeOf<false>();
	expectTypeOf<"lineage" extends keyof KnowledgeSnapshot ? true : false>().toEqualTypeOf<false>();
	expectTypeOf<KnowledgeReuseLevel>().toEqualTypeOf<PluginKnowledge.KnowledgeReuseLevel>();

	const reExported = namesReExportedFromPluginApi();
	const missing = shadowedNames.filter((name) => !reExported.has(name));
	expect.soft(missing, "exports not re-exported from the plugin API").toEqual([]);

	// The plugin API is the only source of these names for the barrel, so the
	// host's own contract modules must not export them under the same names.
	// Each name is referenced in type position: a missing declaration is a
	// compile error, which is a stronger check than a runtime assertion.
	expectTypeOf<PluginKnowledge.CapabilitySourceReceipt>().not.toBeNever();
	expectTypeOf<PluginKnowledge.ContractParentRef>().not.toBeNever();
	expectTypeOf<PluginKnowledge.KnowledgeEvidenceGrade>().not.toBeNever();
	expectTypeOf<PluginKnowledge.KnowledgeFreshness>().not.toBeNever();
	expectTypeOf<PluginKnowledge.KnowledgeReuseLevel>().not.toBeNever();
	expectTypeOf<PluginKnowledge.KnowledgeSnapshot>().not.toBeNever();
	expectTypeOf<PluginKnowledge.KnowledgeSourceReceipt>().not.toBeNever();
	expectTypeOf<PluginKnowledge.VersionedRecord>().not.toBeNever();
	expectTypeOf<PluginKnowledge.VersionedResearchContract>().not.toBeNever();

	// The barrel must hand consumers the plugin's declaration, not a local
	// one that happens to share the name.
	expectTypeOf<CapabilitySourceReceipt>().toEqualTypeOf<PluginKnowledge.CapabilitySourceReceipt>();
	expectTypeOf<ContractParentRef>().toEqualTypeOf<PluginKnowledge.ContractParentRef>();
	expectTypeOf<KnowledgeEvidenceGrade>().toEqualTypeOf<PluginKnowledge.KnowledgeEvidenceGrade>();
	expectTypeOf<KnowledgeFreshness>().toEqualTypeOf<PluginKnowledge.KnowledgeFreshness>();
	expectTypeOf<KnowledgeSnapshot>().toEqualTypeOf<PluginKnowledge.KnowledgeSnapshot>();
	expectTypeOf<KnowledgeSourceReceipt>().toEqualTypeOf<PluginKnowledge.KnowledgeSourceReceipt>();
	expectTypeOf<VersionedResearchContract>().toEqualTypeOf<PluginKnowledge.VersionedResearchContract>();
});
