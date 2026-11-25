import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const packageRoot = new URL("../", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("package.json", packageRoot), "utf8"));

const existingExports = {
	".": {
		types: "./dist/index.d.ts",
		import: "./dist/index.js",
		default: "./dist/index.js",
	},
	"./knowledge": {
		types: "./dist/knowledge.d.ts",
		import: "./dist/knowledge.js",
		default: "./dist/knowledge.js",
	},
	"./ui": {
		types: "./dist/ui.d.ts",
		import: "./dist/ui.js",
		default: "./dist/ui.js",
	},
	"./runtime": {
		types: "./dist/runtime.d.ts",
		import: "./dist/runtime.js",
		default: "./dist/runtime.js",
	},
	"./analysis-lifecycle": {
		types: "./dist/analysis-lifecycle.d.ts",
		import: "./dist/analysis-lifecycle.js",
		default: "./dist/analysis-lifecycle.js",
	},
	"./native": {
		types: "./dist/native.d.ts",
		import: "./dist/native.js",
		default: "./dist/native.js",
	},
	"./resource": {
		types: "./dist/resource.d.ts",
		import: "./dist/resource.js",
		default: "./dist/resource.js",
	},
	"./research": {
		types: "./dist/research.d.ts",
		import: "./dist/research.js",
		default: "./dist/research.js",
	},
	"./tasks": {
		types: "./dist/tasks.d.ts",
		import: "./dist/tasks.js",
		default: "./dist/tasks.js",
	},
	"./core": {
		types: "./dist/core.d.ts",
		import: "./dist/core.js",
		default: "./dist/core.js",
	},
	"./node/reservations": {
		types: "./dist/node/reservations.d.ts",
		import: "./dist/node/reservations.js",
		default: "./dist/node/reservations.js",
	},
	"./node/execution": {
		types: "./dist/node/execution.d.ts",
		import: "./dist/node/execution.js",
		default: "./dist/node/execution.js",
	},
	"./node/binary-state": {
		types: "./dist/node/binary-state.d.ts",
		import: "./dist/node/binary-state.js",
		default: "./dist/node/binary-state.js",
	},
};

const p5Exports = [
	["p5-receipts", ["Receipt", "validateP5Receipt"]],
	["p5-evidence", ["EvidenceCommit", "BundleInput"]],
	["p5-inquiry", ["Record"]],
	["p5-discovery", ["BatchInput", "KernelExportInput"]],
];

for (const [name, expectedValues] of p5Exports) {
	test(`${name} resolves through the public package export to the built values`, async () => {
		const publicModule = await import(`@gyoungwe/plugin-api/${name}`);
		const builtModule = await import(new URL(`dist/${name}.js`, packageRoot));
		for (const value of expectedValues) {
			assert.ok(Object.hasOwn(publicModule, value), `${name} exports ${value}`);
			assert.strictEqual(publicModule[value], builtModule[value]);
		}
		assert.deepEqual(manifest.exports[`./${name}`], {
			types: `./dist/${name}.d.ts`,
			import: `./dist/${name}.js`,
			default: `./dist/${name}.js`,
		});
	});

	test(`${name} imports only relative P5 schema siblings`, () => {
		const source = readFileSync(new URL(`dist/${name}.js`, packageRoot), "utf8");
		const imports = source.matchAll(
			/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)["']([^"']+)["']/gu,
		);
		for (const [, specifier] of imports) {
			assert.match(specifier, /^\.\/p5-[a-z-]+\.js$/u, `${name} imports ${specifier}`);
		}
	});
}

test("all pre-existing exports retain their exact targets and order", () => {
	for (const [subpath, conditions] of Object.entries(existingExports)) {
		assert.deepEqual(manifest.exports[subpath], conditions, subpath);
	}
	assert.deepEqual(
		Object.keys(manifest.exports).filter((subpath) => Object.hasOwn(existingExports, subpath)),
		Object.keys(existingExports),
	);
});

test("every published export target exists after build", () => {
	for (const [subpath, conditions] of Object.entries(manifest.exports)) {
		for (const condition of ["types", "import", "default"]) {
			const target = conditions[condition];
			assert.ok(existsSync(new URL(target, packageRoot)), `${subpath} ${condition}: ${target}`);
		}
	}
});

test("the 2.0.0 candidate has no runtime dependencies", () => {
	assert.equal(manifest.version, "2.0.0");
	assert.deepEqual(manifest.dependencies ?? {}, {});
});
