import { readdir, mkdir, stat } from "node:fs/promises";
import { dirname, resolve, relative, basename, extname } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const sourceDir = resolve(root, "packages/extensions/src");
const outDir = resolve(root, process.argv.includes("--out-dir") ? process.argv[process.argv.indexOf("--out-dir") + 1] : ".pi/extensions");
const force = process.argv.includes("--force");

const entries = (await readdir(sourceDir)).filter((name) => name.endsWith(".ts"));
if (entries.length === 0) throw new Error(`No extension entries found in ${sourceDir}`);
await mkdir(outDir, { recursive: true });
for (const entry of entries) {
  const output = resolve(outDir, `${basename(entry, extname(entry))}.mjs`);
  try { await stat(output); if (!force) { console.log(`preserved existing ${relative(root, output)}`); continue; } } catch {}
  await build({ entryPoints: [resolve(sourceDir, entry)], outfile: output, bundle: true, format: "esm", platform: "node", sourcemap: false, packages: "bundle", logLevel: "silent" });
  console.log(`built ${relative(root, output)} from ${relative(root, resolve(sourceDir, entry))}`);
}
