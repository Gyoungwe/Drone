#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const bundle = await readFile(resolve(root, "packages/pi-core/dist/index.mjs"), "utf8");
const expected = ["ask_user", "set_status", "todo", "deliver_files", "memory_save", "task_plan"];
for (const name of expected) {
	if (!bundle.includes(JSON.stringify(name))) throw new Error(`pi-core smoke: missing ${name}`);
}
if (/(?:from|import\s*\(|require\s*\()["'](?:electron|@drone\/(?:backend|desktop))["']/u.test(bundle))
	throw new Error("pi-core smoke: host-only import found");
console.log(`pi-core bundle smoke passed (${expected.length} core tools + task runtime)`);
