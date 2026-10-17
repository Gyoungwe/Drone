#!/usr/bin/env node
/**
 * Map first-party tool registrations to the native Pi registration surface.
 *
 * The source scan is intentionally static: it never imports extensions, executes
 * a session, or reads generated .pi output. The fixture is the migration map for
 * the planned Pi packages, while the source is the authority for the tool names
 * and locations currently registered by Drone.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_FIXTURE = path.join(SCRIPT_DIR, "fixtures", "native-pi-tools.json");

const SOURCE_ROOTS = [
  "packages/extensions/src",
  "packages/backend/src/tools",
  "packages/backend/src/capabilities",
];
const TASK_REGISTER_FILE = "packages/tasks/src/runtime/register.ts";

function lineNumber(source, index) {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor++) if (source[cursor] === "\n") line++;
  return line;
}

function skipString(source, index) {
  const quote = source[index];
  let cursor = index + 1;
  let escaped = false;
  while (cursor < source.length) {
    const char = source[cursor];
    if (escaped) escaped = false;
    else if (char === "\\") escaped = true;
    else if (char === quote) return cursor + 1;
    cursor++;
  }
  return source.length;
}

function skipComment(source, index) {
  if (source.startsWith("//", index)) {
    const end = source.indexOf("\n", index + 2);
    return end < 0 ? source.length : end;
  }
  if (source.startsWith("/*", index)) {
    const end = source.indexOf("*/", index + 2);
    return end < 0 ? source.length : end + 2;
  }
  return index;
}

function findObjectArgument(source, callEnd) {
  let cursor = callEnd;
  while (cursor < source.length) {
    const char = source[cursor];
    if (char === "\"" || char === "'" || char === "`") {
      cursor = skipString(source, cursor);
      continue;
    }
    if (char === "/" && (source[cursor + 1] === "/" || source[cursor + 1] === "*")) {
      cursor = skipComment(source, cursor);
      continue;
    }
    if (char === "{") return cursor;
    if (char === ")" || char === ";") return -1;
    cursor++;
  }
  return -1;
}

function matchingBrace(source, open) {
  let depth = 0;
  let cursor = open;
  while (cursor < source.length) {
    const char = source[cursor];
    if (char === "\"" || char === "'" || char === "`") {
      cursor = skipString(source, cursor);
      continue;
    }
    if (char === "/" && (source[cursor + 1] === "/" || source[cursor + 1] === "*")) {
      cursor = skipComment(source, cursor);
      continue;
    }
    if (char === "{") depth++;
    if (char === "}" && --depth === 0) return cursor;
    cursor++;
  }
  return -1;
}

