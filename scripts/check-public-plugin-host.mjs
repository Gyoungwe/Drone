#!/usr/bin/env node
/**
 * Install the published plugin tarballs into a throwaway prefix and prove that
 * the host can consume them. This is intentionally separate from the offline
 * workspace checks: it must exercise registry artifacts and never writes user
 * Pi state or invokes a model.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = resolve(import.meta.dirname, "..");
const HOST_FAMILY = [
	"chord",
	"pi-agent-core",
	"pi-ai",
	"pi-codemode",
	"pi-coding-agent",
	"pi-mcp",
	"pi-telemetry",
	"pi-tui",
].map((name) => `@earendil-works/${name}@1.1.0`);
const packages = [
	{
		name: "@gyoungwe/pi-evidence",
		spec: "https://registry.npmjs.org/@gyoungwe/pi-evidence/-/pi-evidence-0.1.1.tgz",
		tools: ["evidence_validate_manifest", "evidence_validate_capsule", "evidence_verify_replay"],
	},
	{
		name: "@gyoungwe/pi-connectors",
		spec: "https://registry.npmjs.org/@gyoungwe/pi-connectors/-/pi-connectors-0.1.1.tgz",
		tools: ["connector_list", "connector_get"],
	},
	{
		name: "@gyoungwe/desktop-ui-pack",
		spec: "https://registry.npmjs.org/@gyoungwe/desktop-ui-pack/-/desktop-ui-pack-0.1.1.tgz",
	},
];

function run(command, args, options = {}) {
	return execFileSync(command, args, {
		cwd: ROOT,
		encoding: "utf8",
		maxBuffer: 32 * 1024 * 1024,
		stdio: ["ignore", "pipe", "pipe"],
		...options,
	});
}

const temp = mkdtempSync(join(tmpdir(), "drone-public-plugin-host-"));
const prefix = join(temp, "prefix");
const lifecyclePrefix = join(temp, "lifecycle-prefix");
try {
	const specs = [...HOST_FAMILY, ...packages.map((item) => item.spec)];
	run("npm", [
		"install",
		"--prefix",
		prefix,
		"--registry",
		"https://registry.npmjs.org",
		"--ignore-scripts",
		"--omit=peer",
		"--no-audit",
		"--no-fund",
		...specs,
	]);

	const pi = await import(
		pathToFileURL(join(prefix, "node_modules/@earendil-works/pi-coding-agent/dist/index.js")).href
	);
	const loaded = [];
	for (const item of packages.filter((entry) => entry.tools)) {
		const packageDir = join(prefix, "node_modules", ...item.name.split("/"));
		const packageJson = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
		const extensionPath = join(packageDir, packageJson.pi.extensions[0]);
		assert(existsSync(extensionPath), `${item.name} extension missing`);
		const loader = new pi.DefaultResourceLoader({
			cwd: prefix,
			agentDir: join(prefix, "agent"),
			settingsManager: pi.SettingsManager.inMemory(),
			noExtensions: true,
			noSkills: true,
			additionalExtensionPaths: [extensionPath],
		});
		await loader.reload();
		const result = loader.getExtensions();
		assert.deepEqual(result.errors, [], JSON.stringify(result.errors));
		const extension = result.extensions.find((entry) => entry.path === extensionPath);
		assert(extension, `${item.name} was not discovered by the Pi loader`);
		assert.deepEqual([...extension.tools.keys()], item.tools);
		loaded.push({ package: item.name, tools: item.tools, loader: true });
	}

	const uiDir = join(prefix, "node_modules/@gyoungwe/desktop-ui-pack");
	assert(existsSync(join(uiDir, "ui/plugin.json")), "desktop UI manifest missing from installed package");
	const connectorDir = join(prefix, "node_modules/@gyoungwe/pi-connectors");
	run(
		join(ROOT, "node_modules/.bin/vitest"),
		["run", "packages/backend/test/plugin-sandbox-public.test.ts"],
		{
			env: { ...process.env, DRONE_PUBLIC_PLUGIN_PACKAGE_DIR: connectorDir },
			stdio: "inherit",
		},
	);
	loaded.push({ package: "@gyoungwe/pi-connectors", processSandbox: true });

	// Exercise the real registry artifact lifecycle in a separate clean prefix.
	// This is intentionally read-only with respect to the registry: npm only
	// downloads published tarballs and all state is discarded with `temp`.
	run("npm", [
		"install",
		"--prefix",
		lifecyclePrefix,
		"--registry",
		"https://registry.npmjs.org",
		"--ignore-scripts",
		"--save-exact",
		"--omit=peer",
		"--no-audit",
		"--no-fund",
		"@gyoungwe/pi-connectors@0.1.0",
	]);
	const lifecyclePackagePath = join(lifecyclePrefix, "node_modules/@gyoungwe/pi-connectors/package.json");
	const lifecycleV1 = JSON.parse(readFileSync(lifecyclePackagePath, "utf8"));
	assert.equal(lifecycleV1.version, "0.1.0");
	run("npm", [
		"install",
		"--prefix",
		lifecyclePrefix,
		"--registry",
		"https://registry.npmjs.org",
		"--ignore-scripts",
		"--save-exact",
		"--omit=peer",
		"--no-audit",
		"--no-fund",
		"@gyoungwe/pi-connectors@0.1.1",
	]);
	const lifecycleV2 = JSON.parse(readFileSync(lifecyclePackagePath, "utf8"));
	assert.equal(lifecycleV2.version, "0.1.1");
	run("npm", [
		"uninstall",
		"--prefix",
		lifecyclePrefix,
		"--ignore-scripts",
		"--no-audit",
		"--no-fund",
		"@gyoungwe/pi-connectors",
	]);
	assert(!existsSync(lifecyclePackagePath), "registry package remained after uninstall");
	loaded.push({
		package: "@gyoungwe/pi-connectors",
		registryLifecycle: ["0.1.0", "0.1.1", "uninstall"],
	});
	const env = { ...process.env, DRONE_PUBLIC_UI_PACKAGE_DIR: uiDir };
	run(
		join(ROOT, "node_modules/.bin/vitest"),
		["run", "packages/desktop/src/main/ui-plugins/installed-ui-pack.test.ts"],
		{ env, stdio: "inherit" },
	);
	loaded.push({ package: "@gyoungwe/desktop-ui-pack", uiLifecycle: true });

	console.log(
		JSON.stringify(
			{
				status: "PASS",
				registryPackages: loaded,
				cleanPrefix: true,
				thirdPartyBoundary: {
					status: "BLOCKED",
					reason:
						"The registry artifact is a Drone-maintained public package; a separately owned third-party source still requires an explicitly approved package and licence scope.",
				},
			},
			null,
			2,
		),
	);
} finally {
	rmSync(temp, { recursive: true, force: true });
}
