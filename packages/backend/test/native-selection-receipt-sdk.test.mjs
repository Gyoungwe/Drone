import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import {
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { afterEach, expect, it, vi } from "vitest";
import { NativeSessionDelivery } from "../src/plugins/native-delivery";
import { desktopLoaderOptions } from "../src/project/trust-loader";
import { SessionEngine } from "../src/session-engine/engine";

const roots = [];
afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture(settings = {}, additionalExtensionPaths = []) {
	const root = await mkdtemp(join(tmpdir(), "drone-effective-selection-"));
	roots.push(root);
	const agentDir = join(root, "agent");
	await mkdir(agentDir);
	const receipts = [];
	const settingsManager = SettingsManager.inMemory(settings);
	settingsManager.setProjectTrusted(true);
	const loader = new DefaultResourceLoader({
		cwd: root,
		agentDir,
		settingsManager,
		additionalExtensionPaths,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
		hostExtensionSelection: (receipt) => receipts.push(receipt),
	});
	return { root, loader, receipts, settingsManager };
}

it("reports an explicitly selected missing settings extension that never reaches import interception", async () => {
	const f = await fixture({ extensions: ["./missing.mjs"] });
	await f.loader.reload();
	expect(f.receipts).toEqual([
		{ phase: "loading" },
		{ phase: "loaded", paths: [join(f.root, "agent", "missing.mjs")] },
	]);
	expect(f.loader.getExtensions().errors).toMatchObject([{ path: join(f.root, "agent", "missing.mjs") }]);
});

it("honors the actual disabled pattern when retaining an unavailable configured path", async () => {
	const f = await fixture({ extensions: ["./missing.mjs", "-./missing.mjs"] });
	await f.loader.reload();
	expect(f.receipts.at(-1)).toEqual({ phase: "loaded", paths: [] });
	expect(f.loader.getExtensions().errors).toEqual([]);
});

it("retains missing package manifest entries without forcing explicitly disabled extension resources", async () => {
	const f = await fixture();
	const pkg = join(f.root, "package");
	await mkdir(pkg);
	await writeFile(
		join(pkg, "package.json"),
		JSON.stringify({ name: "selection-package", pi: { extensions: ["./dist/native.mjs"] } }),
	);
	f.settingsManager.setPackages([pkg]);
	await f.loader.reload();
	expect(f.receipts.at(-1)).toEqual({ phase: "loaded", paths: [join(pkg, "dist", "native.mjs")] });
	f.settingsManager.setPackages([{ source: pkg, extensions: [] }]);
	await f.loader.reload();
	expect(f.receipts.at(-1)).toEqual({ phase: "loaded", paths: [] });
});

it("keeps SDK behavior unchanged when the host-only observer is absent", async () => {
	const f = await fixture();
	const loader = new DefaultResourceLoader({
		cwd: f.root,
		agentDir: join(f.root, "agent"),
		settingsManager: SettingsManager.inMemory({ extensions: ["./missing.mjs"] }),
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
	});
	await loader.reload();
	expect(loader.getExtensions().errors).toEqual([]);
});

it("retains an empty manifest glob as unresolved selection and still honors package extension filtering", async () => {
	const f = await fixture();
	const pkg = join(f.root, "package");
	await mkdir(pkg);
	await writeFile(
		join(pkg, "package.json"),
		JSON.stringify({ name: "glob-package", pi: { extensions: ["./dist/*.mjs"] } }),
	);
	f.settingsManager.setPackages([pkg]);
	await f.loader.reload();
	expect(f.receipts.at(-1)).toEqual({ phase: "loaded", paths: [join(pkg, "dist", "*.mjs")] });
	f.settingsManager.setPackages([{ source: pkg, extensions: [] }]);
	await f.loader.reload();
	expect(f.receipts.at(-1)).toEqual({ phase: "loaded", paths: [] });
});

it("reports a selected package that has disappeared and respects explicit package-native disable", async () => {
	const f = await fixture();
	const missingPackage = join(f.root, "removed-package");
	f.settingsManager.setPackages([missingPackage]);
	await f.loader.reload();
	expect(f.receipts.at(-1)).toEqual({ phase: "loaded", paths: [missingPackage] });
	f.settingsManager.setPackages([{ source: missingPackage, extensions: [] }]);
	await f.loader.reload();
	expect(f.receipts.at(-1)).toEqual({ phase: "loaded", paths: [] });
	f.settingsManager.setPackages([{ source: missingPackage, autoload: false }]);
	await f.loader.reload();
	expect(f.receipts.at(-1)).toEqual({ phase: "loaded", paths: [] });
});

it("uses the production loader receipt across actual SDK chat, missing-source reload and explicit native exclusion", async () => {
	const f = await fixture();
	const delivery = new NativeSessionDelivery(
		(path) => (existsSync(path) ? { kind: "ordinary" } : { kind: "unconfirmed" }),
		(a, b) => a === b,
		() => [],
	);
	const loader = new DefaultResourceLoader({
		cwd: f.root,
		agentDir: join(f.root, "agent"),
		settingsManager: f.settingsManager,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
		...desktopLoaderOptions({ appendSystemPrompt: [], additionalSkillPaths: [] }, f.root, { delivery }),
	});
	await loader.reload();
	const modelRuntime = await ModelRuntime.create({
		authPath: join(f.root, "auth.json"),
		modelsPath: null,
		allowModelNetwork: false,
		refreshOnCreate: false,
	});
	const faux = fauxProvider({ provider: "selection-receipt-offline", tokensPerSecond: 0 });
	modelRuntime.registerNativeProvider(faux.provider);
	await modelRuntime.setRuntimeApiKey(faux.provider.id, "synthetic-offline-key");
	faux.setResponses([
		fauxAssistantMessage("ORDINARY_CHAT"),
		fauxAssistantMessage("RAW_MISSING_SOURCE"),
		fauxAssistantMessage("AFTER_NATIVE_EXCLUSION"),
	]);
	const { session } = await createAgentSession({
		cwd: f.root,
		agentDir: join(f.root, "agent"),
		settingsManager: f.settingsManager,
		resourceLoader: loader,
		modelRuntime,
		model: faux.getModel(),
		sessionManager: SessionManager.inMemory(f.root),
		tools: [],
		hostDeliveryRunStart: (signal) => delivery.start(signal),
		hostDeliveryBoundary: (event, signal) => delivery.finalize(event, signal),
	});
	try {
		await session.bindExtensions({});
		await session.prompt("synthetic ordinary chat");
		expect(JSON.stringify(session.sessionManager.getBranch())).toContain("ORDINARY_CHAT");
		const missingPackage = join(f.root, "missing-package");
		f.settingsManager.setPackages([missingPackage]);
		await session.reload();
		await session.prompt("synthetic unavailable-source chat");
		expect(JSON.stringify(session.sessionManager.getBranch())).not.toContain("RAW_MISSING_SOURCE");
		expect(session.messages.at(-1)).toMatchObject({
			stopReason: "aborted",
			errorMessage: "Final delivery unavailable",
			content: [],
		});
		f.settingsManager.setPackages([{ source: missingPackage, extensions: [] }]);
		await session.reload();
		await session.prompt("synthetic explicit native exclusion");
		expect(JSON.stringify(session.sessionManager.getBranch())).toContain("AFTER_NATIVE_EXCLUSION");
	} finally {
		await new SessionEngine().dispose(session);
		await delivery.dispose();
	}
});

it("rejects an unconfirmed managed selection before extension code can execute", async () => {
	const f = await fixture();
	const path = join(f.root, "unconfirmed.mjs");
	await writeFile(path, "throw new Error('PLUGIN_CODE_EXECUTED');");
	const delivery = new NativeSessionDelivery(
		() => ({ kind: "unconfirmed" }),
		(a, b) => a === b,
		() => [],
	);
	const loader = new DefaultResourceLoader({
		cwd: f.root,
		agentDir: join(f.root, "agent"),
		settingsManager: f.settingsManager,
		additionalExtensionPaths: [path],
		...desktopLoaderOptions(
			{
				appendSystemPrompt: [],
				additionalSkillPaths: [],
				pluginRuntimeDirectory: join(f.root, "unused-runtime"),
			},
			f.root,
			{ delivery },
		),
	});
	await loader.reload();
	expect(loader.getExtensions().extensions).toEqual([]);
	expect(loader.getExtensions().errors).toMatchObject([
		{ error: "Native extension source authority is unavailable" },
	]);
	expect(JSON.stringify(loader.getExtensions().errors)).not.toContain("PLUGIN_CODE_EXECUTED");
	await delivery.dispose();
});

it("invalidates the preceding receipt before a failed actual loader reload", async () => {
	const f = await fixture();
	await f.loader.reload();
	expect(f.receipts.at(-1)).toEqual({ phase: "loaded", paths: [] });
	vi.spyOn(f.settingsManager, "reload").mockRejectedValueOnce(new Error("synthetic reload failed"));
	await expect(f.loader.reload()).rejects.toThrow("synthetic reload failed");
	expect(f.receipts.at(-1)).toEqual({ phase: "loading" });
	expect(f.receipts.filter((receipt) => receipt.phase === "loaded")).toHaveLength(1);
});
