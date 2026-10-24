#!/usr/bin/env node
/** Real published extension under Drone's process sandbox; requires Node network permissions. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const outIndex = process.argv.indexOf("--out");
assert(
	outIndex > 0 && process.argv[outIndex + 1],
	"Usage: node scripts/check-scientific-sandbox.mjs --out <receipt.json>",
);
assert(
	execFileSync(process.execPath, ["--help"], { encoding: "utf8" }).includes("--allow-net"),
	"Node must support --allow-net; no fallback is permitted",
);
const out = resolve(process.argv[outIndex + 1]);
const temporary = realpathSync(mkdtempSync(join(tmpdir(), "drone-scientific-sandbox-")));
const prefix = join(temporary, "prefix");
const cwd = join(temporary, "project");
for (const name of ["home", "project", "prefix"]) mkdirSync(join(temporary, name));
const env = {
	PATH: process.env.PATH,
	HOME: join(temporary, "home"),
	npm_config_userconfig: "/dev/null",
	npm_config_registry: "https://registry.npmjs.org",
};
const npm = (args) => execFileSync("npm", args, { cwd, env, encoding: "utf8", timeout: 180_000 });
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const packageName = "@vaayne/pi-web-tools";
const version = "0.1.1";
const url =
	"https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=EXT_ID:24906146%20AND%20SRC:MED&format=json";

try {
	const metadata = JSON.parse(
		npm(["view", `${packageName}@${version}`, "name", "version", "license", "repository", "dist", "--json"]),
	);
	npm([
		"install",
		"--prefix",
		prefix,
		"--ignore-scripts",
		"--legacy-peer-deps",
		"--save-exact",
		"--no-audit",
		"--no-fund",
		`${packageName}@${version}`,
		"@sinclair/typebox@0.34.48",
	]);
	const packageDir = join(prefix, "node_modules", packageName);
	const lock = JSON.parse(readFileSync(join(prefix, "package-lock.json"), "utf8"));
	assert.equal(lock.packages[`node_modules/${packageName}`].integrity, metadata.dist.integrity);
	const license = readFileSync(join(packageDir, "LICENSE"), "utf8");
	assert.match(license, /MIT License/);
	const entrypoint = join(prefix, "extension.mjs");
	const hostEntrypoint = join(temporary, "host-sandbox.mjs");
	// The npm artifact contains TS only. Transpile without editing sources or bundling dependencies.
	await build({
		entryPoints: [join(packageDir, "index.ts")],
		outfile: entrypoint,
		platform: "node",
		format: "esm",
		bundle: true,
		packages: "external",
	});
	await build({
		entryPoints: [join(root, "packages/backend/src/plugin-sandbox.ts")],
		outfile: hostEntrypoint,
		platform: "node",
		format: "esm",
		packages: "external",
	});
	const { PluginSandboxSession } = await import(pathToFileURL(hostEntrypoint));
	const receipts = [];
	for (const phase of ["denied", "enabled", "restored"]) {
		const network = phase === "denied" ? [] : ["*"];
		const session = new PluginSandboxSession({
			pluginId: "scientific-web-tools",
			entrypoint,
			packageRoot: prefix,
			cwd,
			network,
			timeoutMs: 30_000,
		});
		try {
			const ready = await session.start();
			assert.notEqual(ready.pid, process.pid);
			assert.deepEqual(
				ready.tools.map((tool) => tool.name),
				["web-fetch", "web-search"],
			);
			const result = await session.invoke("web-fetch", `pubmed-${phase}`, { url, format: "json" });
			if (phase === "denied") {
				assert.equal(result.isError, true, "Network-disabled sandbox fetched a reachable public endpoint");
				receipts.push({
					phase,
					status: "PASS",
					separateProcess: true,
					network,
					toolError: true,
					diagnostic: result.content[0].text,
				});
			} else {
				assert.equal(result.isError, false, JSON.stringify(result.content));
				const response = JSON.parse(result.content[0].text);
				assert.equal(response.hitCount, 1);
				const paper = response.resultList.result[0];
				assert.equal(paper.id, "24906146");
				assert.match(paper.title, /CRISPR-Cas9/);
				receipts.push({
					phase,
					status: "PASS",
					separateProcess: true,
					network,
					uid: paper.id,
					title: paper.title,
					responseSha256: sha256(result.content[0].text),
				});
			}
		} finally {
			await session.close();
		}
		await assert.rejects(
			() => session.invoke("web-fetch", "closed-call", { url, format: "json" }),
			/closed/i,
		);
	}
	const evidence = {
		date: new Date().toISOString(),
		status: "PASS",
		scope:
			"Real published TypeScript extension transpiled unchanged, Drone process sandbox, explicitly authorized unrestricted network, Node 26 runtime only",
		reproduce:
			"node scripts/check-scientific-sandbox.mjs --out /tmp/scientific-sandbox.json (requires Node with --allow-net)",
		nodeVersion: process.version,
		hostSourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
		package: metadata,
		source: "https://github.com/vaayne/agent-kit",
		licenseSha256: sha256(license),
		sourceSha256: sha256(readFileSync(join(packageDir, "index.ts"))),
		transpiledSha256: sha256(readFileSync(entrypoint)),
		hostSandboxSha256: sha256(readFileSync(join(root, "packages/backend/src/plugin-sandbox.ts"))),
		transpilation: {
			compiler: "esbuild",
			version: JSON.parse(readFileSync(join(root, "node_modules/esbuild/package.json"), "utf8")).version,
			sourceModified: false,
		},
		publicEndpoint: url,
		tools: ["web-fetch", "web-search"],
		testedTool: "web-fetch",
		networkPolicy: "[] denies; ['*'] explicitly allows all network; no domain restriction claimed",
		receipts,
		isolation: {
			temporaryHome: true,
			temporaryProject: true,
			temporaryInstall: true,
			inheritedCredentials: false,
			installScripts: false,
			productionStateChanged: false,
			remoteMutations: 0,
		},
		formalPackage: {
			status: "BLOCKED",
			reason:
				"Current Electron Node 24 runtime does not support network permissions; this is a Node 26 sandbox acceptance, not a formal packaged-host PASS",
		},
		remaining: [
			"Formal packaged runtime with supported permission model",
			"Native TypeScript npm entry loading in sandbox",
			"GUI installation and diagnostics",
			"web-search provider contract and live results",
		],
	};
	mkdirSync(dirname(out), { recursive: true });
	writeFileSync(out, `${JSON.stringify(evidence, null, 2)}\n`);
	console.log(JSON.stringify({ status: "PASS", nodeVersion: process.version, phases: receipts.length, out }));
} finally {
	rmSync(temporary, { recursive: true, force: true });
}
