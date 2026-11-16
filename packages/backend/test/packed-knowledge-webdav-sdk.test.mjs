/** Opt-in shipped-package WebDAV acceptance; never run against a personal Vault. */
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fauxProvider } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { expect, it, vi } from "vitest";
import { createBackend } from "../src/create-backend";
import { PluginRuntimeBridge } from "../src/plugins/coordinator";
import { fileCapabilityHandlers, PluginFileCapabilities } from "../src/plugins/file-capabilities";
import { PluginCredentialStore } from "../src/plugins/plugin-credentials";
import { createProcessPluginRuntime } from "../src/plugins/process-runtime";
import { PluginResourceManager } from "../src/plugins/resource-capabilities";
import {
	assertFetchConfined,
	assertNoLeaks,
	closeHost,
	installPackedKnowledge,
	packedFixture,
	secrets,
	seedNote,
	sha256,
	username,
} from "./packed-knowledge-webdav-fixture.mjs";

const tarball = process.env.DRONE_KNOWLEDGE_TARBALL;
const runtimeDirectory = resolve(
	process.env.DRONE_PLUGIN_RUNTIME_DIRECTORY ??
		join(import.meta.dirname, `../../desktop/plugin-runtime/${process.platform}-${process.arch}`),
);
const notePath = "Inbox/w2d.md";
const noteText = "# Synthetic W2d note\nPacked WebDAV readback.\n";

async function fileCapabilities(t, { pluginId, applicationId, signal, events }) {
	const files = await PluginFileCapabilities.create(
		[
			{ handle: "state", path: t.state, kind: "state", scope: { kind: "application" } },
			{
				handle: "vault",
				path: t.vault,
				kind: "files",
				scope: { kind: "application" },
				...(t.writable ? { fileWrite: true } : {}),
			},
		],
		t.cache,
		t.leases,
	);
	const resources = new PluginResourceManager({
		pluginId,
		applicationId,
		packageRoot: t.packageRoot,
		entries: t.source.resources,
		runtimeDirectory,
		files,
		signal,
		events,
		leaseDirectory: t.leases,
	});
	return {
		handlers: {
			...fileCapabilityHandlers(files),
			...resources.handlers(),
			...t.backend.sessions.getPluginSessionCapabilities(),
			...t.backend.sessions.getPluginSourceCapabilities(t.source),
		},
		resources: [
			{ kind: "state", handle: "state", access: "read" },
			{ kind: "files", handle: "vault", access: t.writable ? "read-write" : "read" },
		],
		resourcesLifecycle: { dispose: () => resources.disposeResources() },
		dispose: async () => {
			await resources.disposeResources();
			await files.drain();
		},
		finalRelease: async () => {
			resources.releaseReservations();
			files.releaseReservations();
		},
	};
}

async function startHost(t) {
	const modelRuntime = await ModelRuntime.create({
		authPath: join(t.agentDir, "auth.json"),
		modelsPath: null,
		allowModelNetwork: false,
		refreshOnCreate: false,
	});
	const faux = fauxProvider({ provider: "packed-webdav-offline", tokensPerSecond: 0 });
	modelRuntime.registerNativeProvider(faux.provider);
	await modelRuntime.setRuntimeApiKey(faux.provider.id, "synthetic-offline-only");
	t.window = { id: 41, isDestroyed: () => false };
	t.backend = createBackend({
		projectTrust: false,
		lazyCapabilities: false,
		dailyDiscovery: false,
		tools: ["read", "knowledge_status", "knowledge_search"],
		desktopIntegration: {
			appendSystemPrompt: [],
			additionalSkillPaths: [],
			additionalExtensionPaths: [t.source.nativeEntrypoint],
			pluginRuntimeDirectory: runtimeDirectory,
			noSkills: true,
			noPromptTemplates: true,
			nativeRuntime: {
				begin: () =>
					t.bridge.beginNative(t.window, (path) =>
						path === t.source.nativeEntrypoint ? "knowledge" : undefined,
					),
				manages: (path) => path === t.source.nativeEntrypoint,
			},
		},
	});
	t.backend.sessions.modelRuntime = modelRuntime;
	t.bridge = new PluginRuntimeBridge({
		source: (name) => (name === "knowledge" ? t.source : undefined),
		sources: () => [{ name: "knowledge", source: t.source, state: "enabled" }],
		enabled: () => true,
		factory: (source) => createProcessPluginRuntime({ ...source, runtimeDirectory }),
		approve: async (_window, _source, operation, detail) => {
			t.approvals.push({ operation, detail });
			return operation !== "capability:network.write" || t.approveNetwork;
		},
		getSessionContext: (id) => t.backend.sessions.getPluginCallerContext(id),
		capabilities: () => (context) => fileCapabilities(t, context),
	});
	const meta = await t.backend.sessions.createSession({
		cwd: t.workspace,
		provider: faux.provider.id,
		modelId: faux.getModel().id,
	});
	t.sessionId = meta.sessionId;
	expect(
		t.backend.sessions.registry
			.get(meta.sessionId)
			.session.getAllTools()
			.map((tool) => tool.name),
	).toContain("knowledge_status");
	t.binding = await t.bridge.bind("knowledge", t.window);
	t.lease = t.bridge.selectSession(t.window, t.sessionId);
}