function literalName(objectSource) {
  const match = objectSource.match(/\bname\s*:\s*(["'])([^"'\n]+)\1/);
  return match?.[2] ?? null;
}

function scanDirectRegistrations(source, relativePath) {
  const records = [];
  const callPattern = /\b(?:pi\.)?registerTool\s*\(/g;
  for (const match of source.matchAll(callPattern)) {
    const open = findObjectArgument(source, match.index + match[0].length);
    if (open < 0) continue;
    const close = matchingBrace(source, open);
    if (close < 0) continue;
    const name = literalName(source.slice(open, close + 1));
    if (!name) continue;
    records.push({
      name,
      source: relativePath,
      line: lineNumber(source, match.index),
      registration: "registerTool",
      nativePiAvailable: true,
    });
  }
  return records;
}

function scanTaskHelperRegistrations(source, relativePath) {
  const records = [];
  const callPattern = /\btool\s*\(\s*(["'])([^"'\n]+)\1/g;
  for (const match of source.matchAll(callPattern)) {
    records.push({
      name: match[2],
      source: relativePath,
      line: lineNumber(source, match.index),
      registration: "task-helper",
      nativePiAvailable: true,
    });
  }
  return records;
}

function resolveImportedSource(rootDir, importerPath, modulePath) {
  if (!modulePath.startsWith(".")) return null;
  const base = path.resolve(path.dirname(importerPath), modulePath);
  const candidates = [base, `${base}.ts`, path.join(base, "index.ts")];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function importedFunctionNames(source, identifier) {
  const names = [];
  const pattern = /import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g;
  for (const match of source.matchAll(pattern)) {
    for (const specifier of match[1].split(",")) {
      const [imported, local = imported] = specifier.trim().split(/\s+as\s+/);
      if (local?.trim() === identifier) names.push({ imported: imported.trim(), modulePath: match[2] });
    }
  }
  return names;
}

function scanDynamicRegistrations(rootDir, absolutePath, relativePath, source) {
  const records = [];
  const dynamicPattern = /\b(?:pi\.)?registerTool\s*\(\s*([A-Za-z_$][\w$]*)\s*\)/g;
  for (const match of source.matchAll(dynamicPattern)) {
    const identifier = match[1];
    const imported = importedFunctionNames(source, identifier);
    // A factory-backed registration has the shape `makeChannelTools(...)` followed
    // by `pi.registerTool(tool)`. Resolve the imported *Tools factory* as the
    // definition source when the loop variable itself is local.
    if (!imported.length) {
      const factories = new Set();
      for (const factoryMatch of source.matchAll(/\b([A-Za-z_$][\w$]*Tools)\s*\(/g)) {
        for (const factory of importedFunctionNames(source, factoryMatch[1])) factories.add(JSON.stringify(factory));
      }
      imported.push(...[...factories].map((value) => JSON.parse(value)));
    }
    // channel-watch registers the ToolDefinition objects returned by makeChannelTools().
    // Keep this generic enough for future factory-backed tool lists, while avoiding
    // broad name scraping from unrelated configuration objects.
    for (const { imported: functionName, modulePath } of imported) {
      if (!/Tools$/.test(functionName)) continue;
      const dependency = resolveImportedSource(rootDir, absolutePath, modulePath);
      if (!dependency) continue;
      const dependencySource = fs.readFileSync(dependency, "utf8");
      const functionStart = dependencySource.search(new RegExp(`(?:function|const)\\s+${functionName}\\b`));
      const functionBody = functionStart >= 0 ? dependencySource.slice(functionStart) : dependencySource;
      const namePattern = /\bname\s*:\s*(["'])([^"'\n]+)\1/g;
      for (const definition of functionBody.matchAll(namePattern)) {
        const nameIndex = (functionStart >= 0 ? functionStart : 0) + definition.index;
        records.push({
          name: definition[2],
          source: path.relative(rootDir, dependency).replaceAll(path.sep, "/"),
          line: lineNumber(dependencySource, nameIndex),
          registration: "dynamic-registerTool",
          registrationSource: relativePath,
          registrationLine: lineNumber(source, match.index),
          nativePiAvailable: true,
        });
      }
    }
  }
  return records;
}

function collectSourceFiles(rootDir) {
  const files = [];
  const visit = (absolutePath) => {
    if (!fs.existsSync(absolutePath)) return;
    const stat = fs.statSync(absolutePath);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(absolutePath).sort()) visit(path.join(absolutePath, entry));
    } else if (stat.isFile() && absolutePath.endsWith(".ts")) {
      files.push(absolutePath);
    }
  };
  for (const relativeRoot of SOURCE_ROOTS) visit(path.join(rootDir, relativeRoot));
  visit(path.join(rootDir, TASK_REGISTER_FILE));
  return files;
}

export function scanNativePiRegistrations(rootDir = path.resolve(SCRIPT_DIR, "..")) {
  const records = [];
  for (const absolutePath of collectSourceFiles(rootDir)) {
    const relativePath = path.relative(rootDir, absolutePath).replaceAll(path.sep, "/");
    const source = fs.readFileSync(absolutePath, "utf8");
    records.push(...scanDirectRegistrations(source, relativePath));
    if (relativePath === TASK_REGISTER_FILE) records.push(...scanTaskHelperRegistrations(source, relativePath));
    records.push(...scanDynamicRegistrations(rootDir, absolutePath, relativePath, source));
  }
  const byName = new Map();
  for (const record of records) {
    const previous = byName.get(record.name);
    if (previous) throw new Error(`Duplicate native Pi tool registration: ${record.name} (${previous.source}:${previous.line}, ${record.source}:${record.line})`);
    byName.set(record.name, record);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function validateNativePiFixture(records, fixture) {
  const mappings = fixture?.tools ?? fixture?.mappings;
  const errors = [];
  if (!fixture || fixture.version !== 1) errors.push("fixture version must be 1");
  if (!mappings || typeof mappings !== "object" || Array.isArray(mappings)) {
    errors.push("fixture must contain a tools object");
    return errors;
  }
  const seen = new Set();
  for (const record of records) {
    seen.add(record.name);
    const mapping = mappings[record.name];
    if (!mapping) {
      errors.push(`missing fixture mapping for ${record.name}`);
      continue;
    }
    if (mapping.source !== record.source) errors.push(`${record.name}: fixture source ${mapping.source} != ${record.source}`);
    if (mapping.registration && mapping.registration !== record.registration)
      errors.push(`${record.name}: fixture registration ${mapping.registration} != ${record.registration}`);
    if (typeof mapping.nativePiAvailable !== "boolean") errors.push(`${record.name}: nativePiAvailable must be boolean`);
    if (typeof mapping.targetPackage !== "string" || !mapping.targetPackage.trim())
      errors.push(`${record.name}: targetPackage must be a non-empty string`);
  }
  for (const name of Object.keys(mappings)) if (!seen.has(name)) errors.push(`fixture mapping has no source registration: ${name}`);
  return errors;
}

export function applyFixture(records, fixture) {
  const mappings = fixture.tools ?? fixture.mappings;
  return records.map((record) => ({
    toolName: record.name,
    location: `${record.source}:${record.line}`,
    registration: record.registration,
    ...(record.registrationSource
      ? { registrationLocation: `${record.registrationSource}:${record.registrationLine}` }
      : {}),
    nativePiAvailable: mappings[record.name].nativePiAvailable,
    targetPackage: mappings[record.name].targetPackage,
  }));
}

export function formatReport(mapped) {
  const lines = [`Native Pi tool map (${mapped.length} registrations)`, "", "tool\tlocation\tnative Pi\ttarget package"];
  for (const entry of mapped) {
    lines.push(
      `${entry.toolName}\t${entry.location}${entry.registrationLocation ? ` (registered at ${entry.registrationLocation})` : ""}\t${entry.nativePiAvailable ? "yes" : "no"}\t${entry.targetPackage}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function parseArgs(argv) {
  const args = { json: false, root: path.resolve(SCRIPT_DIR, ".."), fixture: DEFAULT_FIXTURE };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--json") args.json = true;
    else if (arg === "--root") args.root = path.resolve(argv[++index] ?? "");
    else if (arg === "--fixture") args.fixture = path.resolve(argv[++index] ?? "");
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/check-native-pi.mjs [--json] [--root DIR] [--fixture FILE]");
      process.exit(0);
    } else throw new Error(`Unknown option: ${arg}`);
  }
  return args;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const fixture = JSON.parse(fs.readFileSync(args.fixture, "utf8"));
    const records = scanNativePiRegistrations(args.root);
    const errors = validateNativePiFixture(records, fixture);
    if (errors.length) {
      console.error(["Native Pi mapping failed:", ...errors.map((error) => `- ${error}`)].join("\n"));
      process.exitCode = 1;
    } else {
      const mapped = applyFixture(records, fixture);
      process.stdout.write(args.json ? `${JSON.stringify(mapped, null, 2)}\n` : formatReport(mapped));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
