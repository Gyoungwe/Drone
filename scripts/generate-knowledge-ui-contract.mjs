#!/usr/bin/env node
/** Generate the standalone public UI contract from the host's authoritative wire types. */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(
	readFileSync(resolve(root, "packages/plugin-api/scripts/knowledge-ui-contract.json"), "utf8"),
);
const modules = config.modules;
if (!Array.isArray(modules) || modules.length === 0) {
	throw new Error("knowledge-ui-contract.json must list at least one module");
}
/**
 * The neutral routing declaration.  Domain groups are host-owned boundaries;
 * the operations inside a group belong to the plugin and are transported as
 * an opaque envelope, so the wire never restates a domain schema.
 */
const ROUTE_DECLARATION = `export interface KnowledgeUiRoute {
	invoke(operation: string, input?: unknown): Promise<unknown>;
}

/** Domain operations are addressed by name; the host keeps only a group boundary. */
export interface KnowledgeUiPort {
	readonly knowledge: KnowledgeUiRoute;
	readonly daily: KnowledgeUiRoute;
	readonly zotero: KnowledgeUiRoute;
}`;
const sharedRoot = resolve(root, "packages/shared/src").replaceAll("\\", "/");
const indexPath = resolve(sharedRoot, "index.ts");
const ipcPath = resolve(sharedRoot, "ipc.ts");
const apiRoot = resolve(root, "packages/plugin-api/src").replaceAll("\\", "/");
const program = ts.createProgram([indexPath, ipcPath], {
	target: ts.ScriptTarget.ES2022,
	module: ts.ModuleKind.ESNext,
	moduleResolution: ts.ModuleResolutionKind.Bundler,
	strict: true,
	paths: {
		"@gyoungwe/plugin-api": [resolve(apiRoot, "index.ts")],
		"@gyoungwe/plugin-api/knowledge": [resolve(apiRoot, "knowledge.ts")],
	},
	types: [],
});
const checker = program.getTypeChecker();
const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
const declarations = new Map();
const names = new Map();
const usedNames = new Set();
/** The module that publishes a declaration; the first module to need it owns it. */
const owners = new Map();
function resolveSymbol(symbol) {
	return symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
}
function addSymbol(symbol, moduleIndex) {
	const resolved = resolveSymbol(symbol);
	const declaration = resolved.declarations?.find(
		(node) => ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node),
	);
	if (!declaration) return;
	const filename = declaration.getSourceFile().fileName.replaceAll("\\", "/");
	if (!filename.startsWith(`${sharedRoot}/`) && !filename.startsWith(`${apiRoot}/`)) {
		if (filename.includes("/node_modules/typescript/lib/")) return;
		throw new Error(`Public UI type ${resolved.name} depends on unsupported source ${filename}`);
	}
	if (declarations.has(resolved)) {
		if (!owners.has(resolved)) owners.set(resolved, moduleIndex);
		return;
	}
	const name = usedNames.has(resolved.name)
		? `${filename.startsWith(`${apiRoot}/`) ? "Contract" : "Host"}${resolved.name}`
		: resolved.name;
	if (usedNames.has(name)) throw new Error(`Conflicting public UI type ${name}`);
	usedNames.add(name);
	names.set(resolved, name);
	declarations.set(resolved, declaration);
	owners.set(resolved, moduleIndex);
	collect(declaration, moduleIndex);
}
function needsExpansion(node) {
	if (ts.isTypeQueryNode(node)) return true;
	if (!ts.isTypeReferenceNode(node)) return false;
	const symbol = checker.getSymbolAtLocation(node.typeName);
	const filename = symbol && resolveSymbol(symbol).declarations?.[0]?.getSourceFile().fileName;
	return node.typeName.getText() === "Static" || filename?.includes("/shared/src/host-api/");
}
function collect(node, moduleIndex) {
	// Constants are represented by their exact literal types, never exported as fake runtime values.
	if (needsExpansion(node)) return;
	if (ts.isIdentifier(node)) {
		const symbol = checker.getSymbolAtLocation(node);
		if (symbol) addSymbol(symbol, moduleIndex);
	}
	ts.forEachChild(node, (child) => collect(child, moduleIndex));
}
const index = program.getSourceFile(indexPath);
const exports = new Map(
	checker.getExportsOfModule(checker.getSymbolAtLocation(index)).map((symbol) => [symbol.name, symbol]),
);
/**
 * Resolve every module's requested types in order.  A declaration is published
 * by the first module that needs it; later modules import it instead of
 * repeating it, so one name keeps one declaration and the wire cannot drift.
 */