async function invoke(t, operation, input = null) {
	const result = await t.bridge.invoke(t.window, t.binding, operation, input, t.lease);
	t.results.push({ operation, result });
	return result;
}

async function missingCredentials(t) {
	expect(await invoke(t, "cloudStatus")).toEqual({
		status: "not_configured",
		reason: "not_configured",
		configured: false,
		credentialSource: null,
		savedConfigured: false,
	});
	expect(await invoke(t, "cloudProbe")).toEqual({ status: "failed", reason: "not_configured" });
	expect(t.requests).toEqual([]);
	expect(t.fetchCalls).toEqual([]);
}

async function savedDigest(t) {
	const slot = t.source.credentials.find((entry) => entry.slot === "webdav");
	await new PluginCredentialStore().save(t.source.pluginId, slot, secrets.saved, {});
	expect(await invoke(t, "cloudStatus")).toEqual({
		status: "available",
		reason: null,
		configured: true,
		credentialSource: "saved",
		savedConfigured: true,
	});
	const start = t.requests.length;
	expect(await invoke(t, "cloudProbe")).toEqual({ status: "ok", result: { initialized: false } });
	const first = t.requests.slice(start);
	expect(first.map(({ passwordUsed }) => passwordUsed)).toEqual(["none", "saved", "saved"]);
	expect(first.every(({ method, depth }) => method === "PROPFIND" && depth === "0")).toBe(true);
	const next = t.requests.length;
	expect(await invoke(t, "cloudProbe")).toEqual({ status: "ok", result: { initialized: false } });
	expect(t.requests.slice(next).map(({ passwordUsed }) => passwordUsed)).toEqual(["saved", "saved"]);
}

async function writeApproval(t) {
	t.approveNetwork = false;
	const deniedStart = t.requests.length;
	const approvalsStart = t.approvals.length;
	expect(await invoke(t, "cloudInitialize")).toEqual({ status: "failed", reason: "forbidden" });
	// Isolate PUT denial from collection initialization denial without invoking a denied mutation.
	t.collections.add("/Drone-Knowledge/");
	t.collections.add("/Drone-Knowledge/Inbox/");
	expect(await invoke(t, "cloudWrite", { path: notePath, text: noteText })).toEqual({
		status: "ok",
		result: {
			path: notePath,
			status: "forbidden",
			reason: "forbidden",
			version: null,
			hash: sha256(noteText),
		},
	});
	expect(t.requests.slice(deniedStart).filter(({ method }) => ["MKCOL", "PUT"].includes(method))).toEqual([]);
	const denied = t.approvals
		.slice(approvalsStart)
		.filter(({ operation }) => operation === "capability:network.write");
	expect(denied.map(({ detail }) => detail.split("\n")[0])).toEqual([
		"Network write: MKCOL 10.126.126.1:8080/Drone-Knowledge/",
		"Network write: PUT 10.126.126.1:8080/Drone-Knowledge/Inbox/w2d.md",
	]);
	t.collections.delete("/Drone-Knowledge/");
	t.collections.delete("/Drone-Knowledge/Inbox/");
	t.approveNetwork = true;
	expect(await invoke(t, "cloudInitialize")).toEqual({ status: "ok", result: { initialized: true } });
	const written = await invoke(t, "cloudWrite", { path: notePath, text: noteText });
	expect(written).toEqual({
		status: "ok",
		result: {
			path: notePath,
			status: "created",
			version: `"${sha256(noteText)}"`,
			hash: sha256(noteText),
			reason: null,
		},
	});
	expect(t.notes.get(`/Drone-Knowledge/${notePath}`)).toEqual({
		text: noteText,
		etag: written.result.version,
	});
	const writes = t.approvals.filter(({ operation }) => operation === "capability:network.write");
	expect(writes).toHaveLength(5);
	for (const { detail } of writes) {
		expect(detail).toContain("Uses saved credential: webdav");
		expect(detail.includes(username)).toBe(false);
	}
}

function expectRead(result, path, text) {
	expect(result).toEqual({
		status: "ok",
		result: {
			path,
			text,
			hash: sha256(text),
			version: `"${sha256(text)}"`,
			bytes: Buffer.byteLength(text),
			lastModified: null,
		},
	});
}

