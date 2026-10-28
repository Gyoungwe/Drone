import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
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
import { expect, it } from "vitest";
import { SessionEngine } from "../src/session-engine/engine";

function deferred() {
	let resolve;
	const promise = new Promise((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
async function fixture({ guarded = true, blocked = false, ordinary = false, foreign = false } = {}) {
	const root = await mkdtemp(join(tmpdir(), "drone-native-export-"));
	const agentDir = join(root, "agent");
	await mkdir(agentDir);
	const settingsManager = SettingsManager.inMemory({});
	settingsManager.setProjectTrusted(true);
	const loader = new DefaultResourceLoader({
		cwd: root,
		agentDir,
		settingsManager,
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noContextFiles: true,
	});
	await loader.reload();
	const runtime = await ModelRuntime.create({
		authPath: join(agentDir, "auth.json"),
		modelsPath: null,
		allowModelNetwork: false,
		refreshOnCreate: false,
	});
	const faux = fauxProvider({ provider: "private-export-offline", tokensPerSecond: 0 });
	runtime.registerNativeProvider(faux.provider);
	await runtime.setRuntimeApiKey(faux.provider.id, "synthetic-offline-only");
	const entered = deferred(),
		release = deferred();
	let current = true,
		boundaryCalls = 0;
	const { session } = await createAgentSession({
		cwd: root,
		agentDir,
		resourceLoader: loader,
		settingsManager,
		modelRuntime: runtime,
		model: faux.getModel(),
		sessionManager: SessionManager.create(root, join(root, "history")),
		tools: [],
		...(guarded
			? {
					hostExportIsOrdinary: () => ordinary,
					async hostExportBoundary({ entries, origins }) {
						boundaryCalls++;
						entered.resolve();
						if (blocked) await release.promise;
						const messages = new Map();
						for (const entry of entries)
							if (entry.type === "message" && entry.message.role === "assistant") {
								expect(
									origins.some(
										(origin) =>
											origin.entry === entry &&
											origin.message ===
												session.messages.find(
													(message) => session.getHostPersistedMessage(message)?.id === entry.id,
												),
									),
								).toBe(true);
								messages.set(foreign ? structuredClone(entry) : entry, {
									...entry.message,
									content: [{ type: "text", text: "CHECKED_EXPORT" }],
								});
							}
						return {
							messages,
							assertCurrent() {
								if (!current) throw new Error("actual source revoked");
							},
						};
					},
				}
			: {}),
	});
	await session.bindExtensions({});
	faux.setResponses([fauxAssistantMessage("RAW_PRIVATE_EXPORT_BODY")]);
	await session.prompt("Synthetic export question");
	session.sessionManager.appendCustomEntry("source-audit", { saved: true });
	return {
		root,
		session,
		entered,
		release,
		calls: () => boundaryCalls,
		revoke() {
			current = false;
		},
		async close() {
			release.resolve();
			await new SessionEngine().dispose(session);
			await rm(root, { recursive: true, force: true });
		},
	};
}

it("keeps ordinary synchronous SDK JSONL export unchanged", async () => {
	const f = await fixture({ guarded: false });
	try {
		const output = f.session.exportToJsonl(join(f.root, "ordinary.jsonl"));
		expect(typeof output).toBe("string");
		expect(await readFile(output, "utf8")).toContain("RAW_PRIVATE_EXPORT_BODY");
		expect(f.calls()).toBe(0);
	} finally {
		await f.close();
	}
});

it("rejects sync guarded export and awaits the actual entry-associated projection for JSONL and HTML", async () => {
	const f = await fixture();
	try {
		expect(() => f.session.exportToJsonl(join(f.root, "sync.jsonl"))).toThrow("asynchronous host export");
		const before = await readFile(f.session.sessionFile, "utf8");
		const output = await f.session.exportToJsonlForHost(join(f.root, "checked.jsonl"));
		const text = await readFile(output, "utf8");
		expect(text).toContain("CHECKED_EXPORT");
		expect(text).not.toContain("RAW_PRIVATE_EXPORT_BODY");
		expect(text).toContain('"customType":"source-audit"');
		const html = await f.session.exportToHtml(join(f.root, "checked.html"));
		const htmlText = await readFile(html, "utf8");
		const encoded = /<script id="session-data" type="application\/json">([^<]+)<\/script>/.exec(htmlText)[1];
		const htmlData = Buffer.from(encoded, "base64").toString("utf8");
		expect(htmlData).toContain("CHECKED_EXPORT");
		expect(htmlData).not.toContain("RAW_PRIVATE_EXPORT_BODY");
		expect(await readFile(f.session.sessionFile, "utf8")).toBe(before);
		expect(f.calls()).toBe(2);
	} finally {
		await f.close();
	}
});

it("does not create output after an awaited export owner is revoked", async () => {
	const f = await fixture({ blocked: true });
	try {
		const output = join(f.root, "revoked.jsonl");
		const exporting = f.session.exportToJsonlForHost(output);
		await f.entered.promise;
		f.revoke();
		f.release.resolve();
		await expect(exporting).rejects.toThrow("actual source revoked");
		await expect(access(output)).rejects.toMatchObject({ code: "ENOENT" });
	} finally {
		await f.close();
	}
});

it("retains sync semantics for a host-confirmed ordinary session even with the callback installed", async () => {
	const f = await fixture({ ordinary: true });
	try {
		const output = f.session.exportToJsonl(join(f.root, "ordinary-bound.jsonl"));
		expect(typeof output).toBe("string");
		expect(await readFile(output, "utf8")).toContain("RAW_PRIVATE_EXPORT_BODY");
		expect(f.calls()).toBe(0);
	} finally {
		await f.close();
	}
});
it("rejects a changed actual branch after awaited projection without creating output", async () => {
	const f = await fixture({ blocked: true });
	try {
		const output = join(f.root, "changed.jsonl");
		const exporting = f.session.exportToJsonlForHost(output);
		await f.entered.promise;
		f.session.sessionManager.appendCustomEntry("actual-branch-change", {});
		f.release.resolve();
		await expect(exporting).rejects.toThrow("session changed");
		await expect(access(output)).rejects.toMatchObject({ code: "ENOENT" });
	} finally {
		await f.close();
	}
});
it("cannot replace an actual SDK entry by copying its JSON identity", async () => {
	const f = await fixture({ foreign: true });
	try {
		const output = join(f.root, "copied-entry.jsonl");
		await expect(f.session.exportToJsonlForHost(output)).rejects.toThrow("omitted an assistant entry");
		await expect(access(output)).rejects.toMatchObject({ code: "ENOENT" });
	} finally {
		await f.close();
	}
});
