#!/usr/bin/env node
/** Static migration inventory; an empty report is never a runtime acceptance. */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const DOMAIN_PACKAGE =
	/^(@drone\/(?:knowledge|tasks|research|discovery|inquiry)|@gyoungwe\/(?:pi-core|pi-knowledge|pi-research|pi-analysis|pi-evidence|pi-connectors|research-suite|desktop-ui-pack))(?:\/|$)/;
const DOMAIN_BUILD =
	/(?:build:pi-(?:core|research)|fetch:plugins|fetch-plugins|build-pi-(?:core|research)|sync-research-skills|verify-research-release)/;
const DOMAIN_RESOURCE = /(?:research-workbench|research-skills|vendor\/plugins|\.pi\/(?:extensions|skills))/;
const SOURCE_ROOTS = ["packages/backend/src", "packages/desktop/src", "packages/shared/src"];

function sourceFiles(root) {
	if (!existsSync(root)) return [];
	return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
		if (["node_modules", "dist", "out", "__fixtures__"].includes(entry.name)) return [];
		const path = join(root, entry.name);
		if (entry.isDirectory()) return sourceFiles(path);
		return /\.[cm]?[jt]sx?$/.test(entry.name) && !/\.(?:test|spec)\./.test(entry.name) ? [path] : [];
	});
}

/** Type-only edges remain ownership findings, but are distinguished from runtime imports. */
export function packageEdges(source, fileName) {
	const ast = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
	const edges = [];
	function record(node, specifier, typeOnly) {
		if (!ts.isStringLiteral(specifier) || !DOMAIN_PACKAGE.test(specifier.text)) return;
		edges.push({
			line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1,
			package: specifier.text,
			kind: typeOnly ? "domain-type-import" : "domain-runtime-import",
		});
	}
	function visit(node) {
		if (ts.isImportDeclaration(node)) {
			const clause = node.importClause;
			const bindings = clause?.namedBindings;
			const typeOnly = Boolean(
				clause?.isTypeOnly ||
					(clause &&
						!clause.name &&
						bindings &&
						ts.isNamedImports(bindings) &&
						bindings.elements.length > 0 &&
						bindings.elements.every((item) => item.isTypeOnly)),
			);
			record(node, node.moduleSpecifier, typeOnly);
		} else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
			const clause = node.exportClause;
			const typeOnly =
				node.isTypeOnly ||
				(clause &&
					ts.isNamedExports(clause) &&
					clause.elements.length > 0 &&
					clause.elements.every((item) => item.isTypeOnly));
			record(node, node.moduleSpecifier, Boolean(typeOnly));
		} else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
			record(node, node.argument.literal, true);
		} else if (
			ts.isCallExpression(node) &&
			(node.expression.kind === ts.SyntaxKind.ImportKeyword ||
				(ts.isIdentifier(node.expression) && node.expression.text === "require")) &&
			node.arguments.length === 1
		) {
			record(node, node.arguments[0], false);
		}
		ts.forEachChild(node, visit);
	}

	visit(ast);
	return edges;
}

export function inventoryNativePluginBoundary(root) {
	const findings = [];
	const add = (file, kind, detail) => findings.push({ file, kind, ...detail });
	for (const file of ["package.json", "packages/backend/package.json", "packages/desktop/package.json"]) {
		const manifest = JSON.parse(readFileSync(join(root, file), "utf8"));
		for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
			for (const [name, version] of Object.entries(manifest[field] ?? {})) {
				if (DOMAIN_PACKAGE.test(name))
					add(file, "domain-manifest-dependency", { field, package: name, version });
			}
		}
		for (const [name, command] of Object.entries(manifest.scripts ?? {})) {
			if (DOMAIN_BUILD.test(command)) add(file, "domain-build-step", { script: name, command });
		}
	}
	for (const folder of SOURCE_ROOTS) {
		for (const file of sourceFiles(join(root, folder))) {
			for (const edge of packageEdges(readFileSync(file, "utf8"), file)) {
				const { kind, ...detail } = edge;
				add(relative(root, file).replaceAll("\\", "/"), kind, detail);
			}
		}
	}
	const lockFile = "plugins.lock.json";
	if (existsSync(join(root, lockFile))) {
		const lock = JSON.parse(readFileSync(join(root, lockFile), "utf8"));
		for (const plugin of lock.plugins) {
			if (DOMAIN_PACKAGE.test(plugin.name))
				add(lockFile, "required-domain-plugin", {
					package: plugin.name,
					version: plugin.version,
					commit: plugin.commit,
				});
		}
	}
	const resourceFile = "packages/desktop/electron-builder.yml";
	if (existsSync(join(root, resourceFile))) {
		readFileSync(join(root, resourceFile), "utf8")
			.split("\n")
			.forEach((text, index) => {
				if (!text.trimStart().startsWith("#") && (DOMAIN_RESOURCE.test(text) || DOMAIN_BUILD.test(text))) {
					add(resourceFile, "domain-packaged-resource", { line: index + 1, text: text.trim() });
				}
			});
	}
	findings.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
	const counts = {};
	for (const finding of findings) counts[finding.kind] = (counts[finding.kind] ?? 0) + 1;
	return {
		schemaVersion: 1,
		status: findings.length ? "INCOMPLETE" : "STATIC_CLEAR_RUNTIME_UNVERIFIED",
		runtimeAcceptance: "NOT_RUN",
		scope:
			"Host manifests, literal domain package imports/reexports, required plugin lock and packaging resources. Local domain implementations, computed imports and runtime behavior require the companion inventory and real application acceptance.",
		counts,
		findings,
	};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	const report = inventoryNativePluginBoundary(resolve(import.meta.dirname, ".."));
	console.log(JSON.stringify(report, null, 2));
	process.exitCode = report.findings.length ? 1 : 0;
}
