#!/usr/bin/env node
/** Fresh macOS package smoke with an isolated HOME/profile and no inherited credentials. */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { closeSync, openSync } from "node:fs";
import { access, mkdir, mkdtemp, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

if (process.argv.includes("--help")) {
	console.log(
		"node scripts/check-packaged-desktop.mjs /absolute/path/Drone.app [--lifecycle-package=@scope/name|--lifecycle-fixture]\nLaunches only the specified package with isolated HOME/userData/agentDir/knowledgeDir. Leaves screenshots and a JSON validation receipt in a temporary folder. No real credentials, Vaults or model requests are used. With --lifecycle-package, installs, updates and removes that explicitly selected public fixture. With --lifecycle-fixture, a temporary local registry serves 1.0.0/1.1.0 so the packaged host exercises install→upgrade→rollback→remove without touching public npm.",
	);
	process.exit(0);
}
if (process.platform !== "darwin") throw new Error("This package smoke currently validates macOS only");
if (!process.argv[2]) throw new Error("A built Drone.app path is required");
const bundle = await realpath(resolve(process.argv[2]));
const executable = join(bundle, "Contents/MacOS/Drone");
await access(executable);
const lifecyclePackageArg = process.argv.find((value) => value.startsWith("--lifecycle-package="));
const lifecycleFixture = process.argv.includes("--lifecycle-fixture");
if (lifecycleFixture && lifecyclePackageArg)
	throw new Error("Choose --lifecycle-package or --lifecycle-fixture, not both");
const lifecyclePackage = lifecycleFixture
	? "drone-packaged-lifecycle-fixture"
	: lifecyclePackageArg?.slice("--lifecycle-package=".length) || undefined;
if (lifecyclePackage && !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/iu.test(lifecyclePackage))
	throw new Error(`Invalid lifecycle package name: ${lifecyclePackage}`);
const root = await realpath(await mkdtemp(join(tmpdir(), "drone-fresh-package-")));
const home = join(root, "home"),
	profile = join(root, "profile"),
	agent = join(root, "agent"),
	knowledge = join(root, "knowledge"),
	cwd = join(root, "project");
for (const path of [home, profile, agent, knowledge, cwd, join(root, "tmp")])
	await mkdir(path, { recursive: true });
let registryServer;
let registryUrl;
let fixtureLatest = "1.0.0";
let fixtureHasUpgraded = false;
const fixtureTarballs = new Map();
if (lifecycleFixture) {
	for (const version of ["1.0.0", "1.1.0"]) {
		const fixtureDir = join(root, `fixture-${version}`);
		const destination = join(root, "tarballs");
		await mkdir(join(fixtureDir, "dist"), { recursive: true });
		await mkdir(destination, { recursive: true });
		await writeFile(
			join(fixtureDir, "package.json"),
			`${JSON.stringify(
				{
					name: lifecyclePackage,
					version,
					private: false,
					files: ["dist", "plugin.manifest.json"],
					pi: { extensions: ["./dist/index.mjs"] },
				},
				null,
			)}\n`,
		);
		await writeFile(
			join(fixtureDir, "plugin.manifest.json"),
			`${JSON.stringify({ schemaVersion: 1, version, entrypoints: { extension: "./dist/index.mjs" } }, null, 2)}\n`,
		);
		await writeFile(
			join(fixtureDir, "dist/index.mjs"),
			`export const fixtureVersion = ${JSON.stringify(version)};\n`,
		);
		execFileSync("npm", ["pack", "--ignore-scripts", "--pack-destination", destination], {
			cwd: fixtureDir,
			stdio: "ignore",
			env: {
				...process.env,
				npm_config_audit: "false",
				npm_config_fund: "false",
				npm_config_update_notifier: "false",
			},
		});
		fixtureTarballs.set(version, await readFile(join(destination, `${lifecyclePackage}-${version}.tgz`)));
	}
	registryServer = createHttpServer((request, response) => {
		if (request.url === `/${lifecyclePackage}`) {
			const availableVersions =
				fixtureLatest === "1.0.0" && !fixtureHasUpgraded ? ["1.0.0"] : ["1.0.0", "1.1.0"];
			const versions = Object.fromEntries(
				availableVersions.map((version) => [
					version,
					{
						name: lifecyclePackage,
						version,
						dist: {
							tarball: `http://127.0.0.1:${registryServer.address().port}/${lifecyclePackage}/-/${lifecyclePackage}-${version}.tgz`,
						},
					},
				]),
			);
			response.setHeader("content-type", "application/json");
			response.end(
				JSON.stringify({ name: lifecyclePackage, versions, "dist-tags": { latest: fixtureLatest } }),
			);
			return;
		}
		const match = request.url?.match(
			new RegExp(`^/${lifecyclePackage}/-/${lifecyclePackage}-(1\\.0\\.0|1\\.1\\.0)\\.tgz$`),
		);
		if (!match) {
			response.statusCode = 404;
			response.end("not found");
			return;
		}
		response.setHeader("content-type", "application/octet-stream");
		response.end(fixtureTarballs.get(match[1]));
	});
	registryServer.listen(0, "127.0.0.1");
	await once(registryServer, "listening");
	registryUrl = `http://127.0.0.1:${registryServer.address().port}/`;
}
const server = createNetServer();
server.listen(0, "127.0.0.1");
await once(server, "listening");
const port = server.address().port;
await new Promise((done) => server.close(done));
const logFd = openSync(join(root, "launch.log"), "w", 0o600);
const child = spawn(
	executable,
	[`--user-data-dir=${profile}`, "--remote-debugging-address=127.0.0.1", `--remote-debugging-port=${port}`],
	{
		cwd,
		stdio: ["ignore", logFd, logFd],
		env: {
			PATH: process.env.PATH || "/usr/bin:/bin",
			HOME: home,
			USER: "drone-fixture",
			LOGNAME: "drone-fixture",
			LANG: "en_US.UTF-8",
			TMPDIR: join(root, "tmp"),
			XDG_CONFIG_HOME: join(home, ".config"),
			XDG_CACHE_HOME: join(home, ".cache"),
			NPM_CONFIG_CACHE: join(root, "npm-cache"),
			npm_config_cache: join(root, "npm-cache"),
			PI_CODING_AGENT_DIR: agent,
			DRONE_KNOWLEDGE_DIR: knowledge,
			...(registryUrl ? { NPM_CONFIG_REGISTRY: registryUrl, npm_config_registry: registryUrl } : {}),
		},
	},
);
const report = {
	schema: 1,
	passed: false,
	bundle,
	root,
	checks: [],
	liveModel: false,
	// This smoke intentionally starts with no optional package source.  Keep the
	// lifecycle acceptance state explicit so a zero-plugin PASS cannot be read as
	// proof of install/disable/upgrade/rollback behavior.
	lifecycleAcceptance: {
		status: "NOT_RUN",
		operations: ["install", "upgrade", "disable", "restore", "rollback", "destroy-failure"],
		reason:
			"A packaged lifecycle run needs an explicitly selected package source and authorized upgrade/rollback fixture; this zero-plugin smoke does not mutate package state.",
	},
	startedAt: new Date().toISOString(),
};
let socket;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
try {
	let target;
	for (let i = 0; i < 160; i++) {
		if (child.exitCode !== null) throw new Error(`Packaged process exited ${child.exitCode}`);
		try {
			const list = await (
				await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(500) })
			).json();
			target = list.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
			if (target) break;
		} catch {}
		await delay(200);
	}
	assert(target, "Packaged renderer did not expose the test-only loopback debugger");
	socket = new WebSocket(target.webSocketDebuggerUrl);
	await once(socket, "open");
	let nextId = 0;
	const pending = new Map();
	socket.addEventListener("message", (event) => {
		const message = JSON.parse(event.data);
		const request = pending.get(message.id);
		if (!request) return;
		pending.delete(message.id);
		clearTimeout(request.timer);
		if (message.error) request.reject(new Error(message.error.message));
		else request.resolve(message.result);
	});
	const call = (method, params = {}) =>
		new Promise((resolve, reject) => {
			const id = ++nextId;
			const timer = setTimeout(() => {
				pending.delete(id);
				reject(new Error(`${method} timed out`));
			}, 30_000);
			pending.set(id, { resolve, reject, timer });
			socket.send(JSON.stringify({ id, method, params }));
		});
	const evaluate = async (expression) => {
		const result = await call("Runtime.evaluate", {
			expression,
			awaitPromise: true,
			returnByValue: true,
			userGesture: true,
		});
		if (result.exceptionDetails)
			throw new Error(result.exceptionDetails.text || "Renderer evaluation failed");
		return result.result.value;
	};
	let ready = false;
	for (let i = 0; i < 100; i++) {
		ready = await evaluate(
			"Boolean(window.pi && !document.getElementById('splash') && document.querySelector('[data-testid=workbench-nav]')?.getBoundingClientRect().width > 0)",
		);
		if (ready) break;
		await delay(100);
	}
	assert(ready, "Fresh workbench failed to become visible after splash");
	report.checks.push("actual packaged workbench visible after splash and CJS preload mounted");
	const managedUiRoot = join(profile, "ui-plugins");
	const builtInUiFiles = new Set([".builtin-seed.json", "SPEC.md", "drone-ui.d.ts", "_examples"]);
	const optionalUiEntries = (
		await readdir(managedUiRoot).catch((error) => {
			if (error.code === "ENOENT") return [];
			throw error;
		})
	).filter((entry) => !builtInUiFiles.has(entry));
	assert.deepEqual(
		optionalUiEntries,
		[],
		`fresh profile contains optional UI plugins: ${optionalUiEntries.join(", ")}`,
	);
	report.checks.push("fresh packaged profile contains no optional UI plugins (only host seed files)");
	const managedPackageRoot = join(agent, "npm", "node_modules");
	const managedPackageEntries = (
		await readdir(managedPackageRoot).catch((error) => {
			if (error.code === "ENOENT") return [];
			throw error;
		})
	).filter((entry) => entry !== ".package-lock.json");
	assert.deepEqual(
		managedPackageEntries,
		[],
		`fresh Pi managed npm root contains optional packages: ${managedPackageEntries.join(", ")}`,
	);
	report.checks.push("fresh Pi managed npm root contains no optional packages");
	if (lifecyclePackage) {
		const packagePath = join(managedPackageRoot, ...lifecyclePackage.split("/"));
		const source = `npm:${lifecyclePackage}`;
		const lifecycle = {
			package: lifecyclePackage,
			operations: lifecycleFixture
				? ["install", "upgrade", "rollback", "remove"]
				: ["install", "update", "remove"],
		};
		let lifecycleStage = "install";
		const installedVersion = async () =>
			JSON.parse(await readFile(join(packagePath, "package.json"), "utf8")).version;
		try {
			if (lifecycleFixture) fixtureLatest = "1.0.0";
			const installed = await evaluate(`window.pi.installPackage(${JSON.stringify(lifecyclePackage)})`);
			assert(installed?.status === "succeeded", `package install failed: ${JSON.stringify(installed)}`);
			assert(
				await access(packagePath).then(
					() => true,
					() => false,
				),
				"installed package directory is missing",
			);
			const configured = await evaluate("window.pi.listConfiguredPackages()");
			assert(configured.some((entry) => entry.source === source && entry.scope === "user"));
			if (lifecycleFixture) {
				const version = await installedVersion();
				assert.equal(version, "1.0.0");
			}
			lifecycle.install = installed;

			lifecycleStage = "upgrade";
			if (lifecycleFixture) {
				fixtureLatest = "1.1.0";
				fixtureHasUpgraded = true;
			}
			const updated = await evaluate(`window.pi.updatePackage(${JSON.stringify(lifecyclePackage)})`);
			assert(updated?.status === "succeeded", `package update failed: ${JSON.stringify(updated)}`);
			assert(
				await access(packagePath).then(
					() => true,
					() => false,
				),
				"updated package directory is missing",
			);
			const afterUpdate = await evaluate("window.pi.listConfiguredPackages()");
			assert(afterUpdate.some((entry) => entry.source === source && entry.scope === "user"));
			if (lifecycleFixture) assert.equal(await installedVersion(), "1.1.0");
			lifecycle.update = updated;

			lifecycleStage = "rollback";
			if (lifecycleFixture) {
				fixtureLatest = "1.0.0";
				const rollback = await evaluate(
					`window.pi.rollbackPackage(${JSON.stringify(lifecyclePackage)}, "1.0.0")`,
				);
				assert(rollback?.status === "succeeded", `package rollback failed: ${JSON.stringify(rollback)}`);
				assert.equal(await installedVersion(), "1.0.0");
				lifecycle.rollback = rollback;
			}

			lifecycleStage = "remove";
			const removed = await evaluate(`window.pi.removePackage(${JSON.stringify(source)}, "user")`);
			assert(removed?.status === "succeeded", `package remove failed: ${JSON.stringify(removed)}`);
			assert(
				!(await access(packagePath).then(
					() => true,
					() => false,
				)),
				"removed package directory remains",
			);
			const remaining = await evaluate("window.pi.listConfiguredPackages()");
			assert(!remaining.some((entry) => entry.source === source && entry.scope === "user"));
			lifecycle.remove = removed;
			report.lifecycleAcceptance = {
				status: "PASS",
				operations: lifecycle.operations,
				package: lifecyclePackage,
				receipts: lifecycle,
			};
			report.checks.push(
				lifecycleFixture
					? `isolated packaged host installed, upgraded, rolled back and removed ${lifecyclePackage}`
					: `isolated packaged host installed and removed ${lifecyclePackage}`,
			);
		} catch (error) {
			const message = String(error);
			if (lifecycleFixture || /network|registry|npm|fetch|timeout|unavailable|not found/iu.test(message)) {
				if (lifecycleFixture) {
					await evaluate(`window.pi.removePackage(${JSON.stringify(source)}, "user")`).catch(() => undefined);
				}
				report.lifecycleAcceptance = {
					status: "BLOCKED",
					operations: lifecycle.operations,
					package: lifecyclePackage,
					reason: lifecycleFixture
						? `${lifecycleStage} did not complete; cross-version rollback is unavailable through the host API: ${message}`
						: message,
					receipts: lifecycle,
				};
				report.checks.push(`packaged lifecycle blocked for ${lifecyclePackage}: ${message}`);
			} else {
				throw error;
			}
		}
	}
	const overview = await evaluate(`window.pi.getKnowledgeOverview({cwd:${JSON.stringify(cwd)}})`);
	assert.equal(overview.enabled, true);
	assert.equal(overview.bound, false);
	report.checks.push("fresh application knowledge enabled but unbound; no inherited Vault");
	const methods = await evaluate(
		"['getKnowledgeSemanticStatus','saveKnowledgeSemanticSettings','testKnowledgeSemanticProvider','indexKnowledgeSemantic','cancelKnowledgeSemanticIndex','getKnowledgeTopics','archiveKnowledgeTopic'].filter(name=>typeof window.pi[name]==='function')",
	);
	assert.equal(methods.length, 7);
	report.checks.push("new semantic/topic IPC surface shipped in actual preload");
	const commands = await evaluate(`window.pi.listSlashCommandsForCwd(${JSON.stringify(cwd)})`);
	const names = commands.map((item) => item.name);
	assert(names.some((name) => name.includes("obsidian-setup")));
	assert(names.some((name) => name.includes("research-vault")));
	report.commands = names.filter((name) => /obsidian|research/.test(name));
	report.checks.push(
		"packaged first-party research/Obsidian commands available in an unrelated empty project",
	);
	const session = await evaluate(`window.pi.createSession({cwd:${JSON.stringify(cwd)}})`);
	assert(typeof session?.sessionId === "string" && session.sessionId.length > 0);
	await evaluate(`window.pi.closeSession(${JSON.stringify(session.sessionId)})`);
	report.genericSession = { sessionId: session.sessionId, cwd };
	report.checks.push("packaged host can create and close a generic Pi session with no optional plugin");
	for (const name of ["auth.json", "models.json"]) {
		const data = await readFile(join(agent, name), "utf8").catch((error) => {
			if (error.code === "ENOENT") return "{}";
			throw error;
		});
		assert.deepEqual(JSON.parse(data), {});
	}
	report.checks.push("fresh auth/model stores are empty; no inherited model credentials");
	const capture = await call("Page.captureScreenshot", { format: "png" });
	await writeFile(join(root, "fresh-install.png"), Buffer.from(capture.data, "base64"));
	report.screenshot = join(root, "fresh-install.png");
	report.passed = true;
} catch (error) {
	report.error = String(error);
	process.exitCode = 1;
} finally {
	socket?.close();
	if (child.exitCode === null) {
		child.kill("SIGTERM");
		await Promise.race([once(child, "exit"), delay(5000)]);
		if (child.exitCode === null) child.kill("SIGKILL");
	}
	if (registryServer) {
		registryServer.close();
		await once(registryServer, "close").catch(() => undefined);
	}
	closeSync(logFd);
	report.completedAt = new Date().toISOString();
	await writeFile(join(root, "validation.json"), `${JSON.stringify(report, null, 2)}\n`);
	console.log(JSON.stringify(report));
}