async function basicChallenge(t) {
	// A new production host/store creates a fresh authentication scope for Basic negotiation.
	await closeHost(t);
	t.auth = "basic";
	await startHost(t);
	const start = t.requests.length;
	expectRead(await invoke(t, "cloudRead", { path: notePath }), notePath, noteText);
	expect(t.requests.slice(start).map(({ passwordUsed }) => passwordUsed)).toEqual(["none", "saved"]);
}

async function environmentOverride(t) {
	vi.stubEnv("DRONE_WEBDAV_PASSWORD", secrets.env);
	t.accepted = "env";
	expect(await invoke(t, "cloudStatus")).toEqual({
		status: "available",
		reason: null,
		configured: true,
		credentialSource: "env",
		savedConfigured: true,
	});
	const start = t.requests.length;
	expectRead(await invoke(t, "cloudRead", { path: notePath }), notePath, noteText);
	expect(t.requests.slice(start).map(({ passwordUsed }) => passwordUsed)).toEqual(["none", "env"]);
	vi.stubEnv("DRONE_WEBDAV_PASSWORD", secrets.wrongEnv);
	const wrongStart = t.requests.length;
	expect(await invoke(t, "cloudProbe")).toEqual({ status: "failed", reason: "unauthorized" });
	expect(t.requests.slice(wrongStart).map(({ passwordUsed }) => passwordUsed)).toEqual(["none", "wrongEnv"]);
	vi.stubEnv("DRONE_WEBDAV_PASSWORD", undefined);
	t.accepted = "saved";
}

async function pullIntoVault(t) {
	const path = "Inbox/remote.md";
	const text = "# Synthetic remote note\nByte-identical pull: \u03b1.\n";
	seedNote(t, path, text);
	const preview = await invoke(t, "cloudRead", { path });
	expectRead(preview, path, text);
	const input = {
		mode: "pull",
		bindingRevision: t.knowledgeBinding.revision,
		paths: [path],
		previews: [
			{ path, localHash: null, remoteHash: preview.result.hash, remoteVersion: preview.result.version },
		],
	};
	const approvalStart = t.approvals.length;
	expect(await invoke(t, "cloudSync", input)).toEqual({
		status: "ok",
		result: {
			mode: "pull",
			completed: true,
			warnings: ["selected_notes_only"],
			items: [
				{
					path,
					status: "pulled",
					localHash: sha256(text),
					remoteVersion: preview.result.version,
					reason: "index_pending",
				},
			],
		},
	});
	expect(await readFile(join(t.vault, path))).toEqual(Buffer.from(text));
	expect(
		t.approvals.slice(approvalStart).some(({ operation }) => operation === "capability:files.writeText"),
	).toBe(true);
	await readOnlyVault(t, input, text);
	expect(await readFile(join(t.vault, path))).toEqual(Buffer.from(text));
}

async function readOnlyVault(t, input, text) {
	await t.bridge.revoke("knowledge");
	t.writable = false;
	t.binding = await t.bridge.bind("knowledge", t.window);
	const blockedPath = "Inbox/readonly.md";
	seedNote(t, blockedPath, text);
	const blockedPreview = await invoke(t, "cloudRead", { path: blockedPath });
	expectRead(blockedPreview, blockedPath, text);
	expect(
		await invoke(t, "cloudSync", {
			...input,
			paths: [blockedPath],
			previews: [
				{
					path: blockedPath,
					localHash: null,
					remoteHash: blockedPreview.result.hash,
					remoteVersion: blockedPreview.result.version,
				},
			],
		}),
	).toEqual({
		status: "ok",
		result: {
			mode: "pull",
			completed: false,
			warnings: ["selected_notes_only"],
			items: [
				{
					path: blockedPath,
					status: "failed",
					localHash: null,
					remoteVersion: blockedPreview.result.version,
					reason: "forbidden",
				},
			],
		},
	});
	await expect(readFile(join(t.vault, blockedPath))).rejects.toMatchObject({ code: "ENOENT" });
}

it.skipIf(!tarball)(
	"installed knowledge WebDAV: phases 1–8 authenticate, approve, pull and contain credentials",
	async () => {
		const t = await packedFixture();
		try {
			await installPackedKnowledge(t, tarball);
			await startHost(t);
			await missingCredentials(t); // 1: no network while unconfigured.
			await savedDigest(t); // 2: challenge reuse across operation calls.
			await writeApproval(t); // 3: deny before IO, then mutate and read back.
			await basicChallenge(t); // 4: Basic only after a challenge on a fresh scope.
			await environmentOverride(t); // 5: env takes precedence with no saved fallback.
			await pullIntoVault(t); // 6: real writable Vault versus a read-only grant.
			assertNoLeaks(t); // 7: also checked after cleanup, including failures.
			expect(t.fetchCalls.length).toBeGreaterThan(0);
			assertFetchConfined(t); // 8: only the declared origin is rewritten.
		} catch (error) {
			t.errors.push(String(error));
			throw error;
		}
	},
	120000,
);
