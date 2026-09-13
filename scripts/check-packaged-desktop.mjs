#!/usr/bin/env node
/** Fresh macOS package smoke with an isolated HOME/profile and no inherited credentials. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { closeSync, openSync } from "node:fs";
import { access, mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

if (process.argv.includes("--help")) {
	console.log(
		"node scripts/check-packaged-desktop.mjs /absolute/path/Percho.app\nLaunches only the specified package with isolated HOME/userData/agentDir/knowledgeDir. Leaves screenshots and a JSON validation receipt in a temporary folder. No real credentials, Vaults or model requests are used.",
	);
	process.exit(0);
}
if (process.platform !== "darwin") throw new Error("This package smoke currently validates macOS only");
if (!process.argv[2]) throw new Error("A built Percho.app path is required");
const bundle = await realpath(resolve(process.argv[2]));
const executable = join(bundle, "Contents/MacOS/Percho");
await access(executable);
const root = await realpath(await mkdtemp(join(tmpdir(), "percho-fresh-package-")));
const home = join(root, "home"),
	profile = join(root, "profile"),
	agent = join(root, "agent"),
	knowledge = join(root, "knowledge"),
	cwd = join(root, "project");
for (const path of [home, profile, agent, knowledge, cwd, join(root, "tmp")])
	await mkdir(path, { recursive: true });
const server = createServer();
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
			USER: "percho-fixture",
			LOGNAME: "percho-fixture",
			LANG: "en_US.UTF-8",
			TMPDIR: join(root, "tmp"),
			XDG_CONFIG_HOME: join(home, ".config"),
			XDG_CACHE_HOME: join(home, ".cache"),
			PI_CODING_AGENT_DIR: agent,
			PERCHO_KNOWLEDGE_DIR: knowledge,
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
		ready = await evaluate("Boolean(window.pi && document.querySelector('#root')?.childElementCount)");
		if (ready) break;
		await delay(100);
	}
	assert(ready, "Fresh UI failed to mount");
	report.checks.push("actual packaged renderer and CJS preload mounted");
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
	closeSync(logFd);
	report.completedAt = new Date().toISOString();
	await writeFile(join(root, "validation.json"), `${JSON.stringify(report, null, 2)}\n`);
	console.log(JSON.stringify(report));
}
