#!/usr/bin/env node
/**
 * Validate the files a release user actually downloads.
 *
 * This is intentionally separate from check-local-desktop-artifact.mjs: the
 * latter checks the Electron build tree, while this script opens the DMG/ZIP
 * or tests the Windows installer payload. It is used both before upload and
 * after downloading assets back from the GitHub draft release.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const args = process.argv.slice(2);

function arg(name) {
	const index = args.indexOf(name);
	return index === -1 ? undefined : args[index + 1];
}

function usage() {
	console.error(
		"Usage: node scripts/check-release-artifacts.mjs --dir <assets> --platform <mac|windows> [--arch arm64|x64|both] [--version 0.33.3] [--report <path>]",
	);
}

const assetRoot = resolve(arg("--dir") ?? "");
const platform = arg("--platform");
const arch = arg("--arch");
const expectedVersion = arg("--version");
const reportPath = arg("--report");
const expectedReportPath = arg("--expected-report");

if (
	!assetRoot ||
	!platform ||
	!["mac", "windows"].includes(platform) ||
	(arch && !["arm64", "x64", "both"].includes(arch))
) {
	usage();
	process.exitCode = 2;
}

const report = {
	schema: 1,
	kind: "drone-release-artifact-acceptance",
	mode: "installer-package",
	platform,
	arch: arch ?? null,
	expectedVersion: expectedVersion ?? null,
	assetRoot,
	checks: [],
	startedAt: new Date().toISOString(),
};

function addCheck(id, status, detail, evidence = {}) {
	const normalized = status === "PASS" || status === "NOT_RUN" ? status : "FAIL";
	const entry = { id, status: normalized, detail, ...evidence };
	report.checks.push(entry);
	if (normalized === "FAIL") throw new Error(`${id}: ${detail}`);
}

async function exists(path) {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

async function filesInRoot() {
	assert(await exists(assetRoot), `asset directory does not exist: ${assetRoot}`);
	return (await readdir(assetRoot, { withFileTypes: true }))
		.filter((entry) => entry.isFile())
		.map((entry) => entry.name)
		.sort();
}

async function sha256(path) {
	const hash = createHash("sha256");
	for await (const chunk of createReadStream(path)) hash.update(chunk);
	return hash.digest("hex");
}

async function buildAssetManifest(files) {
	return Promise.all(
		files.map(async (name) => {
			const path = join(assetRoot, name);
			return { name, bytes: (await stat(path)).size, sha256: await sha256(path) };
		}),
	);
}

async function compareExpectedManifest() {
	if (!expectedReportPath) return;
	const expected = JSON.parse(await readFile(resolve(expectedReportPath), "utf8"));
	const expectedByName = new Map((expected.assetManifest ?? []).map((entry) => [entry.name, entry]));
	const actualNames = new Set(report.assetManifest.map((entry) => entry.name));
	for (const actual of report.assetManifest) {
		const wanted = expectedByName.get(actual.name);
		if (!wanted)
			addCheck("uploaded-byte-integrity", "FAIL", `asset was not present in build manifest: ${actual.name}`);
		if (wanted.bytes !== actual.bytes || wanted.sha256 !== actual.sha256)
			addCheck("uploaded-byte-integrity", "FAIL", `remote asset differs from build asset: ${actual.name}`, {
				actual,
				expected: wanted,
			});
	}
	for (const wanted of expected.assetManifest ?? []) {
		if (!actualNames.has(wanted.name))
			addCheck(
				"uploaded-byte-integrity",
				"FAIL",
				`build asset was not downloaded from release: ${wanted.name}`,
			);
	}
	addCheck("uploaded-byte-integrity", "PASS", "downloaded release assets match the build manifest", {
		assets: report.assetManifest.map((entry) => entry.name),
	});
}

function requireAsset(files, name) {
	if (!files.includes(name)) addCheck("required-asset", "FAIL", `missing ${name}`, { name });
	return join(assetRoot, name);
}

async function run(command, commandArgs, options = {}) {
	try {
		return await execFileAsync(command, commandArgs, {
			maxBuffer: 32 * 1024 * 1024,
			...options,
		});
	} catch (error) {
		const detail = [error.message, error.stdout, error.stderr].filter(Boolean).join("\n");
		throw new Error(`${command} ${commandArgs.join(" ")} failed:\n${detail}`);
	}
}

async function findFile(root, fileName) {
	if (!(await exists(root))) return undefined;
	for (const entry of await readdir(root, { withFileTypes: true })) {
		const path = join(root, entry.name);
		if (entry.name === fileName) return path;
		if (entry.isDirectory()) {
			const nested = await findFile(path, fileName);
			if (nested) return nested;
		}
	}
	return undefined;
}

async function checkMacApp(appPath, source) {
	const asarPath = join(appPath, "Contents", "Resources", "app.asar");
	const infoPath = join(appPath, "Contents", "Info.plist");
	if (!(await exists(asarPath))) addCheck("mac-app-payload", "FAIL", `missing app.asar in ${source}`);
	if (!(await exists(infoPath))) addCheck("mac-app-metadata", "FAIL", `missing Info.plist in ${source}`);
	if (expectedVersion) {
		const { stdout } = await run("/usr/bin/plutil", [
			"-extract",
			"CFBundleShortVersionString",
			"raw",
			infoPath,
		]);
		const version = stdout.trim();
		if (version !== expectedVersion)
			addCheck("mac-app-version", "FAIL", `expected ${expectedVersion}, found ${version}`, { source });
		else addCheck("mac-app-version", "PASS", `CFBundleShortVersionString=${version}`, { source });
	}
	addCheck("mac-app-payload", "PASS", "Drone.app contains Contents/Resources/app.asar", {
		source,
		path: asarPath,
		bytes: (await stat(asarPath)).size,
	});
}

async function extractMacZip(zipPath, workingRoot) {
	const extracted = join(workingRoot, `${basename(zipPath)}-extracted`);
	await run("/usr/bin/ditto", ["-x", "-k", zipPath, extracted]);
	const appPath = await findFile(extracted, "Drone.app");
	if (!appPath)
		addCheck("mac-zip-payload", "FAIL", `Drone.app missing after extracting ${basename(zipPath)}`);
	await checkMacApp(appPath, `zip:${basename(zipPath)}`);
	addCheck("mac-zip", "PASS", "ZIP extracted with ditto and app payload inspected", {
		asset: basename(zipPath),
	});
}

async function mountMacDmg(dmgPath, _workingRoot) {
	const { stdout } = await run("/usr/bin/hdiutil", ["attach", "-readonly", "-nobrowse", dmgPath]);
	const mount = stdout
		.split(/\r?\n/)
		.map((line) => line.match(/(\/Volumes\/.+?)\s*$/u)?.[1])
		.find(Boolean);
	if (!mount) throw new Error(`hdiutil did not return a mount point for ${basename(dmgPath)}`);
	try {
		const appPath = join(mount, "Drone.app");
		if (!(await exists(appPath)))
			addCheck("mac-dmg-payload", "FAIL", `Drone.app missing from ${basename(dmgPath)}`);
		await checkMacApp(appPath, `dmg:${basename(dmgPath)}`);
		addCheck("mac-dmg", "PASS", "DMG attached read-only and app payload inspected", {
			asset: basename(dmgPath),
			mount,
		});
	} finally {
		await run("/usr/bin/hdiutil", ["detach", mount, "-quiet"]);
	}
}

async function checkWindowsPayload(appPath, source) {
	const exe = await findFile(appPath, "Drone.exe");
	const asar = await findFile(appPath, "app.asar");
	if (!exe) addCheck("windows-app-payload", "FAIL", `Drone.exe missing in ${source}`);
	if (!asar) addCheck("windows-app-payload", "FAIL", `app.asar missing in ${source}`);
	addCheck("windows-app-payload", "PASS", "Windows payload contains Drone.exe and app.asar", {
		source,
		exe,
		asar,
	});
}

async function extractWindowsZip(zipPath, workingRoot) {
	const extracted = join(workingRoot, `${basename(zipPath)}-extracted`);
	const ps =
		"$ErrorActionPreference='Stop'; Expand-Archive -LiteralPath $args[0] -DestinationPath $args[1] -Force";
	await run("powershell.exe", [
		"-NoProfile",
		"-NonInteractive",
		"-ExecutionPolicy",
		"Bypass",
		"-Command",
		ps,
		zipPath,
		extracted,
	]);
	await checkWindowsPayload(extracted, `zip:${basename(zipPath)}`);
	addCheck("windows-zip", "PASS", "ZIP extracted with Expand-Archive and app payload inspected", {
		asset: basename(zipPath),
	});
}

async function checkWindowsInstaller(exePath, workingRoot) {
	const target = join(workingRoot, "installed");
	const ps = [
		"$ErrorActionPreference='Stop';",
		"$exe=$args[0]; $target=$args[1];",
		"$p=Start-Process -FilePath $exe -ArgumentList @('/S', ('/D=' + $target)) -Wait -PassThru;",
		"if ($p.ExitCode -ne 0) { throw ('installer exit code ' + $p.ExitCode) }",
	].join(" ");
	await run("powershell.exe", [
		"-NoProfile",
		"-NonInteractive",
		"-ExecutionPolicy",
		"Bypass",
		"-Command",
		ps,
		exePath,
		target,
	]);
	await checkWindowsPayload(target, `installer:${basename(exePath)}`);
	addCheck("windows-installer", "PASS", "NSIS installer ran silently and installed a runnable payload", {
		asset: basename(exePath),
	});
}

async function main() {
	const files = await filesInRoot();
	report.assets = files;
	report.assetManifest = await buildAssetManifest(files);
	await compareExpectedManifest();
	const workingRoot = await mkdtemp(join(tmpdir(), "drone-release-acceptance-"));
	try {
		if (platform === "mac") {
			const selectedArch =
				arch === "both"
					? ["arm64", "x64"]
					: [
							arch ??
								files
									.find((name) => /^drone-mac-(arm64|x64)\.zip$/u.test(name))
									?.match(/^drone-mac-(arm64|x64)\./u)?.[1],
						];
			if (selectedArch.some((item) => !item))
				addCheck("mac-arch", "FAIL", "cannot determine macOS architecture");
			for (const item of selectedArch) {
				const zip = requireAsset(files, `drone-mac-${item}.zip`);
				const dmg = requireAsset(files, `drone-mac-${item}.dmg`);
				await extractMacZip(zip, workingRoot);
				await mountMacDmg(dmg, workingRoot);
			}
		} else {
			const zip = requireAsset(files, "drone-windows-x64.zip");
			const exe = requireAsset(files, "drone-windows-x64.exe");
			await extractWindowsZip(zip, workingRoot);
			await checkWindowsInstaller(exe, workingRoot);
		}
		report.finishedAt = new Date().toISOString();
		report.status = "PASS";
	} finally {
		await rm(workingRoot, { recursive: true, force: true });
	}
}

try {
	if (process.exitCode !== 2) await main();
} catch (error) {
	report.finishedAt = new Date().toISOString();
	report.status = "FAIL";
	report.error = error instanceof Error ? error.message : String(error);
	if (report.checks.every((check) => check.status !== "FAIL"))
		report.checks.push({ id: "command", status: "FAIL", detail: report.error });
	process.exitCode = 1;
} finally {
	if (reportPath) {
		await mkdir(resolve(reportPath, ".."), { recursive: true });
		await writeFile(resolve(reportPath), `${JSON.stringify(report, null, 2)}\n`, "utf8");
	}
	console.log(JSON.stringify(report, null, 2));
}
