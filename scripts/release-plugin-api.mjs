#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const root = fileURLToPath(new URL("../", import.meta.url));
const packageName = "@gyoungwe/plugin-api";
const checksumFile = "SHA256SUMS";

function validateVersion(expectedVersion) {
	assert(
		/^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){2}$/u.test(expectedVersion),
		"--expected-version must be a stable version (X.Y.Z)",
	);
	const manifest = JSON.parse(readFileSync(join(root, "packages/plugin-api/package.json"), "utf8"));
	assert.equal(manifest.name, packageName, "unexpected plugin-api package name");
	assert.equal(
		manifest.version,
		expectedVersion,
		`expected version ${expectedVersion}, package version ${manifest.version}`,
	);
	return manifest;
}

function sha256(path) {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function checksumRecord(digest, asset) {
	return `${digest}  ${asset}\n`;
}

function verifyRelease(directory, asset) {
	const entries = readdirSync(directory, { withFileTypes: true });
	assert(
		entries.length === 2 &&
			entries.every((entry) => entry.isFile() && [asset, checksumFile].includes(entry.name)),
		`expected exactly ${asset} and ${checksumFile} in ${directory}`,
	);
	const digest = sha256(join(directory, asset));
	assert(
		readFileSync(join(directory, checksumFile), "utf8") === checksumRecord(digest, asset),
		`${checksumFile} does not match ${asset}`,
	);
	return digest;
}

function packWorkspace(directory, manifest, asset) {
	const result = JSON.parse(
		execFileSync(
			"npm",
			["pack", "--json", "--ignore-scripts", "--offline", "-w", packageName, "--pack-destination", directory],
			{ cwd: root, encoding: "utf8" },
		),
	);
	assert(Array.isArray(result) && result.length === 1, "npm pack must produce exactly one archive");
	const [pack] = result;
	assert.deepEqual([pack.name, pack.version, pack.filename], [packageName, manifest.version, asset]);
	const paths = new Set(pack.files.map(({ path }) => path));
	for (const conditions of Object.values(manifest.exports)) {
		for (const target of Object.values(conditions)) {
			assert(paths.has(target.slice(2)), `missing packed export ${target}`);
		}
	}
}

function packRelease(directory, manifest, asset) {
	mkdirSync(directory);
	try {
		packWorkspace(directory, manifest, asset);
		const digest = sha256(join(directory, asset));
		writeFileSync(join(directory, checksumFile), checksumRecord(digest, asset), { flag: "wx" });
		return verifyRelease(directory, asset);
	} catch (error) {
		rmSync(directory, { recursive: true, force: true });
		throw error;
	}
}

const { values } = parseArgs({
	options: {
		"expected-version": { type: "string" },
		"out-dir": { type: "string" },
		"pack-dir": { type: "string" },
		check: { type: "boolean" },
	},
});
const { check, "out-dir": outDir, "pack-dir": packDir } = values;
const manifest = validateVersion(values["expected-version"]);
const asset = `gyoungwe-plugin-api-${manifest.version}.tgz`;
if (check) {
	assert(packDir && outDir === undefined, "--check requires --pack-dir and no --out-dir");
	console.log(verifyRelease(resolve(packDir), asset));
} else {
	assert(packDir === undefined, "--pack-dir requires --check");
	assert(outDir !== "", "--out-dir must be a nonempty path");
	console.log(outDir ? packRelease(resolve(outDir), manifest, asset) : manifest.version);
}
