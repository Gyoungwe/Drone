import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { expect, it, vi } from "vitest";
import { discoverInstalledPackages } from "../../desktop/src/main/ui-plugins/installed-package-sources";
import { PiBackend } from "../src/pi-backend";
import { PluginRuntimeBridge } from "../src/plugins/coordinator";
import { getPluginSessionCaller } from "../src/plugins/session-caller";

it("an actually selected required but unavailable owner keeps SDK read and private next-provider protocol while final delivery stays closed", async () => {
	const root = await realpath(await mkdtemp(join(tmpdir(), "drone-native-fallback-sdk-")));
	const cwd = join(root, "project"),
		agentDir = join(root, "agent");
	await mkdir(cwd);
	await mkdir(agentDir);
	await writeFile(join(cwd, "input.txt"), "Actual read input retained.\n");
	vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
	vi.stubEnv("DRONE_KNOWLEDGE_DIR", join(root, "knowledge"));
	vi.stubEnv("PI_RESEARCH_DESKTOP_CONFIG", undefined);
	const modelRuntime = await ModelRuntime.create({
		authPath: join(agentDir, "auth.json"),
		modelsPath: null,
		allowModelNetwork: false,
		refreshOnCreate: false,
	});
	const provider = fauxProvider({ provider: "native-fallback-sdk", tokensPerSecond: 0 });
	modelRuntime.registerNativeProvider(provider.provider);
	await modelRuntime.setRuntimeApiKey(provider.provider.id, "synthetic-offline-only");
	const modules = join(root, "node_modules"),
		packageRoot = join(modules, "required-owner");
	await mkdir(packageRoot, { recursive: true });
	await writeFile(
		join(root, "package.json"),
		JSON.stringify({ dependencies: { "required-owner": "1.0.0" } }),
	);
	await writeFile(
		join(packageRoot, "package.json"),
		JSON.stringify({ name: "required-owner", version: "1.0.0" }),
	);
	await writeFile(
		join(packageRoot, "plugin.manifest.json"),
		JSON.stringify({
			hosts: ["drone-desktop"],
			entrypoints: { extension: "./native.mjs", desktopRuntime: "./runtime.mjs" },
			drone: { deliveryProjection: "required" },
		}),
	);
	for (const name of ["native.mjs", "runtime.mjs"])
		await writeFile(
			join(packageRoot, name),
			'throw new Error("UNAVAILABLE_MANAGED_ENTRY_MUST_NOT_EXECUTE");',
		);
	const [installed] = await discoverInstalledPackages(modules);
	expect(installed.runtime).toMatchObject({
		deliveryProjection: "required",
		contentHash: expect.any(String),
	});
	const source = installed.runtime;
	let activated = 0,
		bootstrap,
		backend;
	const bridge = new PluginRuntimeBridge({
		getSessionContext: (id) => getPluginSessionCaller(backend.registry, id),
		source: () => source,
		sources: () => [{ name: "installed", source, state: "unavailable" }],
		classifySelectedPath: (path) =>
			path === source.nativeEntrypoint
				? { kind: "managed", source, state: "unavailable" }
				: { kind: "unconfirmed" },
		enabled: () => false,
		approve: async () => true,
		factory: () => {
			activated++;
			throw new Error("Unavailable owner must not activate");
		},
		capabilities: () => ({ resources: [], handlers: {} }),
	});
	backend = new PiBackend({
		projectTrust: false,
		permissionGates: false,
		lazyCapabilities: false,
		tools: ["read"],
		desktopIntegration: {
			appendSystemPrompt: [],
			additionalSkillPaths: [],
			additionalExtensionPaths: [source.nativeEntrypoint],
			noExtensions: true,
			noSkills: true,
			noPromptTemplates: true,
			noContextFiles: true,
			pluginRuntimeDirectory: join(root, "unused-runtime"),
			nativeRuntime: {
				manages: (path) => path === source.nativeEntrypoint,
				begin: () =>
					(bootstrap = bridge.beginNative({ id: 101, isDestroyed: () => false }, () => "installed")),
			},
		},
	});
	const observed = [];
	backend.modelRuntime = modelRuntime;
	const stop = backend.onEvent((_id, event) => {
		if (event.type === "message_end") observed.push(structuredClone(event.message));
	});
	const draft = "UNPUBLISHED_FINAL_DRAFT_WITHOUT_HOST_PROOF";
	try {
		const meta = await backend.createSession({
			cwd,
			provider: provider.provider.id,
			modelId: provider.getModel().id,
		});
		const session = backend.registry.get(meta.sessionId).session;
		const protocol = [
			{ type: "text", text: "PRIVATE_PROGRESS_BEFORE_READ" },
			{
				type: "thinking",
				thinking: "PRIVATE_SIGNED_THINKING",
				thinkingSignature: "provider-thinking-signature",
			},
			fauxToolCall("read", { path: "input.txt" }),
		];
		const providerHistory = [];
		provider.setResponses([
			Object.assign(
				fauxAssistantMessage(protocol, { stopReason: "toolUse", responseId: "actual-provider-call" }),
				{
					responseModel: "served-model-version",
					providerThinkingLevel: "low",
					thinkingLevel: "low",
					diagnostics: [
						{
							type: "provider-warning",
							timestamp: 123,
							error: {
								message:
									"Retry https://example.test/result?token=query-private Authorization: Bearer header-private",
								stack: "STACK_PRIVATE",
							},
							details: { headers: { authorization: "DETAIL_HEADER_PRIVATE" } },
						},
					],
					rawStopReason: "tool_use",
					endTurn: false,
				},
			),
			(context) => {
				providerHistory.push(structuredClone(context.messages));
				return fauxAssistantMessage(draft, { responseId: "actual-provider-final" });
			},
		]);
		await session.prompt("Read input.txt and explain its bounded result.");
		await session.waitForIdle();
		expect(session.messages.find((message) => message.role === "toolResult")).toMatchObject({
			toolName: "read",
			isError: false,
			content: [expect.objectContaining({ text: "Actual read input retained.\n" })],
		});
		const toolMessage = session.messages.find(
			(message) => message.role === "assistant" && message.stopReason === "toolUse",
		);
		expect(toolMessage).toMatchObject({
			responseId: "actual-provider-call",
			responseModel: "served-model-version",
			providerThinkingLevel: "low",
			thinkingLevel: session.thinkingLevel,
			rawStopReason: "tool_use",
			endTurn: false,
			api: provider.getModel().api,
			provider: provider.provider.id,
			model: provider.getModel().id,
			content: [
				expect.objectContaining({ type: "toolCall", name: "read", arguments: { path: "input.txt" } }),
			],
		});
		expect(toolMessage.usage.input).toBeGreaterThan(0);
		expect(providerHistory).toHaveLength(1);
		expect(providerHistory[0].find((message) => message.role === "assistant").content).toEqual(protocol);
		expect(toolMessage.diagnostics).toBeUndefined();
		const final = session.messages.filter((message) => message.role === "assistant").at(-1);
		expect(final).toMatchObject({
			responseId: "actual-provider-final",
			api: provider.getModel().api,
			provider: provider.provider.id,
			model: provider.getModel().id,
		});
		expect(final.usage.input).toBeGreaterThan(0);
		expect(final).toMatchObject({
			stopReason: "aborted",
			errorMessage: "Final delivery unavailable",
			content: [],
		});
		expect(activated).toBe(0);
		expect(session.resourceLoader.getExtensions().errors).toMatchObject([
			{
				path: source.nativeEntrypoint,
				error: expect.stringContaining("Native extension source is not enabled"),
			},
		]);
		const persisted = await readFile(session.sessionFile, "utf8");
		for (const visible of [JSON.stringify(session.messages), JSON.stringify(observed), persisted]) {
			expect(visible).not.toContain(draft);
			expect(visible).not.toContain("PRIVATE_PROGRESS_BEFORE_READ");
			expect(visible).not.toMatch(
				/PRIVATE_SIGNED_THINKING|query-private|header-private|STACK_PRIVATE|DETAIL_HEADER_PRIVATE/,
			);
		}
		expect(observed.find((message) => message.stopReason === "toolUse").usage).toEqual(toolMessage.usage);
	} finally {
		stop();
		await backend.dispose();
		await bootstrap?.dispose();
		await bridge.close();
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
		await rm(root, { recursive: true, force: true });
	}
}, 20000);
