import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const checker = resolve(packageRoot, "../../scripts/check-plugin-api.mjs");

test("package gate permits only the opt-in native SDK type declaration", () => {
	const fixture = mkdtempSync(join(tmpdir(), "drone-api-boundary-"));
	try {
		mkdirSync(join(fixture, "scripts"));
		cpSync(checker, join(fixture, "scripts/check-plugin-api.mjs"));
		const target = join(fixture, "packages/plugin-api");
		mkdirSync(target, { recursive: true });
		for (const name of ["package.json", "src", "dist"]) {
			cpSync(join(packageRoot, name), join(target, name), { recursive: true });
		}
		const check = () =>
			execFileSync(process.execPath, [join(fixture, "scripts/check-plugin-api.mjs"), "--package-only"], {
				stdio: "pipe",
			});
		assert.match(check().toString(), /package gate passed/u);
		for (const [name, dependency] of [
			["native.js", 'import { ExtensionFactory } from "@earendil-works/pi-coding-agent";'],
			["runtime.d.ts", 'import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";'],
			["ui.d.ts", 'import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";'],
			["native.d.ts", 'import { ExtensionFactory } from "@earendil-works/pi-coding-agent";'],
			["native.d.ts", 'import type { Model } from "@earendil-works/pi-ai";'],
		]) {
			const path = join(target, "dist", name);
			const original = readFileSync(path, "utf8");
			writeFileSync(path, `${original}\n${dependency}\n`);
			assert.throws(check, { message: /forbidden dependency/u });
			writeFileSync(path, original);
		}
	} finally {
		rmSync(fixture, { recursive: true, force: true });
	}
});
