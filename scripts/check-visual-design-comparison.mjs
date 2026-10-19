#!/usr/bin/env node

/**
 * Render the built Desktop renderer with a deterministic, read-only host stub
 * and compare its four primary views with the checked-in plugin UI design.
 * This is a built-artifact visual check; it does not start Electron or touch
 * user data, credentials, sessions, Vaults, or external services.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { WebSocket } from "ws";

const repoRoot = resolve(import.meta.dirname, "..");
const rendererRoot = join(repoRoot, "packages/desktop/out/renderer");
const outputRoot = join(repoRoot, "docs/releases/visual");
const chrome = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const serverPort = Number.parseInt(process.env.VISUAL_SERVER_PORT || "8765", 10);
const visualTheme = process.env.VISUAL_THEME === "dark" ? "dark" : "light";
const outputSuffix = visualTheme === "dark" ? "-dark" : "";
const profile = await mkdtemp(join(tmpdir(), "drone-visual-profile-"));

const views = [
	{ id: "new-task", label: "新任务", width: 1440, height: 900, designBoard: "首页 · 新任务", nav: "新任务" },
	{ id: "knowledge", label: "知识库", width: 1440, height: 900, designBoard: "知识库", nav: "知识库" },
	{
		id: "skills",
		label: "技能与连接",
		width: 1280,
		height: 800,
		designBoard: "技能与连接 · 能力状态",
		nav: "技能与连接",
	},
	{
		id: "hosts",
		label: "主机",
		width: 1280,
		height: 800,
		designBoard: "共享侧栏组件（共享 shell 对照）",
		nav: "主机",
	},
];

function sleep(ms) {
	return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function waitFor(url, attempts = 80) {
	for (let index = 0; index < attempts; index += 1) {
		try {
			const response = await fetch(url);
			if (response.ok) return;
		} catch {
			// Server is still starting.
		}
		await sleep(100);
	}
	throw new Error(`timed out waiting for ${url}`);
}

function checksum(buffer) {
	return createHash("sha256").update(buffer).digest("hex");
}

const hostStub = `
(() => {
  try { sessionStorage.setItem('pi-splash-played', '1'); } catch {}
  window.__droneVisualErrors = [];
  window.addEventListener('error', (event) => {
    if (event.message) window.__droneVisualErrors.push({ type: 'error', message: event.message });
  });
  window.addEventListener('unhandledrejection', (event) => {
    window.__droneVisualErrors.push({ type: 'rejection', message: String(event.reason) });
  });
  const ok = (value) => Promise.resolve(value);
  const unsubscribe = () => {};
  const emptyOverview = { binding: null, index: null, wikiHistory: [], analyses: [], checkpoints: [], branches: [], replays: [], capabilities: [] };
  const defaults = {
    platform: 'darwin',
    onEvent: () => unsubscribe, onAskRequest: () => unsubscribe, onUpdateEvent: () => unsubscribe,
    onUiPluginsEvent: () => unsubscribe, onKnowledgeEvent: () => unsubscribe,
    onResearchSkillUpdateEvent: () => unsubscribe, onProviderLoginEvent: () => unsubscribe,
    onPermissionRequest: () => unsubscribe, onPermissionResolved: () => unsubscribe,
    onTrustRequest: () => unsubscribe, onMcpEvent: () => unsubscribe,
    getAppInfo: () => ok({ version: '0.33.1', repoUrl: 'https://github.com/Gyoungwe/Drone' }),
    listModels: () => ok([]), listAllSessions: () => ok([]), listSessions: () => ok([]),
    loadTabs: () => ok(null), loadUiState: () => ok({}), saveUiState: () => ok(), getModelPrefs: () => ok({}),
    listProviders: () => ok([]), listSubagents: () => ok([]), getLoadedResources: () => ok({}),
    listHosts: () => ok([]), getHealthSnapshot: () => ok(null), listJobs: () => ok([]), getOnboardingStatus: () => ok([]),
    getKnowledgeOverview: () => ok(emptyOverview), getKnowledgeReviews: () => ok({ items: [], total: 0 }),
    getKnowledgeGraph: () => ok({ nodes: [], edges: [] }), getKnowledgeStatus: () => ok({ status: 'unconfigured' }),
    getKnowledgeCloudStatus: () => ok({ mode: 'unconfigured' }),
    listConnectors: () => ok([]), listWriteAdapters: () => ok([]), listMcpServers: () => ok([]),
    listSkills: () => ok([]), listConfiguredPackages: () => ok([]),
    uiPluginsGetConfig: () => ok({ enabled: true, plugins: {}, assignments: {} }), uiPluginsList: () => ok([]),
    uiPluginsReadCode: () => ok({ code: '', manifest: null }),
    getEvidenceOverview: () => ok(emptyOverview), getPermissionMode: () => ok('default'), getContextUsage: () => ok(null),
    getTodos: () => ok([]), getFollowUpMessages: () => ok([]), getSessionMessages: () => ok([]),
    getResearchSkillUpdateState: () => ok({ status: 'idle' }), getDailyDir: () => ok(null), getTheme: () => ok(null),
    getZoteroStatus: () => ok({ installed: false, reachable: false }), getZoteroWebApi: () => ok({ configured: false }),
    getZoteroLocalWrite: () => ok({ authorized: false }), getInstitutionalStatus: () => ok({ configured: false }),
    getMcpStatus: () => ok({ servers: [] }), getMcpConfig: () => ok({ servers: [] }),
    getInstitutionalStatus: () => ok({ loggedIn: false, config: { configured: false, institutionName: null } }),
    getPermissionConfig: () => ok({ enabled: true }), getContextManagerConfig: () => ok({ mode: 'evaporation' }),
    hostEnvironment: () => ok({ os: 'macOS', kernel: 'Darwin', arch: 'arm64', hostname: 'local', cpu: { loadPercent: null, cores: 8, model: 'Apple Silicon' }, memory: { totalBytes: 0, freeBytes: 0 }, disk: null, tools: [], pythonPackages: null, npmPackages: null }), getDiagnostics: () => ok({}),
    getGitBranch: () => ok(null), listGitBranches: () => ok({ current: null, branches: [] }),
    getResearchSkillStatus: () => ok({ status: 'idle' }),
  };
  window.pi = new Proxy(defaults, { get(target, key) {
    if (key in target) return target[key];
    if (String(key).startsWith('on')) return () => unsubscribe;
    return () => ok(undefined);
  }});
  if (!window.matchMedia || ${JSON.stringify(visualTheme)} === 'dark') window.matchMedia = () => ({ matches: ${visualTheme === "dark"}, media: '(prefers-color-scheme: dark)', addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } });
  if (!window.ResizeObserver) window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
})();`;

const server = spawn("python3", ["-m", "http.server", String(serverPort), "--directory", rendererRoot], {
	stdio: "ignore",
});
const browser = spawn(
	chrome,
	[
		"--headless=new",
		"--no-sandbox",
		"--disable-gpu",
		"--disable-dev-shm-usage",
		"--hide-scrollbars",
		`--remote-debugging-port=${serverPort + 1}`,
		`--user-data-dir=${profile}`,
		"about:blank",
	],
	{ stdio: "ignore" },
);

try {
	await waitFor(`http://127.0.0.1:${serverPort}/index.html`);
	await waitFor(`http://127.0.0.1:${serverPort + 1}/json`);
	const pages = await (await fetch(`http://127.0.0.1:${serverPort + 1}/json`)).json();
	const page = pages.find((entry) => entry.type === "page");
	if (!page) throw new Error("Chrome CDP page unavailable");
	const socket = new WebSocket(page.webSocketDebuggerUrl);
	await new Promise((resolveOpen, rejectOpen) => {
		socket.once("open", resolveOpen);
		socket.once("error", rejectOpen);
	});
	let id = 0;
	const pending = new Map();
	socket.on("message", (raw) => {
		const message = JSON.parse(raw.toString());
		if (!message.id || !pending.has(message.id)) return;
		const request = pending.get(message.id);
		pending.delete(message.id);
		if (message.error) request.reject(new Error(message.error.message));
		else request.resolve(message.result);
	});
	const send = (method, params = {}) =>
		new Promise((resolveSend, rejectSend) => {
			const requestId = ++id;
			pending.set(requestId, { resolve: resolveSend, reject: rejectSend });
			socket.send(JSON.stringify({ id: requestId, method, params }));
		});
	async function waitForRenderer(label) {
		for (let attempt = 0; attempt < 120; attempt += 1) {
			const result = await send("Runtime.evaluate", {
				expression: `JSON.stringify({ text: document.body.innerText || '', hasRoot: Boolean(document.querySelector('#root')?.children.length), current: document.querySelector('[aria-current="page"]')?.getAttribute('aria-label') || null })`,
				returnByValue: true,
			});
			const state = JSON.parse(result.result?.value || "{}");
			const visual = await send("Runtime.evaluate", {
				expression:
					"JSON.stringify({ splash: Boolean(document.querySelector('#splash')), opacity: Number.parseFloat(getComputedStyle(document.querySelector('#root')).opacity || '0') })",
				returnByValue: true,
			});
			const visualState = JSON.parse(visual.result?.value || "{}");
			if (
				state.hasRoot &&
				state.text !== "Drone" &&
				state.text.includes(label) &&
				!visualState.splash &&
				visualState.opacity >= 0.99
			)
				return;
			await sleep(100);
		}
		throw new Error(`renderer did not settle on ${label}`);
	}
	await send("Runtime.enable");
	await send("Page.enable");
	await send("Page.addScriptToEvaluateOnNewDocument", { source: hostStub });
	await mkdir(outputRoot, { recursive: true });
	const design = await readFile(join(repoRoot, "docs/design/plugin-ui/Drone 插件化界面.html"), "utf8");
	const designAnchors = ["首页 · 新任务", "技能与连接 · 能力状态", "知识库", "共享侧栏组件"].filter(
		(anchor) => design.includes(anchor),
	);
	const results = [];
	for (const view of views) {
		await send("Emulation.setDeviceMetricsOverride", {
			width: view.width,
			height: view.height,
			deviceScaleFactor: 1,
			mobile: false,
		});
		await send("Page.navigate", {
			url: `http://127.0.0.1:${serverPort}/index.html?visual=${view.id}&theme=${visualTheme}`,
		});
		await waitForRenderer("新任务");
		if (view.id !== "new-task") {
			await send("Runtime.evaluate", {
				expression: `(() => { const button = Array.from(document.querySelectorAll('button')).find((node) => node.getAttribute('aria-label') === ${JSON.stringify(view.nav)}); if (!button) throw new Error('navigation button missing: ' + ${JSON.stringify(view.nav)}); button.click(); })()`,
			});
			await waitForRenderer(view.nav);
		}
		await sleep(300);
		const state = await send("Runtime.evaluate", {
			expression: `JSON.stringify({ body: document.body.innerText.slice(0, 1200), rootChildren: document.querySelector('#root')?.children.length || 0, errorBoundary: document.body.innerText.includes('界面出现异常'), errors: window.__droneVisualErrors || [], current: document.querySelector('[aria-current="page"]')?.getAttribute('aria-label') || null, appReady: document.documentElement.dataset.appReady || null, splash: Boolean(document.querySelector('#splash')), rootStyle: getComputedStyle(document.querySelector('#root')).cssText, rootBox: document.querySelector('#root')?.getBoundingClientRect().toJSON() })`,
			returnByValue: true,
		});
		const screenshot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
		const image = Buffer.from(screenshot.data, "base64");
		const imagePath = join(outputRoot, `drone-${view.id}${outputSuffix}.png`);
		await writeFile(imagePath, image);
		const parsed = JSON.parse(state.result?.value || "{}");
		results.push({
			id: view.id,
			label: view.label,
			viewport: { width: view.width, height: view.height },
			designBoard: view.designBoard,
			status:
				parsed.rootChildren > 0 &&
				!parsed.errorBoundary &&
				parsed.errors.length === 0 &&
				parsed.current === view.nav
					? "PASS"
					: "FAIL",
			rootChildren: parsed.rootChildren,
			currentNav: parsed.current,
			image: imagePath.replace(`${repoRoot}/`, ""),
			sha256: checksum(image),
			errors: parsed.errors,
			bodySample: parsed.body,
			appReady: parsed.appReady,
			splash: parsed.splash,
			rootBox: parsed.rootBox,
		});
	}
	const report = {
		generatedAt: new Date().toISOString(),
		method: `Chrome headless built renderer (${visualTheme} theme) with deterministic read-only window.pi stub`,
		reference: "docs/design/plugin-ui/Drone 插件化界面.html",
		designAnchors,
		comparison:
			"shared shell, token/typography, navigation hierarchy, content density and viewport contract; hosts has no dedicated board and uses the shared shell board",
		status:
			results.every((result) => result.status === "PASS") && designAnchors.length === 4 ? "PASS" : "FAIL",
		views: results,
	};
	await writeFile(
		join(outputRoot, `drone-visual-comparison${outputSuffix}.json`),
		`${JSON.stringify(report, null, 2)}\n`,
	);
	console.log(JSON.stringify(report, null, 2));
	if (report.status !== "PASS") process.exitCode = 1;
	socket.close();
} finally {
	server.kill("SIGTERM");
	browser.kill("SIGTERM");
}
