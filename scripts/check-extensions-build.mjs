import { readdir, access } from "node:fs/promises";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "..");
const sourceDir = resolve(root, "packages/extensions/src");
const outDir = resolve(root, ".pi/extensions");
const entries = (await readdir(sourceDir)).filter((name) => name.endsWith(".ts"));
for (const entry of entries) await access(resolve(outDir, `${entry.slice(0, -3)}.mjs`));
console.log(`verified ${entries.length} extension source/output mappings`);