for (let moduleIndex = 0; moduleIndex < modules.length; moduleIndex += 1) {
	for (const name of modules[moduleIndex].types) {
		const symbol = exports.get(name);
		if (!symbol) throw new Error(`Missing shared export ${name}`);
		addSymbol(symbol, moduleIndex);
	}
}
function print(node, references) {
	const result = ts.transform(node, [
		(context) => {
			function visit(current) {
				if (needsExpansion(current)) {
					return checker.typeToTypeNode(
						checker.getTypeAtLocation(current),
						undefined,
						ts.NodeBuilderFlags.NoTruncation | ts.NodeBuilderFlags.InTypeAlias,
					);
				}
				if (ts.isIdentifier(current)) {
					const symbol = checker.getSymbolAtLocation(current);
					const resolved = symbol && resolveSymbol(symbol);
					const name = resolved && names.get(resolved);
					if (name) {
						references?.add(resolved);
						if (name !== current.text) return ts.factory.createIdentifier(name);
					}
				}
				return ts.visitEachChild(current, visit, context);
			}
			return visit;
		},
	]);
	const output = printer.printNode(ts.EmitHint.Unspecified, result.transformed[0], node.getSourceFile());
	result.dispose();
	return output;
}
function modulePath(moduleIndex) {
	return `./${modules[moduleIndex].file.replace(/\.ts$/, ".js")}`;
}
function formatContract(text, target) {
	try {
		return execFileSync(
			process.execPath,
			[resolve(root, "node_modules/@biomejs/biome/bin/biome"), "format", "--stdin-file-path", target],
			{
				input: text,
				encoding: "utf8",
				timeout: 120000,
				killSignal: "SIGKILL",
				stdio: ["pipe", "pipe", "pipe"],
			},
		);
	} catch (error) {
		if (error.code === "ETIMEDOUT" || error.signal) {
			throw new Error(
				"biome format timed out after 120000 ms; rerun node scripts/generate-knowledge-ui-contract.mjs --check",
			);
		}
		throw error;
	}
}
const check = process.argv.includes("--check");
const published = [];
for (let moduleIndex = 0; moduleIndex < modules.length; moduleIndex += 1) {
	const module = modules[moduleIndex];
	const owned = [...declarations]
		.filter(([symbol]) => owners.get(symbol) === moduleIndex)
		.sort(([a], [b]) => names.get(a).localeCompare(names.get(b)));
	const references = new Set();
	const body = owned
		.map(([, declaration]) => {
			const text = print(declaration, references);
			return declaration.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
				? text
				: `export ${text}`;
		})
		.join("\n\n");
	/** Types published by another module are imported, never repeated. */
	const foreign = new Map();
	for (const symbol of references) {
		const owner = owners.get(symbol);
		if (owner === undefined || owner === moduleIndex) continue;
		const list = foreign.get(owner) ?? [];
		list.push(names.get(symbol));
		foreign.set(owner, list);
	}
	const imports = [...foreign.entries()]
		.sort(([a], [b]) => a - b)
		.map(([owner, list]) => `import type { ${list.sort().join(", ")} } from "${modulePath(owner)}";`)
		.join("\n");
	const sections = [
		"// Generated by scripts/generate-knowledge-ui-contract.mjs. Do not edit.\n" +
			"// This file contains only the public knowledge UI wire contract, with no host implementation imports.",
	];
	if (module.routes) sections.push(ROUTE_DECLARATION);
	if (imports) sections.push(imports);
	sections.push(body);
	const rawOutput = `${sections.join("\n\n")}\n`;
	const target = resolve(root, "packages/plugin-api/src", module.file);
	const output = formatContract(rawOutput, target);
	if (check) {
		if (readFileSync(target, "utf8") !== output)
			throw new Error(
				`Public UI contract is stale: ${module.file}; run node scripts/generate-knowledge-ui-contract.mjs`,
			);
	} else {
		writeFileSync(target, output);
	}
	published.push(owned.length);
}
console.log(
	`Knowledge UI contract: 3 neutral routes, ${published.reduce((sum, count) => sum + count, 0)} wire types in ${modules.length} modules`,
);
