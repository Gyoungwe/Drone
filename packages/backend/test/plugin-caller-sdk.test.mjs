import { mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { expect, it, vi } from "vitest";
import { PluginRuntimeRegistry } from "../src/plugins/runtime";
import { getPluginSessionCaller } from "../src/plugins/session-caller";
import { canonicalProjectId } from "../src/project-id";
import { SessionRegistry } from "../src/session/registry";
import { SessionEngine } from "../src/session-engine/engine";

it("derives caller identity, workspace and revocation from a real AgentSession entry", async () => {
	const root = await realpath(await mkdtemp(join(tmpdir(), "drone-caller-sdk-")));
	const alias = `${root}-alias`;
	await symlink(root, alias, "dir");
	const registry = new SessionRegistry();
	let session;
	try {
		const settingsManager = SettingsManager.inMemory({});
		const loader = new DefaultResourceLoader({
			cwd: root,
			agentDir: root,
			settingsManager,
			noExtensions: true,
			noSkills: true,
			noPromptTemplates: true,
		});
		await loader.reload({ resolveProjectTrust: async () => true });
		const modelRuntime = await ModelRuntime.create({
			authPath: join(root, "auth.json"),
			modelsPath: null,
			allowModelNetwork: false,
			refreshOnCreate: false,
		});
		({ session } = await createAgentSession({
			cwd: root,
			agentDir: root,
			settingsManager,
			resourceLoader: loader,
			modelRuntime,
			sessionManager: SessionManager.inMemory(root),
		}));
		const entry = { session, cwd: alias, unsubscribe: vi.fn() };
		registry.add(entry);
		const caller = getPluginSessionCaller(registry, session.sessionId);
		expect(caller.identity).toBe(entry);
		expect(caller.scope).toEqual({
			kind: "session",
			workspaceId: canonicalProjectId(root),
			workspaceDirectory: alias,
			sessionId: session.sessionId,
		});
		expect(caller.projectTrusted).toBe(settingsManager.isProjectTrusted());
		expect(caller.readOnly).toBe(false);
		entry.readOnly = true;
		expect(getPluginSessionCaller(registry, session.sessionId).readOnly).toBe(true);
		const factory = vi.fn(async () => ({
			operations: {
				scope: {
					inputSchema: { type: "null" },
					resultSchema: { type: "object" },
					effect: "read",
					execute: async (_input, { scope }) => scope,
				},
			},
			dispose: async () => {},
		}));
		const runtime = new PluginRuntimeRegistry({
			authorizeActivation: async () => true,
			authorizeInvocation: async () => true,
		});
		runtime.register("scope-probe", factory);
		const client = await runtime.activate("scope-probe", () =>
			getPluginSessionCaller(registry, session.sessionId),
		);
		expect(await client.invoke("scope", null)).toEqual(caller.scope);
		const replacement = { session, cwd: root, unsubscribe: vi.fn() };
		registry.add(replacement);
		expect(caller.signal.aborted).toBe(true);
		expect(getPluginSessionCaller(registry, session.sessionId).identity).toBe(replacement);
		registry.revoke(session.sessionId);
		expect(getPluginSessionCaller(registry, session.sessionId)).toBeUndefined();
		await expect(client.invoke("scope", null)).rejects.toThrow("no longer available");
		await runtime.deactivate("scope-probe");
		registry.delete(session.sessionId);
	} finally {
		if (session) await new SessionEngine().dispose(session);
		await rm(alias, { force: true });
		await rm(root, { recursive: true, force: true });
	}
}, 20000);
