import assert from "node:assert/strict";
import { access, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export function lifecycleSentinel(version) {
	return `hr3_fixture_${version.replaceAll(".", "_")}`;
}

const encode = JSON.stringify;

async function waitFor(read, label, timeout = 15_000) {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		const value = await read();
		if (value) return value;
		await delay(100);
	}
	throw new Error(`${label} did not appear`);
}

async function verifySessionResources(api, sessionId, packageName, current, next) {
	const resources = await api("getLoadedResources", sessionId);
	assert.deepEqual(
		resources.packageVersions?.find((row) => row.packageName === packageName),
		{
			packageName,
			scope: "user",
			currentVersion: current,
			...(next === undefined ? {} : { nextSessionVersion: next }),
		},
	);
	assert.deepEqual(
		resources.extensions.flatMap((entry) => entry.tools).filter((name) => name.startsWith("hr3_fixture_")),
		[lifecycleSentinel(current)],
	);
}

async function persistFixtureSession(session, name) {
	assert(session.sessionFile, "Pi did not provide a session file");
	const entry = {
		type: "session",
		version: 3,
		id: session.sessionId,
		timestamp: new Date().toISOString(),
		cwd: session.cwd,
	};
	const info = { type: "session_info", id: "fixture", parentId: null, timestamp: entry.timestamp, name };
	await writeFile(session.sessionFile, `${encode(entry)}\n${encode(info)}\n`, {
		flag: "wx",
		mode: 0o600,
	}).catch((error) => {
		if (error.code !== "EEXIST") throw error;
	});
}

async function selectTab(evaluate, sessionId) {
	const selector = encode(`[data-tab-id="${sessionId}"] button`);
	await waitFor(
		() => evaluate(`Boolean(document.querySelector(${selector}))`).catch(() => false),
		"Restored session tab",
	);
	await evaluate(`document.querySelector(${selector}).click()`);
	await evaluate(
		`document.querySelector('button[aria-controls="context-panel"][aria-expanded="false"]')?.click()`,
	);
}

async function verifyOverview(api, evaluate, packageName, idle, fresh) {
	await persistFixtureSession(idle, "HR3 existing session");
	await persistFixtureSession(fresh, "HR3 new session");
	await api("saveTabs", { files: [idle.sessionFile, fresh.sessionFile], activeFile: idle.sessionFile });
	await evaluate('localStorage.setItem("pi-desktop.lang", "en"); setTimeout(() => location.reload(), 0)');
	const packageRow = `[data-testid="overview-pane"] [data-package-name="${packageName}"]`;
	const read = () => evaluate(`document.querySelector(${encode(packageRow)})?.textContent ?? ""`);
	await selectTab(evaluate, idle.sessionId);
	const before = await waitFor(async () => {
		const text = await read();
		return text.includes("Current session 1.0.0") && text.includes("Next session 1.1.0") && text;
	}, "Existing session version and pending version");
	await selectTab(evaluate, fresh.sessionId);
	const after = await waitFor(async () => {
		const text = await read();
		return text.includes("Current session 1.1.0") && !text.includes("Next session") && text;
	}, "New session version with the pending version cleared");
	return { before, after };
}

async function startFixtureStream(evaluate, id) {
	await evaluate(`(() => {
		window.__hr3Stream = "running";
		const unsubscribe = window.pi.onEvent(({ sessionId, event }) => {
			if (sessionId !== ${encode(id)} || event.type !== "agent_end") return;
			window.__hr3Stream = "done";
			unsubscribe();
		});
		void window.pi.prompt(${encode(id)}, "Lifecycle fixture stream").catch(error => {
			window.__hr3Stream = String(error);
			unsubscribe();
		});
	})()`);
}

async function verifyNextSession({ api, evaluate, cwd, packageName, controls }, lifecycle) {
	const idle = await api("createSession", { cwd });
	const streaming = await api("createSession", { cwd, provider: "openai", modelId: "drone-packaged-stream" });
	await startFixtureStream(evaluate, streaming.sessionId);
	await controls.waitForStream();
	controls.selectVersion("1.1.0");
	const receipt = await api("updatePackage", packageName);
	assert.equal(receipt?.status, "succeeded", encode(receipt));
	assert.equal(receipt.effect, "next-session");
	assert.deepEqual(new Set(receipt.deferredSessionIds), new Set([idle.sessionId, streaming.sessionId]));
	assert.deepEqual(
		receipt.events.map(({ type }) => type),
		["staged", "verified", "enabled", "reload_deferred", "reload_deferred"],
	);
	const fresh = await api("createSession", { cwd });
	await verifySessionResources(api, idle.sessionId, packageName, "1.0.0", "1.1.0");
	await verifySessionResources(api, streaming.sessionId, packageName, "1.0.0", "1.1.0");
	await verifySessionResources(api, fresh.sessionId, packageName, "1.1.0");
	assert.equal(await evaluate("window.__hr3Stream"), "running");
	controls.releaseStream();
	await waitFor(() => evaluate('window.__hr3Stream !== "running"'), "Stream completion");
	assert.equal(await evaluate("window.__hr3Stream"), "done");
	lifecycle.update = receipt;
	await api("closeSession", streaming.sessionId);
	lifecycle.trace = await verifyLifecycleTrace(streaming, packageName);
	lifecycle.overview = await verifyOverview(api, evaluate, packageName, idle, fresh);
	return { idle, fresh };
}

