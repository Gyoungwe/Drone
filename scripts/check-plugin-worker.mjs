#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const worker = join(root, ".pi/extensions/knowledge-worker.mjs");
const manifestPath = join(root, ".pi/extensions/.knowledge-worker-manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const actual = createHash("sha256")
	.update(await readFile(worker))
	.digest("hex");
if (manifest.outputSha256 !== actual) throw new Error(`knowledge worker hash mismatch: ${actual}`);
console.log(`plugin knowledge worker is up to date (${actual})`);
