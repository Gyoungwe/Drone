#!/usr/bin/env node

/**
 * Offline market lifecycle acceptance.
 *
 * The host's PackageService receipt semantics are covered by
 * packages/backend/test/packages-lifecycle.test.ts. This script exercises the
 * package boundary with a real npm pack/install/update/uninstall cycle using a
 * local tarball, so it never contacts the npm registry and never touches a
 * user's ~/.pi or Drone state. Public Pi/Drone packages still require an
 * explicitly authorized registry or package-host run and are reported as
 * NOT_RUN here.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "drone-market-lifecycle-"));
const fixture = join(root, "fixture");
const prefix = join(root, "prefix");
const tarballs = join(root, "tarballs");
const packageName = "drone-market-lifecycle-fixture";
mkdirSync(join(fixture, "dist"), { recursive: true });
mkdirSync(prefix, { recursive: true });
mkdirSync(tarballs, { recursive: true });

function run(command, args, cwd) {
	execFileSync(command, args, {
		cwd,
		stdio: "ignore",
		env: {
			...process.env,
			npm_config_update_notifier: "false",
			npm_config_fund: "false",
			npm_config_audit: "false",
		},
	});
}

function packageJson(version) {
	return {
		name: packageName,
		version,
		description: "Offline Drone market lifecycle fixture",
		pi: { extensions: ["./dist/index.mjs"] },
		files: ["dist", "plugin.manifest.json"],
	};
}

function writeFixture(version) {
	writeFileSync(join(fixture, "package.json"), `${JSON.stringify(packageJson(version), null, 2)}\n`);
	writeFileSync(
		join(fixture, "plugin.manifest.json"),
		`${JSON.stringify({ schemaVersion: 1, version, entrypoints: { extension: "./dist/index.mjs" } }, null, 2)}\n`,
	);
	writeFileSync(
		join(fixture, "dist", "index.mjs"),
		`export default function fixture_${version.replaceAll(".", "_")}() {}\n`,
	);
	run("npm", ["pack", "--ignore-scripts", "--pack-destination", tarballs], fixture);
	const file = join(tarballs, `${packageName}-${version}.tgz`);
	const manifest = JSON.parse(readFileSync(join(fixture, "package.json"), "utf8"));
	if (manifest.version !== version) throw new Error(`fixture manifest version mismatch: ${version}`);
	return file;
}

try {
	writeFileSync(
		join(prefix, "package.json"),
		`${JSON.stringify({ name: "drone-market-prefix", private: true }, null, 2)}\n`,
	);
	const v1 = writeFixture("1.0.0");
	run("npm", ["install", "--ignore-scripts", "--save-exact", v1], prefix);
	const installedV1 = JSON.parse(
		readFileSync(join(prefix, "node_modules", packageName, "package.json"), "utf8"),
	);
	if (installedV1.version !== "1.0.0" || installedV1.pi?.extensions?.[0] !== "./dist/index.mjs") {
		throw new Error("local tarball install did not preserve Pi extension manifest");
	}

	const v2 = writeFixture("1.1.0");
	run("npm", ["install", "--ignore-scripts", "--save-exact", v2], prefix);
	const installedV2 = JSON.parse(
		readFileSync(join(prefix, "node_modules", packageName, "package.json"), "utf8"),
	);
	if (installedV2.version !== "1.1.0")
		throw new Error("local tarball update did not replace the installed version");

	run("npm", ["uninstall", "--ignore-scripts", packageName], prefix);
	let removed = false;
	try {
		readFileSync(join(prefix, "node_modules", packageName, "package.json"));
	} catch {
		removed = true;
	}
	if (!removed) throw new Error("local tarball uninstall left package files behind");

	console.log(
		JSON.stringify(
			{
				kind: "market-plugin-lifecycle-receipt",
				status: "PASS",
				source: "local-tarball",
				package: packageName,
				operations: ["install", "update", "uninstall"],
				versions: ["1.0.0", "1.1.0"],
				externalRegistry: {
					status: "NOT_RUN",
					reason:
						"Public Pi/Drone packages require an explicitly authorized registry or real packaged-host run.",
				},
			},
			null,
			2,
		),
	);
} finally {
	rmSync(root, { recursive: true, force: true });
}
