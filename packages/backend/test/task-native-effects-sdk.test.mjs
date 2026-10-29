import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import {
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { expect, it, vi } from "vitest";
import { withRuntime } from "../../extensions/src/internal/runtime/runtime-bridge";
import { defineTool } from "../../extensions/src/internal/runtime/tool-manifest";
import { PluginRuntimeRegistry } from "../src/plugins/runtime";
import { createDroneRuntime as createStandaloneRuntime } from "../src/runtime";
import { SessionEngine } from "../src/session-engine/engine";
import { registerTaskRuntime } from "./fixtures/task-plugin.mjs";

it("uses each SDK session's native effects for task guards without borrowing stale read-only manifests", async () => {
	const root = await realpath(await mkdtemp(join(tmpdir(), "drone-task-native-")));
	const sessions = [],
		runtimes = [];
	const registry = new PluginRuntimeRegistry({
		authorizeActivation: async () => true,
		authorizeInvocation: async () => true,
	});
	const calls = { read: 0, write: 0, unknown: 0 };
	try {
		for (const effect of ["read", "write", "unknown"]) {
			registry.register(effect, async () => ({
				operations: {},
				async dispose() {},
				createNativeSession: async () => ({
					toolEffects: effect === "unknown" ? {} : { native_probe: effect },
					extension(pi) {
						pi.registerTool({
							name: "native_probe",
							label: "Probe",
							description: "Read a local test receipt",
							parameters: { type: "object", properties: {} },
							annotations: { readOnlyHint: true },
							drone: { readOnly: true },
							async execute() {
								calls[effect]++;
								return { content: [{ type: "text", text: `${effect} receipt` }] };
							},
						});
					},
					async dispose() {},
				}),
			}));
			const caller = { identity: {}, signal: new AbortController().signal, scope: { kind: "application" } };
			await registry.activate(effect, () => caller);
			const native = await registry.attachNative(effect, () => caller);
			const runtime = createStandaloneRuntime();
			runtimes.push(runtime);
			const extension = async (pi) => {
				pi.events.on("drone:runtime/request/v1", () =>
					pi.events.emit("drone:runtime/v1", { version: 1, runtime }),
				);
				await registerTaskRuntime(pi);
				// A prior v1 registration must never override a current native write/unknown declaration.
				if (effect !== "read")
					withRuntime(runtime, () => defineTool({ name: "native_probe", drone: { readOnly: true } }));
				await native.extension(pi);
			};
			const settingsManager = SettingsManager.inMemory({});
			const resourceLoader = new DefaultResourceLoader({
				cwd: root,
				agentDir: root,
				settingsManager,
				noExtensions: true,
				noSkills: true,
				noPromptTemplates: true,
				extensionFactories: [extension],
			});
			await resourceLoader.reload({ resolveProjectTrust: async () => true });
			expect(resourceLoader.getExtensions().errors).toEqual([]);
			const modelRuntime = await ModelRuntime.create({
				authPath: join(root, `auth-${effect}.json`),
				modelsPath: null,
				allowModelNetwork: false,
				refreshOnCreate: false,
			});
			const faux = fauxProvider({ provider: `task-native-${effect}`, tokensPerSecond: 0 });
			modelRuntime.registerNativeProvider(faux.provider);
			vi.spyOn(modelRuntime, "hasConfiguredAuth").mockReturnValue(true);
			const { session } = await createAgentSession({
				cwd: root,
				agentDir: root,
				settingsManager,
				resourceLoader,
				modelRuntime,
				sessionManager: SessionManager.inMemory(root),
				model: faux.getModel(),
			});
			sessions.push({ session, faux, effect });
			await session.bindExtensions({});
		}
		// Keep all sessions alive simultaneously; same name has three different effective declarations.
		for (const { session, faux, effect } of sessions) {
			expect(
				session.getAllTools().find((tool) => tool.name === "native_probe").annotations.readOnlyHint,
			).toBe(effect === "read");
			faux.setResponses([
				fauxAssistantMessage(fauxToolCall("native_probe", {})),
				fauxAssistantMessage("done"),
			]);
			await session.prompt("Read the receipt, without creating a task plan.");
			await session.waitForIdle();
			const result = session.messages.find(
				(message) => message.role === "toolResult" && message.toolName === "native_probe",
			);
			expect(result?.isError, JSON.stringify(result)).toBe(effect !== "read");
			if (effect !== "read") expect(result.content[0].text).toContain("No approved task plan");
		}
		expect(calls).toEqual({ read: 1, write: 0, unknown: 0 });
		const { session, faux } = sessions[0];
		faux.setResponses([fauxAssistantMessage(fauxToolCall("native_probe", {})), fauxAssistantMessage("done")]);
		await session.prompt("Read the receipt again.");
		await session.waitForIdle();
		expect(calls.read).toBe(2);
	} finally {
		for (const { session } of sessions) await new SessionEngine().dispose(session);
		for (const effect of ["read", "write", "unknown"]) await registry.deactivate(effect);
		for (const runtime of runtimes) await runtime.dispose();
		vi.restoreAllMocks();
		await rm(root, { recursive: true, force: true });
	}
}, 30000);
