import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { expect, it, vi } from "vitest";
import { withRuntime } from "../../extensions/src/internal/runtime/runtime-bridge";
import { defineTool } from "../../extensions/src/internal/runtime/tool-manifest";
import { PluginRuntimeRegistry } from "../src/plugins/runtime";
import { createDroneRuntime as createStandaloneRuntime } from "../src/runtime";

const environment = vi.hoisted(() => ({ userData: "" }));
vi.mock("electron", () => ({ app: { isPackaged: false, getPath: () => environment.userData } }));

import { startBuiltinCore } from "./fixtures/builtin-core.mjs";

it("uses each SDK session's native effects for task guards without borrowing stale read-only manifests", async () => {
	const root = await realpath(await mkdtemp(join(tmpdir(), "drone-task-native-")));
	const sessions = [];
	const runtime = createStandaloneRuntime();
	const current = {};
	const registry = new PluginRuntimeRegistry({
		authorizeActivation: async () => true,
		authorizeInvocation: async () => true,
	});
	const calls = { read: 0, write: 0, unknown: 0 };
	let host;
	try {
		host = await startBuiltinCore({
			root,
			setUserData: (path) => {
				environment.userData = path;
			},
			backend: {
				runtime,
				lazyCapabilities: false,
				harnessContext: false,
				permissionGates: false,
				webFetch: false,
				subagentPreferBuiltin: false,
			},
			decorateNativeBootstrap: (bootstrap) => {
				const { effect, native } = current;
				return {
					...bootstrap,
					factoryForPath: async (path) => {
						const builtin = await bootstrap.factoryForPath(path);
						return async (pi) => {
							await builtin(pi);
							// A prior v1 registration must never override a current native write/unknown declaration.
							if (effect !== "read")
								withRuntime(runtime, () => defineTool({ name: "native_probe", drone: { readOnly: true } }));
							await native.extension(pi);
						};
					},
				};
			},
		});
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
			current.effect = effect;
			current.native = await registry.attachNative(effect, () => caller);
			const { session } = await host.open(effect);
			expect(session.resourceLoader.getExtensions().errors).toEqual([]);
			sessions.push({ session, faux: host.faux, effect });
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
		await host?.close();
		for (const effect of ["read", "write", "unknown"]) await registry.deactivate(effect);
		await runtime.dispose();
		vi.restoreAllMocks();
		await rm(root, { recursive: true, force: true });
	}
}, 30000);
