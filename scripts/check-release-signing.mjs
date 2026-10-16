#!/usr/bin/env node

import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import process from "node:process";

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const value = (flag) => {
	const index = args.indexOf(flag);
	if (index < 0) return null;
	const next = args[index + 1];
	if (!next || next.startsWith("--")) throw new Error(`${flag} needs a value`);
	return next;
};

const platform = value("--platform") || (process.platform === "win32" ? "windows" : "mac");
if (!new Set(["mac", "windows"]).has(platform)) throw new Error(`Unsupported release platform: ${platform}`);

const required =
	platform === "mac"
		? ["CSC_LINK", "CSC_KEY_PASSWORD", "APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID"]
		: ["WIN_CSC_LINK", "WIN_CSC_KEY_PASSWORD"];

function missingEnvironment() {
	return required.filter((name) => !String(process.env[name] ?? "").trim());
}

async function checkReadableCertificate() {
	const link = platform === "windows" ? process.env.WIN_CSC_LINK : process.env.CSC_LINK;
	if (!link) return;
	// electron-builder accepts a local path, a data URL, or a remote URL. Only
	// local paths can be checked here; secrets are never printed.
	if (/^(data:|https?:\/\/)/i.test(link)) return;
	try {
		await access(link, constants.R_OK);
	} catch {
		throw new Error(`${platform} signing certificate path is not readable`);
	}
}

function run(command, argv) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, argv, { stdio: "inherit", windowsHide: true });
		child.once("error", reject);
		child.once("close", (code) => {
			if (code === 0) resolve();
			else reject(new Error(`${command} exited with ${code}`));
		});
	});
}

async function verifyMac(appPath) {
	if (!appPath) throw new Error("--app is required for macOS signature verification");
	await run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath]);
	await run("spctl", [
		"--assess",
		"--type",
		"execute",
		"--context",
		"context:primary-signature",
		"--verbose=4",
		appPath,
	]);
	await run("xcrun", ["stapler", "validate", appPath]);
}

async function verifyWindows(artifactPath) {
	if (!artifactPath) throw new Error("--artifact is required for Windows signature verification");
	const escaped = artifactPath.replaceAll("'", "''");
	const script = [
		`$signature = Get-AuthenticodeSignature -LiteralPath '${escaped}';`,
		"if ($signature.Status -ne 'Valid') {",
		'Write-Error "Authenticode status: $($signature.Status)";',
		"exit 1 }",
	].join(" ");
	await run("powershell", ["-NoProfile", "-NonInteractive", "-Command", script]);
}

if (has("--preflight")) {
	const missing = missingEnvironment();
	if (missing.length > 0) {
		console.error(`Signed ${platform} release preflight failed; missing environment: ${missing.join(", ")}`);
		process.exitCode = 1;
	} else {
		await checkReadableCertificate();
		console.log(`Signed ${platform} release preflight passed`);
	}
} else if (has("--verify")) {
	if (platform === "mac") await verifyMac(value("--app"));
	else await verifyWindows(value("--artifact"));
	console.log(`Signed ${platform} artifact verification passed`);
} else {
	console.error(
		"Usage: check-release-signing.mjs --preflight|--verify --platform mac|windows [--app path|--artifact path]",
	);
	process.exitCode = 2;
}