async function verifyLifecycleTrace(session, packageName) {
	const trace = await readFile(
		join(dirname(session.sessionFile), "traces", `trace-${session.sessionId}.jsonl`),
		"utf8",
	);
	const steps = trace
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line))
		.filter(({ kind }) => kind === "package_lifecycle")
		.map(({ data }) => data);
	assert.deepEqual(
		steps,
		["staged", "verified", "enabled", "reload_deferred"].map((stage) => ({
			package: packageName,
			version: "1.1.0",
			stage,
		})),
	);
	return steps;
}

async function verifyRollbackAndRemoval(
	{ api, cwd, packageName, packagePath, controls },
	lifecycle,
	sessions,
) {
	const installedVersion = async () =>
		JSON.parse(await readFile(join(packagePath, "package.json"), "utf8")).version;
	controls.selectVersion("1.0.0");
	const rolledBack = await api("rollbackPackage", packageName, "1.0.0");
	assert.equal(rolledBack?.status, "succeeded", encode(rolledBack));
	assert.equal(rolledBack.effect, "next-session");
	assert.equal(await installedVersion(), "1.0.0");
	await verifySessionResources(api, sessions.idle.sessionId, packageName, "1.0.0");
	await verifySessionResources(api, sessions.fresh.sessionId, packageName, "1.1.0", "1.0.0");
	lifecycle.rollback = rolledBack;
	await removePackage(api, packageName, packagePath, lifecycle);
	await verifySessionResources(api, sessions.fresh.sessionId, packageName, "1.1.0", null);
	const removed = await api("createSession", { cwd });
	const resources = await api("getLoadedResources", removed.sessionId);
	assert(!resources.packageVersions?.some((row) => row.packageName === packageName));
	assert(
		!resources.extensions.flatMap((entry) => entry.tools).some((name) => name.startsWith("hr3_fixture_")),
	);
	const restored = await api("installPackage", packageName);
	assert.equal(restored?.status, "succeeded", encode(restored));
	assert.equal(await installedVersion(), "1.0.0");
	lifecycle.restore = restored;
	await removePackage(api, packageName, packagePath, lifecycle, "removeFinal");
	await Promise.all(
		[sessions.idle, sessions.fresh, removed].map(({ sessionId }) => api("closeSession", sessionId)),
	);
}

async function removePackage(api, packageName, packagePath, lifecycle, key = "remove") {
	const source = `npm:${packageName}`;
	const removed = await api("removePackage", source, "user");
	assert.equal(removed?.status, "succeeded", encode(removed));
	await assert.rejects(access(packagePath), { code: "ENOENT" });
	const remaining = await api("listConfiguredPackages");
	assert(
		!remaining.some(
			(entry) => entry.scope === "user" && (entry.source === source || entry.source.startsWith(`${source}@`)),
		),
	);
	lifecycle[key] = removed;
}

export async function runPackagedPackageLifecycle({ evaluate, cwd, packageName, packagePath, controls }) {
	const api = async (method, ...args) => {
		try {
			return await evaluate(`window.pi.${method}(${args.map((arg) => encode(arg)).join(",")})`);
		} catch (error) {
			throw new Error(`${method}: ${String(error)}`, { cause: error });
		}
	};
	const operations = controls
		? ["install", "upgrade", "rollback", "remove", "restore", "remove"]
		: ["install", "update", "remove"];
	const lifecycle = { package: packageName, operations };
	try {
		const receipt = await api("installPackage", packageName);
		assert.equal(receipt?.status, "succeeded", encode(receipt));
		await access(packagePath);
		const configured = await api("listConfiguredPackages");
		assert(configured.some((entry) => entry.source === `npm:${packageName}` && entry.scope === "user"));
		lifecycle.install = receipt;
		if (controls) {
			assert.equal(receipt.effect, "next-session");
			const input = { api, evaluate, cwd, packageName, packagePath, controls };
			const sessions = await verifyNextSession(input, lifecycle);
			await verifyRollbackAndRemoval(input, lifecycle, sessions);
		} else {
			lifecycle.update = await api("updatePackage", packageName);
			assert.equal(lifecycle.update?.status, "succeeded", encode(lifecycle.update));
			await access(packagePath);
			await removePackage(api, packageName, packagePath, lifecycle);
		}
		return { status: "PASS", operations, package: packageName, receipts: lifecycle };
	} catch (error) {
		controls?.releaseStream();
		const reason = String(error);
		if (!controls && !/network|registry|npm|fetch|timeout|unavailable|not found/iu.test(reason)) throw error;
		return { status: "BLOCKED", operations, package: packageName, reason, receipts: lifecycle };
	}
}
