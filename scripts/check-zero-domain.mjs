#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { isMainModule } from "./is-main-module.mjs";

const baselinePath = "scripts/fixtures/zero-domain-baseline.json";
const sourceExcludes = new Set(["test", "dist", "out", "node_modules"]);
const domainPackages = new Set([
	"@gyoungwe/pi-analysis",
	"@gyoungwe/pi-connectors",
	"@gyoungwe/pi-core",
	"@gyoungwe/pi-evidence",
	"@gyoungwe/pi-knowledge",
	"@gyoungwe/pi-research",
]);
const hostDependencies = new Set([...domainPackages, "@drone/extensions", "@drone/research"]);
/**
 * Every first-party package the host must not depend on.
 *
 * The ratchet has to see the whole class, not only the packages that happen to
 * be imported today: a package nobody imports yet is exactly the one a later
 * change would reach for.
 */
const hostForbiddenPackages = new Set([
	...domainPackages,
	"@gyoungwe/desktop-ui-pack",
	"@gyoungwe/research-suite",
]);
const packageSpecifier =
	/(["'`])(@gyoungwe\/(?:pi-[\w.-]+|desktop-ui-pack|research-suite))(?:\/[^"'`\r\n]*)?\1/g;
const domainResource = /research-workbench|\.pi\/(?:extensions|skills\/)|plugin-packages|vendor\/plugins/;
const domainCommand =
	/(?:^|[\n;&|()])\s*npm\s+(?:run|run-script)\s+(["']?)(?:build:pi-(?:core|research)|fetch:plugins|check:(?:[\w:-]+-runtime|pi-research|pi-core|builtin-plugins))\1(?=$|[\s;&|()])/;
const domainChannelName =
	/(?:researchSkills|knowledge|research|zotero|analysis|evidence|discovery|inquiry|daily):[\w:.-]+/;
const domainChannelLiteral = new RegExp(`(["'\`])(${domainChannelName.source})\\1`, "g");
const domainChannelValue = new RegExp(`^${domainChannelName.source}$`);
/**
 * The host's own first-party inventory.
 *
 * The host ships these packages, so it owns the list — but the list lives in
 * data now, not in code. The ratchet keeps seeing it: a package that joins
 * the inventory is a package the host will offer, and that has to be visible
 * rather than silently added.
 */
const hostCatalogFile = "packages/shared/resources/first-party-packages.json";

function readOptional(file) {
	if (existsSync(file)) return readFileSync(file, "utf8");
}

function readManifest(file) {
	const source = readOptional(file);
	return source === undefined ? {} : JSON.parse(source);
}

function sortedKeys(entries) {
	return [...new Set(entries)].sort();
}

function inventoryDependencies(root, packageDirs, rootManifest) {
	const manifests = [
		["package.json", rootManifest],
		...packageDirs.map((name) => {
			const file = `packages/${name}/package.json`;
			return [file, readManifest(join(root, file))];
		}),
	];
	return manifests.flatMap(([file, manifest]) =>
		Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })
			.filter((name) => hostDependencies.has(name))
			.map((name) => `${file}:${name}`),
	);
}

function* sourceFiles(directory) {
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const file = join(directory, entry.name);
		if (entry.isDirectory() && !sourceExcludes.has(entry.name)) yield* sourceFiles(file);
		if (entry.isFile() && !entry.name.includes(".test.")) yield file;
	}
}

function inventorySourceImports(root, packageDirs) {
	const findings = [];
	for (const name of packageDirs) {
		const directory = join(root, "packages", name, "src");
		if (!existsSync(directory)) continue;
		for (const file of sourceFiles(directory)) {
			const path = relative(root, file).split(sep).join("/");
			for (const [, , packageName] of readFileSync(file, "utf8").matchAll(packageSpecifier)) {
				if (hostForbiddenPackages.has(packageName)) findings.push(`${path}:${packageName}`);
			}
		}
	}
	return findings;
}

function yamlScalar(source) {
	const quoted = source.match(/^(["'])(.*?)\1(?=\s*(?:#|$))/);
	return quoted ? quoted[2] : source.replace(/\s+#.*$/, "").trimEnd();
}

function inventoryBuilderResources(source) {
	const findings = [];
	let resourcesIndent = Infinity;
	for (const line of source.split(/\r?\n/)) {
		const content = line.trimStart();
		if (!content || content.startsWith("#")) continue;
		const indent = line.length - content.length;
		if (indent < resourcesIndent || (indent === resourcesIndent && !content.startsWith("-"))) {
			resourcesIndent = Infinity;
		}
		if (/^extraResources:\s*(?:#.*)?$/.test(content)) resourcesIndent = indent;
		const resource = content.match(/^(?:-\s+)?from:\s+(.+)/);
		if (resource && resourcesIndent !== Infinity) {
			const value = yamlScalar(resource[1]);
			if (domainResource.test(value)) findings.push(value);
		}
		const beforePack = indent === 0 && content.match(/^beforePack:\s+(.+)/);
		if (beforePack) {
			const value = yamlScalar(beforePack[1]);
			if (/(?:^|[/\\])[^/\\]*research[^/\\]*$/.test(value)) findings.push(`beforePack:${value}`);
		}
	}
	return findings;
}

function inventoryHostCatalog(root) {
	const source = readOptional(join(root, hostCatalogFile));
	if (source === undefined) return [];
	const parsed = JSON.parse(source);
	return Array.isArray(parsed?.packages)
		? parsed.packages
				.map((entry) => entry?.name)
				.filter((name) => typeof name === "string" && name.length > 0)
		: [];
}

function ipcChannelLiterals(source) {
	return Array.from(source.matchAll(domainChannelLiteral), (match) => match[2]);
}

function channelsFromDomainCall(call) {
	if (!ts.isIdentifier(call.expression) || call.expression.text !== "defineDomain") return [];
	const [domain, spec] = call.arguments;
	if (!domain || !ts.isStringLiteralLike(domain) || !spec || !ts.isObjectLiteralExpression(spec)) return [];
	return spec.properties
		.filter(
			(group) =>
				ts.isPropertyAssignment(group) &&
				(group.name.text === "methods" || group.name.text === "events") &&
				ts.isObjectLiteralExpression(group.initializer),
		)
		.flatMap((group) => group.initializer.properties)
		.flatMap(({ name }) => (name?.text === undefined ? [] : [`${domain.text}:${name.text}`]))
		.filter((channel) => domainChannelValue.test(channel));
}

function contractChannels(file, source) {
	const channels = [];
	function visit(node) {
		if (ts.isCallExpression(node)) channels.push(...channelsFromDomainCall(node));
		ts.forEachChild(node, visit);
	}
	visit(ts.createSourceFile(file, source, ts.ScriptTarget.Latest));
	return channels;
}

function inventoryDomainChannels(root) {
	const channels = [];
	const hostApi = join(root, "packages/shared/src/host-api");
	if (!existsSync(hostApi)) return channels;
	for (const entry of readdirSync(hostApi, { withFileTypes: true })) {
		if (!entry.isFile() || !entry.name.endsWith(".ts") || entry.name.includes(".test.")) continue;
		const file = join(hostApi, entry.name);
		const source = readFileSync(file, "utf8");
		channels.push(...ipcChannelLiterals(source), ...contractChannels(file, source));
	}
	return channels;
}

export function collectZeroDomainFindings(root) {
	const packagesDir = join(root, "packages");
	const packageDirs = existsSync(packagesDir)
		? readdirSync(packagesDir, { withFileTypes: true })
				.filter((entry) => entry.isDirectory())
				.map((entry) => entry.name)
		: [];
	const rootManifest = readManifest(join(root, "package.json"));
	const lock = readOptional(join(root, "plugins.lock.json"));
	const plugins = lock === undefined ? [] : JSON.parse(lock).plugins;
	const builder = readOptional(join(root, "packages/desktop/electron-builder.yml"));
	const findings = {
		lockEntries: plugins.map((plugin) => plugin.name),
		builtinEntries: plugins.filter((plugin) => plugin.builtin === true).map((plugin) => plugin.name),
		hostDependencies: inventoryDependencies(root, packageDirs, rootManifest),
		hostSourceImports: inventorySourceImports(root, packageDirs),
		hostCatalogEntries: inventoryHostCatalog(root),
		builderResources: inventoryBuilderResources(builder ?? ""),
		rootScripts: Object.entries(rootManifest.scripts ?? {})
			.filter(([, command]) => domainCommand.test(command))
			.map(([name]) => name),
		domainIpcChannels: inventoryDomainChannels(root),
	};
	return Object.fromEntries(Object.entries(findings).map(([category, keys]) => [category, sortedKeys(keys)]));
}

function difference(keys, otherKeys) {
	const other = new Set(otherKeys);
	return keys.filter((key) => !other.has(key));
}

/**
 * A category the baseline does not know yet is a new category, not a failure
 * of the comparison: the baseline is a record of what the host has, so a
 * category that appears is recorded on the next `--update`.
 */
function categoryKeys(category, source) {
	return source[category] ?? [];
}

export function compareToBaseline(findings, baseline) {
	const categories = Object.keys(findings);
	return {
		added: Object.fromEntries(
			categories.map((category) => [
				category,
				difference(categoryKeys(category, findings), categoryKeys(category, baseline)),
			]),
		),
		removed: Object.fromEntries(
			categories.map((category) => [
				category,
				difference(categoryKeys(category, baseline), categoryKeys(category, findings)),
			]),
		),
	};
}

function reportKeys(label, categories) {
	for (const [category, keys] of Object.entries(categories)) {
		for (const key of keys) console.error(`${label} ${category}: ${key}`);
	}
}

function run(root, update) {
	const findings = collectZeroDomainFindings(root);
	const file = join(root, baselinePath);
	const baseline = JSON.parse(readFileSync(file, "utf8"));
	const { added, removed } = compareToBaseline(findings, baseline);
	const hasAdditions = Object.values(added).some((keys) => keys.length > 0);
	if (hasAdditions) reportKeys("New", added);
	if (update && !hasAdditions) {
		writeFileSync(file, `${JSON.stringify(findings, null, 2)}\n`);
	} else {
		reportKeys("fixed, run with --update", removed);
	}
	const counts = Object.fromEntries(
		Object.entries(findings).map(([category, keys]) => [category, keys.length]),
	);
	const status = Object.values(counts).some(Boolean) ? "PARTIAL" : "ZERO";
	console.log(JSON.stringify({ status, counts }));
	return hasAdditions ? 1 : 0;
}

if (isMainModule(import.meta.url)) {
	process.exitCode = run(fileURLToPath(new URL("../", import.meta.url)), process.argv.includes("--update"));
}
