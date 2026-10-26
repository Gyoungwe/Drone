/** Opt-in artifact acceptance; see docs/pluginization/packed-knowledge-runtime-acceptance.md. */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import {
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { expect, it } from "vitest";
import { PluginRuntimeBridge } from "../src/plugins/coordinator";
import { fileCapabilityHandlers, PluginFileCapabilities } from "../src/plugins/file-capabilities";
import { createProcessPluginRuntime } from "../src/plugins/process-runtime";
import { PluginResourceManager } from "../src/plugins/resource-capabilities";
import { getPluginSessionCaller } from "../src/plugins/session-caller";
import { canonicalProjectId } from "../src/project-id";
import { SessionRegistry } from "../src/session/registry";
import { SessionEngine } from "../src/session-engine/engine";

const run = promisify(execFile);
const tarball = process.env.DRONE_KNOWLEDGE_TARBALL;
const runtimeDirectory = resolve(
	process.env.DRONE_PLUGIN_RUNTIME_DIRECTORY ??
		join(import.meta.dirname, `../../desktop/plugin-runtime/${process.platform}-${process.arch}`),
);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function declaredPath(packageRoot, entry) {
	expect(typeof entry).toBe("string");
	expect(isAbsolute(entry)).toBe(false);
	const path = await realpath(resolve(packageRoot, entry));
	const local = relative(packageRoot, path);
	expect(local === ".." || local.startsWith(`..${sep}`) || isAbsolute(local)).toBe(false);
	return path;
}

/** Only census this freshly installed package, never another running application or Vault. */
async function packageChildren(packageRoot) {
	const { stdout } = await run("ps", ["-axo", "pid=,ppid=,command="]);
	return stdout
		.split("\n")
		.filter((line) => line.includes(`--allow-fs-read=${packageRoot}`))
		.map((line) => {
			const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
			if (!match) throw new Error("Unexpected process census row");
			return {
				pid: Number(match[1]),
				ppid: Number(match[2]),
				resource: match[3].includes("--allow-fs-write="),
			};
		})
		.sort((a, b) => a.pid - b.pid);
}

it.skipIf(!tarball)(
	"installed knowledge tarball shares its owner with real read-only SDK tools and releases both processes",
	async () => {
		if (process.platform === "win32") throw new Error("This artifact census requires a POSIX host with ps");
		const artifact = await realpath(tarball);
		const root = await realpath(await mkdtemp(join(tmpdir(), "drone-packed-knowledge-")));
		const prefix = join(root, "installed");
		const state = join(root, "state");
		const vault = join(root, "Vault");
		const workspace = join(root, "WorkspaceMixedCase");
		const cache = join(root, "cache");
		const leases = join(root, "leases");
		const agentDir = join(root, "agent");
		const controlsRoot = join(root, "effect-controls");
		for (const path of [prefix, state, vault, workspace, cache, leases, agentDir, controlsRoot])
			await mkdir(path);
		let bridge;
		let bootstrap;
		let session;
		let packageRoot;
		let receipt;
		let failure;
		const cleanup = [];
		let stage = "clean-install";
		const sessions = new SessionRegistry();
		try {
			await run(
				"npm",
				[
					"install",
					"--prefix",
					prefix,
					"--ignore-scripts",
					"--omit=peer",
					"--no-audit",
					"--no-fund",
					"--registry=https://registry.npmjs.org",
					artifact,
				],
				{ maxBuffer: 8 * 1024 * 1024 },
			);
			const lock = JSON.parse(await readFile(join(prefix, "package-lock.json"), "utf8"));
			const installed = Object.entries(lock.packages).find(([, value]) =>
				value.resolved?.startsWith("file:"),
			);
			expect(installed, "local tarball must have a clean-install lock receipt").toBeDefined();
			packageRoot = await realpath(join(prefix, installed[0]));
			const pkg = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
			const manifest = JSON.parse(await readFile(join(packageRoot, "plugin.manifest.json"), "utf8"));
			const source = {
				pluginId: manifest.id,
				packageRoot,
				entrypoint: await declaredPath(packageRoot, manifest.entrypoints.desktopRuntime),
				nativeEntrypoint: await declaredPath(packageRoot, manifest.entrypoints.extension),
				resources: Object.fromEntries(
					await Promise.all(
						Object.entries(manifest.entrypoints.resources).map(async ([name, path]) => [
							name,
							await declaredPath(packageRoot, path),
						]),
					),
				),
			};
			expect(await Promise.all(pkg.pi.extensions.map((path) => declaredPath(packageRoot, path)))).toContain(
				source.nativeEntrypoint,
			);
			await mkdir(join(vault, "Library/Methods"), { recursive: true });
			await writeFile(
				join(state, "binding.json"),
				JSON.stringify({
					version: 1,
					vault,
					vaultId: sha256(vault).slice(0, 24),
					revision: 1,
					profile: "hybrid",
					depositMode: "verified",
					subagentPolicy: "none",
					updatedAt: new Date().toISOString(),
				}),
			);
			await writeFile(join(vault, "Library/Methods/orchid.md"), "# Orchid method\nOrchid assay evidence.\n");

			// Separate negative controls. The installed knowledge artifact remains byte-for-byte untouched.
			const controls = {
				pluginId: "acceptance-effect-controls",
				packageRoot: controlsRoot,
				entrypoint: join(controlsRoot, "runtime.mjs"),
				nativeEntrypoint: join(controlsRoot, "extension.mjs"),
			};
			await writeFile(
				controls.nativeEntrypoint,
				'throw new Error("control must use managed native loading");',
			);
			await writeFile(
				controls.entrypoint,
				`export default async()=>{let executed=0;return {
 operations:{count:{inputSchema:{type:"null"},resultSchema:{type:"number"},effect:"read",execute:async()=>executed}},
 createNativeSession:()=>({toolEffects:{effect_probe_write:"write"},extension(pi){for(const name of ["effect_probe_unknown","effect_probe_write"])pi.registerTool({name,label:name,description:"Negative authorization control",parameters:{type:"object",properties:{}},async execute(){executed++;return {content:[{type:"text",text:"unexpected execution"}]};}});},dispose:async()=>{}}),dispose:async()=>{}};};`,
			);
			const sources = new Map([
				["knowledge-artifact", source],
				["effect-controls", controls],
			]);
			const approvals = [];
			const capabilityScopes = [];
			bridge = new PluginRuntimeBridge({
				source: (name) => sources.get(name),
				enabled: () => true,
				factory: (value) => createProcessPluginRuntime({ ...value, runtimeDirectory }),
				approve: async (_owner, value, operation) => {
					approvals.push({ pluginId: value.pluginId, operation: operation ?? null });
					return true;
				},
				getSessionContext: (id) => getPluginSessionCaller(sessions, id),
				capabilities:
					(value) =>
					async ({ pluginId, applicationId, signal, events }) => {
						if (value === controls) return { resources: [], handlers: {} };
						const files = await PluginFileCapabilities.create(
							[
								{ handle: "state", path: state, kind: "state", scope: { kind: "application" } },
								{ handle: "vault", path: vault, kind: "files", scope: { kind: "application" } },
								{
									handle: "workspace",
									path: workspace,
									kind: "files",
									scope: { kind: "workspace", workspaceId: canonicalProjectId(workspace) },
								},
							],
							cache,
						);
						const resources = new PluginResourceManager({
							pluginId,
							applicationId,
							packageRoot,
							entries: source.resources,
							runtimeDirectory,
							files,
							signal,
							events,
							leaseDirectory: leases,
						});
						const handlers = Object.fromEntries(
							Object.entries({ ...fileCapabilityHandlers(files), ...resources.handlers() }).map(
								([name, handler]) => [
									name,
									{
										...handler,
										execute: (input, context) => {
											capabilityScopes.push({ name, scope: context.scope, bootstrap: context.bootstrap });
											return handler.execute(input, context);
										},
									},
								],
							),
						);
						return {
							handlers,
							resources: [{ kind: "state", handle: "state" }],
							dispose: () => resources.dispose(),
						};
					},
			});
			const window = { id: 1, isDestroyed: () => false };
			const binding = await bridge.bind("knowledge-artifact", window);
			const application = bridge.selectSession(window, null);
			stage = "application-overview";
			const overview = await bridge.invoke(window, binding, "overview", null, application);
			expect(overview.index.noteCount).toBe(1);
			const processes = await packageChildren(packageRoot);
			expect(processes).toHaveLength(2);
			expect(processes.filter((child) => child.resource)).toHaveLength(1);
			expect(processes.every((child) => child.ppid === process.pid)).toBe(true);
			const uiSearch = await bridge.invoke(
				window,
				binding,
				"search",
				{ query: "Orchid", revision: overview.binding.revision },
				application,
			);
			expect(uiSearch.hits[0].path).toBe("Library/Methods/orchid.md");

			stage = "real-readonly-sdk-session";
			bootstrap = bridge.beginNative(
				window,
				(path) => [...sources].find(([, value]) => value.nativeEntrypoint === path)?.[0],
			);
			const settingsManager = SettingsManager.inMemory({});
			const resourceLoader = new DefaultResourceLoader({
				cwd: workspace,
				agentDir,
				settingsManager,
				noExtensions: true,
				noSkills: true,
				noPromptTemplates: true,
				noContextFiles: true,
				additionalExtensionPaths: [...sources.values()].map((value) => value.nativeEntrypoint),
				extensionFactoryForPath: bootstrap.factoryForPath,
			});
			await resourceLoader.reload({ resolveProjectTrust: async () => true });
			expect(resourceLoader.getExtensions().errors).toEqual([]);
			const modelRuntime = await ModelRuntime.create({
				authPath: join(agentDir, "auth.json"),
				modelsPath: null,
				allowModelNetwork: false,
				refreshOnCreate: false,
			});
			const faux = fauxProvider({ provider: "packed-knowledge-offline", tokensPerSecond: 0 });
			modelRuntime.registerNativeProvider(faux.provider);
			await modelRuntime.setRuntimeApiKey("packed-knowledge-offline", "synthetic-offline-only");
			faux.setResponses([
				fauxAssistantMessage(
					[
						fauxToolCall("knowledge_status", {}),
						fauxToolCall("knowledge_search", { query: "Orchid" }),
						fauxToolCall("effect_probe_unknown", {}),
						fauxToolCall("effect_probe_write", {}),
					],
					{ stopReason: "toolUse" },
				),
				fauxAssistantMessage("Read-only acceptance finished."),
			]);
			({ session } = await createAgentSession({
				cwd: workspace,
				agentDir,
				settingsManager,
				resourceLoader,
				modelRuntime,
				sessionManager: SessionManager.inMemory(workspace),
				model: faux.getModel(),
			}));
			sessions.add({ session, cwd: workspace, readOnly: true, unsubscribe: () => {} });
			bootstrap.bindSession(session.sessionId);
			const errors = [];
			await session.bindExtensions({ onError: (error) => errors.push(error) });
			const selection = bridge.selectSession(window, session.sessionId);
			expect(getPluginSessionCaller(sessions, session.sessionId).scope.workspaceDirectory).toBe(workspace);
			expect(getPluginSessionCaller(sessions, session.sessionId).readOnly).toBe(true);
			await session.prompt(
				"Check knowledge status and search Orchid, then execute the two negative controls.",
			);
			await session.waitForIdle();
			expect(errors).toEqual([]);
			const results = session.messages.filter((message) => message.role === "toolResult");
			for (const name of ["knowledge_status", "knowledge_search"])
				expect(results.find((result) => result.toolName === name)?.isError, name).toBe(false);
			expect(results.find((result) => result.toolName === "knowledge_search").details.hits[0].path).toBe(
				uiSearch.hits[0].path,
			);
			for (const name of ["effect_probe_unknown", "effect_probe_write"]) {
				const result = results.find((value) => value.toolName === name);
				expect(result?.isError, name).toBe(true);
				expect(result.content[0].text).toContain("Plugin operation denied");
			}
			const controlBinding = await bridge.bind("effect-controls", window);
			expect(await bridge.invoke(window, controlBinding, "count", null, selection)).toBe(0);
			await expect(bridge.invoke(window, binding, "not_registered", null, selection)).rejects.toThrow(
				"not registered",
			);
			expect(approvals.every((approval) => approval.operation === null)).toBe(true);
			expect(
				capabilityScopes.some(
					(call) => call.scope.kind === "session" && call.scope.sessionId === session.sessionId,
				),
			).toBe(true);
			expect(await packageChildren(packageRoot)).toEqual(processes);
			await writeFile(join(vault, "Library/Methods/willow.md"), "# Willow method\nWillow assay evidence.\n");
			stage = "selected-session-ui-refresh";
			const refreshed = await bridge.invoke(
				window,
				binding,
				"search",
				{ query: "Willow", revision: overview.binding.revision },
				selection,
			);
			expect(refreshed.hits[0].path).toBe("Library/Methods/willow.md");
			stage = "sdk-version-evidence";
			// Resolve the installed ESM package in Node; Vitest's transformed import.meta omits resolve.
			const { stdout: sdkPackageUrl } = await run(
				process.execPath,
				[
					"--input-type=module",
					"-e",
					'process.stdout.write(new URL("../package.json", import.meta.resolve("@earendil-works/pi-coding-agent")).href)',
				],
				{ cwd: import.meta.dirname },
			);
			const sdk = JSON.parse(await readFile(new URL(sdkPackageUrl), "utf8"));
			expect(sdk.version).toBe("1.1.0");
			receipt = {
				status: "PASS",
				tarballSha256: sha256(await readFile(artifact)),
				package: pkg.name,
				version: pkg.version,
				manifestId: manifest.id,
				sdk: sdk.version,
				model: "faux-offline",
				actualReadOnlySession: true,
				tools: results.map((result) => ({ name: result.toolName, error: result.isError })),
				sameOwnerProcesses: processes,
				uiOverviewNotes: overview.index.noteCount,
				searchMatchesNative: true,
				refresh: true,
				unknownAndWriteExecuted: 0,
				fullHooksAndPublication: "NOT_IMPLEMENTED",
			};
		} catch (error) {
			failure = new Error(`Packed knowledge acceptance failed at ${stage}`, { cause: error });
			if (process.env.DRONE_KNOWLEDGE_EVIDENCE) {
				const path = `${resolve(process.env.DRONE_KNOWLEDGE_EVIDENCE)}.failure.json`;
				await mkdir(dirname(path), { recursive: true });
				await writeFile(
					path,
					`${JSON.stringify({ status: "FAIL", stage, error: String(error), tarballSha256: sha256(await readFile(artifact)), workspaceId: canonicalProjectId(workspace), workspaceDirectory: workspace }, null, 2)}\n`,
				);
			}
		} finally {
			// Attempt every cleanup phase; a failed assertion must not strand resource workers or leases.
			if (session) {
				sessions.revoke(session.sessionId);
				cleanup.push(...(await Promise.allSettled([new SessionEngine().dispose(session)])));
				sessions.delete(session.sessionId);
			}
			cleanup.push(...(await Promise.allSettled([bootstrap?.dispose()])));
			cleanup.push(...(await Promise.allSettled([bridge?.close()])));
			cleanup.push(
				...(await Promise.allSettled([
					(async () => {
						if (packageRoot) expect(await packageChildren(packageRoot)).toEqual([]);
						expect(await packageChildren(controlsRoot)).toEqual([]);
						for (const namespace of await readdir(leases))
							expect(await readdir(join(leases, namespace))).toEqual([]);
					})(),
				])),
			);
			cleanup.push(...(await Promise.allSettled([rm(root, { recursive: true, force: true })])));
		}
		const failures = cleanup.filter((result) => result.status === "rejected");
		if (failures.length)
			throw new AggregateError(
				[...(failure ? [failure] : []), ...failures.map((result) => result.reason)],
				"Packed knowledge cleanup failed",
			);
		if (failure) throw failure;
		const evidence = { ...receipt, childrenExited: true, reservationsReleased: true };
		if (process.env.DRONE_KNOWLEDGE_EVIDENCE) {
			const path = resolve(process.env.DRONE_KNOWLEDGE_EVIDENCE);
			await mkdir(dirname(path), { recursive: true });
			await writeFile(path, `${JSON.stringify(evidence, null, 2)}\n`);
		}
		console.log(JSON.stringify(evidence));
	},
	120000,
);
