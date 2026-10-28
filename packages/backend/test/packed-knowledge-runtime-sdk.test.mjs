/** Opt-in artifact acceptance; see docs/pluginization/packed-knowledge-runtime-acceptance.md. */
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { inspect, promisify } from "node:util";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import {
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { expect, it, vi } from "vitest";
import { SkillVisibility } from "../src/capabilities/resource-loader";
import { CapabilityRuntime } from "../src/capabilities/runtime";
import { PluginRuntimeBridge } from "../src/plugins/coordinator";
import { fileCapabilityHandlers, PluginFileCapabilities } from "../src/plugins/file-capabilities";
import { modelCapabilityHandlers } from "../src/plugins/model-capabilities";
import { createProcessPluginRuntime } from "../src/plugins/process-runtime";
import { PluginResourceManager } from "../src/plugins/resource-capabilities";
import { getPluginSessionCaller } from "../src/plugins/session-caller";
import { canonicalProjectId } from "../src/project-id";
import { SessionRegistry } from "../src/session/registry";
import { SessionEngine } from "../src/session-engine/engine";
import { StorageRegistry } from "../src/storage/registry";

const run = promisify(execFile);
const tarball = process.env.DRONE_KNOWLEDGE_TARBALL;
const apiTarball = process.env.DRONE_PLUGIN_API_TARBALL;
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
	"installed knowledge tarball shares one process owner for SDK reads and UI review writes, then releases both processes",
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
		let writeSession;
		let writeBootstrap;
		let packageRoot;
		let receipt;
		let failure;
		let sqliteReopened = 0;
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
					...(apiTarball ? [await realpath(apiTarball)] : []),
				],
				{ maxBuffer: 8 * 1024 * 1024 },
			);
			const lock = JSON.parse(await readFile(join(prefix, "package-lock.json"), "utf8"));
			const installed = Object.entries(lock.packages).find(
				([path, value]) => path.endsWith("/@gyoungwe/pi-knowledge") && value.resolved?.startsWith("file:"),
			);
			expect(installed, "local tarball must have a clean-install lock receipt").toBeDefined();
			packageRoot = await realpath(join(prefix, installed[0]));
			const pkg = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
			const manifest = JSON.parse(await readFile(join(packageRoot, "plugin.manifest.json"), "utf8"));
			const source = {
				pluginId: manifest.id,
				requestsModel: manifest.permissions?.network?.includes("configured-services") === true,
				requestsStateWrite: manifest.permissions?.filesystem?.includes("application-state-write") === true,
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
			const sharedNote = "Library/Methods/orchid.md";
			const currentNote = "Projects/alpha/Methods/alpha.md";
			const otherNote = "Projects/beta/Methods/beta.md";
			const currentText =
				`# Alpha method\n[[${sharedNote.slice(0, -3)}]]\n` +
				Array.from({ length: 120 }, (_, index) => `alphasentinel line ${index} ${"a".repeat(90)}`).join("\n");
			for (const directory of ["Library/Methods", "Projects/alpha/Methods", "Projects/beta/Methods"])
				await mkdir(join(vault, directory), { recursive: true });
			await mkdir(join(workspace, ".pi"));
			await writeFile(
				join(workspace, ".pi/research-workspace.json"),
				JSON.stringify({ knowledgeProjectId: "alpha" }),
			);
			await writeFile(
				join(state, "binding.json"),
				JSON.stringify({
					version: 1,
					vault,
					vaultId: sha256(vault).slice(0, 24),
					revision: 1,
					profile: "hybrid",
					depositMode: "verified",
					subagentPolicy: "read-local",
					updatedAt: new Date().toISOString(),
				}),
			);
			await writeFile(
				join(vault, sharedNote),
				`# Orchid method\nOrchid assay evidence.\n[[${currentNote.slice(0, -3)}]]\n[[${otherNote.slice(0, -3)}]]\n`,
			);
			await writeFile(join(vault, currentNote), currentText);
			await writeFile(
				join(vault, otherNote),
				`# Beta method\nprivatebetasentinel\n[[${sharedNote.slice(0, -3)}]]\n`,
			);

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
 createNativeSession:()=>({toolEffects:{effect_probe_write:"write"},extension(pi){for(const name of ["effect_probe_unknown","effect_probe_write"])pi.registerTool({name,label:name,description:"Negative authorization control",drone:{readOnly:true,capabilities:["knowledge"]},parameters:{type:"object",properties:{}},async execute(){executed++;return {content:[{type:"text",text:"unexpected execution"}]};}});},dispose:async()=>{}}),dispose:async()=>{}};};`,
			);
			const sources = new Map([
				["knowledge-artifact", source],
				["effect-controls", controls],
			]);
			const approvals = [];
			let grantStateWrite = false;
			let denyStateWrite = false;
			let grantFileWrite = false;
			let denyReviewWrites = false;
			let denyModelGeneration = false;
			let failNextReviewRecord = false;
			const storage = new StorageRegistry().register({
				id: "packed-plugin-state",
				path: state,
				owner: `plugin:${source.pluginId}`,
				schema: "plugin-owned",
				sensitivity: "private",
			});
			let stateReceipt = { status: "NOT_DECLARED" };
			const capabilityScopes = [];
			bridge = new PluginRuntimeBridge({
				source: (name) => sources.get(name),
				enabled: () => true,
				factory: (value) => createProcessPluginRuntime({ ...value, runtimeDirectory }),
				approve: async (_owner, value, operation) => {
					approvals.push({ pluginId: value.pluginId, operation: operation ?? null });
					return !(
						(denyStateWrite && operation === "setReviewPolicy") ||
						(denyReviewWrites && ["applyReview", "undoReview"].includes(operation)) ||
						(denyModelGeneration && operation === "capability:model.generate")
					);
				},
				getSessionContext: (id) => getPluginSessionCaller(sessions, id),
				capabilities:
					(value) =>
					async ({ pluginId, applicationId, signal, events }) => {
						if (value === controls) return { resources: [], handlers: {} };
						const files = await PluginFileCapabilities.create(
							[
								{
									handle: "state",
									path: state,
									kind: "state",
									scope: { kind: "application" },
									...(grantStateWrite
										? { stateWrite: { registry: storage, storageId: "packed-plugin-state" } }
										: {}),
								},
								{
									handle: "vault",
									path: vault,
									kind: "files",
									scope: { kind: "application" },
									...(grantFileWrite ? { fileWrite: true } : {}),
								},
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
							Object.entries({
								...fileCapabilityHandlers(files),
								...resources.handlers(),
								...(value.requestsModel
									? modelCapabilityHandlers({
											registry: sessions,
											getRuntime: async () => modelRuntime,
											getProfileModel: async () => undefined,
											getProfileThinking: async () => undefined,
										})
									: {}),
							}).map(([name, handler]) => [
								name,
								{
									...handler,
									execute: (input, context) => {
										capabilityScopes.push({ name, scope: context.scope, bootstrap: context.bootstrap });
										if (
											name === "state.writeJson" &&
											input.path.includes("/reviewed/") &&
											failNextReviewRecord
										) {
											failNextReviewRecord = false;
											throw new Error("Acceptance record persistence failure");
										}
										return handler.execute(input, context);
									},
								},
							]),
						);
						return {
							handlers,
							resources: [
								{ kind: "state", handle: "state", access: grantStateWrite ? "read-write" : "read" },
								{ kind: "files", handle: "vault", access: grantFileWrite ? "read-write" : "read" },
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
					},
			});
			stage = "runtime-activation";
			const window = { id: 1, isDestroyed: () => false };
			let binding = await bridge.bind("knowledge-artifact", window);
			const application = bridge.selectSession(window, null);
			if (source.requestsStateWrite) {
				stage = "state-policy-readonly-grant";
				const readOnly = await bridge.invoke(window, binding, "preferences", null, application);
				expect(readOnly).toMatchObject({
					canWriteState: false,
					reviewPolicy: { version: null, persistedMode: null, diagnostic: null },
				});
				await expect(
					bridge.invoke(
						window,
						binding,
						"setReviewPolicy",
						{ bindingRevision: 1, expectedVersion: null, mode: "strict" },
						application,
					),
				).rejects.toThrow("write permission");
				await expect(readFile(join(state, "review-policy.json"))).rejects.toMatchObject({ code: "ENOENT" });
				await bridge.revoke("knowledge-artifact");
				grantStateWrite = true;
				binding = await bridge.bind("knowledge-artifact", window);
				stage = "review-file-grant-required";
				await expect(
					bridge.invoke(
						window,
						binding,
						"applyReview",
						{
							revision: 1,
							id: randomUUID(),
							expectedProposalHash: "0".repeat(64),
						},
						application,
					),
				).rejects.toThrow("Vault write permission");
				await bridge.revoke("knowledge-artifact");
				grantFileWrite = true;
				binding = await bridge.bind("knowledge-artifact", window);
				stage = "state-policy-write-and-readback";
				const writable = await bridge.invoke(window, binding, "preferences", null, application);
				expect(writable.canWriteState).toBe(true);
				denyStateWrite = true;
				await expect(
					bridge.invoke(
						window,
						binding,
						"setReviewPolicy",
						{ bindingRevision: 1, expectedVersion: null, mode: "strict" },
						application,
					),
				).rejects.toThrow("denied");
				await expect(readFile(join(state, "review-policy.json"))).rejects.toMatchObject({ code: "ENOENT" });
				denyStateWrite = false;
				const saved = await bridge.invoke(
					window,
					binding,
					"setReviewPolicy",
					{ bindingRevision: 1, expectedVersion: null, mode: "strict" },
					application,
				);
				const raw = await readFile(join(state, "review-policy.json"), "utf8");
				expect(JSON.parse(raw)).toEqual({ version: 1, mode: "strict" });
				expect(saved.reviewPolicy).toMatchObject({
					mode: "strict",
					persistedMode: "strict",
					version: sha256(raw),
					diagnostic: null,
				});
				expect(await bridge.invoke(window, binding, "preferences", null, application)).toEqual(saved);
				await expect(
					bridge.invoke(
						window,
						binding,
						"setReviewPolicy",
						{ bindingRevision: 1, expectedVersion: null, mode: "automatic" },
						application,
					),
				).rejects.toThrow("version conflict");
				expect(await readFile(join(state, "review-policy.json"), "utf8")).toBe(raw);
				await writeFile(join(state, "review-policy.json"), "{broken");
				const corrupted = await bridge.invoke(window, binding, "preferences", null, application);
				expect(corrupted.reviewPolicy).toMatchObject({ mode: "strict", diagnostic: "invalid-json" });
				await expect(
					bridge.invoke(
						window,
						binding,
						"setReviewPolicy",
						{ bindingRevision: 1, expectedVersion: null, mode: "automatic" },
						application,
					),
				).rejects.toThrow();
				expect(await readFile(join(state, "review-policy.json"), "utf8")).toBe("{broken");
				await writeFile(join(state, "review-policy.json"), raw);
				stage = "state-policy-revoke-and-reload";
				await bridge.revoke("knowledge-artifact");
				await expect(bridge.invoke(window, binding, "preferences", null, application)).rejects.toThrow();
				binding = await bridge.bind("knowledge-artifact", window);
				expect(await bridge.invoke(window, binding, "preferences", null, application)).toEqual(saved);

				stateReceipt = {
					status: "PASS",
					readOnlyGrantRejected: true,
					deniedApprovalNoWrite: true,
					atomicReadback: true,
					staleVersionRejected: true,
					malformedStrictDiagnostic: true,
					savedVersion: sha256(raw),
					revokedBindingRejected: true,
					reloadedPersistedValue: true,
				};
			}
			stage = "application-overview";
			const overview = await bridge.invoke(window, binding, "overview", null, application);
			// Index totals describe the entire approved Vault; visible lists/counts below are scoped.
			expect(overview.index.noteCount).toBe(3);
			expect(overview.recentNotes.map((note) => note.path)).toEqual([sharedNote]);
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

			const readingScopes = [];
			async function verifyReadingScope(lease, project, visible) {
				const input = { revision: overview.binding.revision };
				const invoke = (operation, args) => bridge.invoke(window, binding, operation, args, lease);
				const [graph, links, categories, jobs] = await Promise.all([
					invoke("graph", { ...input, view: "all" }),
					invoke("links", { ...input, path: sharedNote }),
					invoke("recentByCategory", input),
					invoke("jobs", { ...input, limit: 50 }),
				]);
				for (const response of [graph, links, categories, jobs]) {
					expect(response).toMatchObject({ bindingRevision: input.revision, project });
					expect(JSON.stringify(response)).not.toContain(otherNote);
				}
				expect(graph.nodes.map((node) => node.path).sort()).toEqual([...visible].sort());
				expect(graph.totalNotes).toBe(visible.length);
				expect(graph.semantic.totalNotes).toBe(visible.length);
				expect(categories.groups.method.map((note) => note.path).sort()).toEqual([...visible].sort());
				expect(categories.counts).toEqual({
					paper: 0,
					software: 0,
					method: visible.length,
					idea: 0,
					other: 0,
				});
				const linked = project === null ? [] : [currentNote];
				expect(links.outgoing.map((link) => link.path)).toEqual(linked);
				expect(links.incoming.map((link) => link.path)).toEqual(linked);
				expect(jobs.items.every((job) => job.scope === "shared" || job.scope === project)).toBe(true);
				expect(jobs.items.length).toBe(jobs.total);
				expect(jobs.total).toBeGreaterThan(1);
				const firstJob = await invoke("jobs", { ...input, limit: 1 });
				expect(firstJob.items).toHaveLength(1);
				expect(firstJob.nextOffset).toBe(1);
				const remainingJobs = await invoke("jobs", { ...input, offset: firstJob.nextOffset, limit: 50 });
				expect([firstJob.items[0].key, ...remainingJobs.items.map((job) => job.key)].sort()).toEqual(
					jobs.items.map((job) => job.key).sort(),
				);
				expect(remainingJobs.nextOffset).toBeNull();
				const shared = await invoke("readNote", { ...input, path: sharedNote });
				expect(shared).toMatchObject({ missing: false, category: "method", project, startLine: 1 });
				for (const hidden of project === null ? [currentNote, otherNote] : [otherNote]) {
					await expect(invoke("readNote", { ...input, path: hidden })).rejects.toThrow("scope");
					await expect(invoke("links", { ...input, path: hidden })).rejects.toThrow("scope");
				}
				expect((await invoke("search", { ...input, query: "privatebetasentinel" })).hits).toEqual([]);
				expect(
					(await invoke("search", { ...input, query: "alphasentinel" })).hits.map((hit) => hit.path),
				).toEqual(project === null ? [] : [currentNote]);
				readingScopes.push({
					project,
					visibleNotes: visible.length,
					jobs: jobs.total,
					hiddenProjectDenied: true,
				});
			}
			stage = "application-reading-scope";
			await verifyReadingScope(application, null, [sharedNote]);
			stage = "reading-input-schemas";
			for (const [operation, extra] of [
				["readNote", { path: sharedNote, startLine: 0 }],
				["links", { path: sharedNote, project: "beta" }],
				["graph", { limit: 1 }],
				["jobs", { limit: 0 }],
				["recentByCategory", { limit: 25 }],
			])
				await expect(
					bridge.invoke(
						window,
						binding,
						operation,
						{ revision: overview.binding.revision, ...extra },
						application,
					),
				).rejects.toThrow("Invalid plugin operation input");
			await expect(
				bridge.invoke(window, binding, "jobs", { revision: overview.binding.revision + 1 }, application),
			).rejects.toThrow("binding changed");

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
			const capabilities = new CapabilityRuntime(new SkillVisibility());
			capabilities.bind(session);
			capabilities.activate(["knowledge"]);
			for (const name of [
				"knowledge_status",
				"knowledge_search",
				"effect_probe_unknown",
				"effect_probe_write",
			])
				expect(
					session.getActiveToolNames(),
					"declared capability metadata survives process registration",
				).toContain(name);
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
			expect(
				approvals.every(
					(approval) =>
						approval.operation === null ||
						(source.requestsStateWrite &&
							["applyReview", "setReviewPolicy", "capability:state.writeJson"].includes(approval.operation)),
				),
			).toBe(true);
			expect(
				capabilityScopes.some(
					(call) => call.scope.kind === "session" && call.scope.sessionId === session.sessionId,
				),
			).toBe(true);
			expect(await packageChildren(packageRoot)).toEqual(processes);
			if (source.requestsStateWrite) {
				const current = await bridge.invoke(window, binding, "preferences", null, selection);
				const before = await readFile(join(state, "review-policy.json"), "utf8");
				await expect(
					bridge.invoke(
						window,
						binding,
						"setReviewPolicy",
						{ bindingRevision: 1, expectedVersion: current.reviewPolicy.version, mode: "automatic" },
						selection,
					),
				).rejects.toThrow("denied");
				expect(await readFile(join(state, "review-policy.json"), "utf8")).toBe(before);
				stateReceipt.readOnlySessionRejected = true;
			}
			stage = "session-reading-scope";
			await verifyReadingScope(selection, "alpha", [sharedNote, currentNote]);
			const sessionOverview = await bridge.invoke(window, binding, "overview", null, selection);
			expect(sessionOverview.project).toBe("alpha");
			expect(sessionOverview.recentNotes.map((note) => note.path).sort()).toEqual(
				[sharedNote, currentNote].sort(),
			);
			stage = "paged-reading-hash-and-lines";
			const firstPage = await bridge.invoke(
				window,
				binding,
				"readNote",
				{ path: currentNote, revision: overview.binding.revision },
				selection,
			);
			expect(firstPage).toMatchObject({
				missing: false,
				title: "Alpha method",
				category: "method",
				project: "alpha",
				startLine: 1,
				truncated: true,
			});
			expect(firstPage.hash).toBe(sha256(currentText));
			const lines = currentText.split("\n");
			expect(firstPage.totalLines).toBe(lines.length);
			expect(firstPage.text).toBe(lines.slice(0, firstPage.endLine).join("\n"));
			const secondPage = await bridge.invoke(
				window,
				binding,
				"readNote",
				{
					path: currentNote,
					revision: overview.binding.revision,
					startLine: firstPage.endLine + 1,
					expectedHash: firstPage.hash,
				},
				selection,
			);
			expect(secondPage.startLine).toBe(firstPage.endLine + 1);
			expect(secondPage.hash).toBe(firstPage.hash);
			expect(secondPage.text).toBe(lines.slice(secondPage.startLine - 1, secondPage.endLine).join("\n"));
			await writeFile(join(vault, currentNote), "# Alpha method\nChanged after first page.\n");
			await expect(
				bridge.invoke(
					window,
					binding,
					"readNote",
					{ path: currentNote, revision: overview.binding.revision, expectedHash: firstPage.hash },
					selection,
				),
			).rejects.toThrow("Note changed");
			expect(
				await bridge.invoke(
					window,
					binding,
					"readNote",
					{ path: "Library/Methods/missing.md", revision: overview.binding.revision },
					selection,
				),
			).toMatchObject({ missing: true, project: "alpha" });
			const backToApplication = bridge.selectSession(window, null);
			await verifyReadingScope(backToApplication, null, [sharedNote]);
			const restoredSelection = bridge.selectSession(window, session.sessionId);
			await expect(
				bridge.invoke(
					window,
					binding,
					"readNote",
					{ path: currentNote, revision: overview.binding.revision },
					selection,
				),
			).rejects.toThrow();
			await writeFile(join(vault, "Library/Methods/willow.md"), "# Willow method\nWillow assay evidence.\n");
			stage = "selected-session-ui-refresh";
			const refreshed = await bridge.invoke(
				window,
				binding,
				"search",
				{ query: "Willow", revision: overview.binding.revision },
				restoredSelection,
			);
			expect(refreshed.hits[0].path).toBe("Library/Methods/willow.md");
			expect(await packageChildren(packageRoot)).toEqual(processes);
			stage = "review-proposal-fixtures";
			const beforeWiki =
				"# Orchid Wiki\nHuman-owned header.\n<!-- pi-agent:managed:start -->\nOld summary\n<!-- pi-agent:managed:end -->\nHuman-owned footer.\n";
			const afterWiki = beforeWiki.replace("Old summary", "New summary");
			const sourceText = await readFile(join(vault, sharedNote), "utf8");
			const sourceReceipt = {
				path: sharedNote,
				hash: sha256(sourceText),
				startLine: 1,
				endLine: 2,
				excerptHash: sha256(sourceText.split("\n").slice(0, 2).join("\n")),
				paperDois: [],
			};
			const proposals = ["alpha", "beta", "alpha"].map((project, index) => ({
				id: randomUUID(),
				vaultId: overview.binding.vaultId,
				bindingRevision: overview.binding.revision,
				project,
				path: `Projects/${project}/Wiki/${index === 2 ? "Model" : "Orchid"}.md`,
				title: `${project} Orchid`,
				rationale: "Synthetic review fixture",
				createdAt: Date.now(),
				before: beforeWiki,
				beforeHash: sha256(beforeWiki),
				after: afterWiki,
				afterHash: sha256(afterWiki),
				status: "pending",
				sources: [sourceReceipt],
			}));
			// Build hashes with the installed package's public API, never copied domain algorithms.
			const proposalFile = join(prefix, "proposal-fixtures.json");
			await writeFile(proposalFile, JSON.stringify(proposals));
			const { stdout: finalizedJson } = await run(
				process.execPath,
				[
					"--input-type=module",
					"-e",
					'import {readFile} from "node:fs/promises";import {immutableWikiProposalHash} from "@gyoungwe/pi-knowledge/host";const proposals=JSON.parse(await readFile(process.argv[1],"utf8"));process.stdout.write(JSON.stringify(proposals.map(p=>({...p,proposalHash:immutableWikiProposalHash(p)}))));',
					proposalFile,
				],
				{
					cwd: prefix,
					env: {
						PATH: process.env.PATH,
						TMPDIR: root,
						DRONE_KNOWLEDGE_DIR: state,
						PI_CODING_AGENT_DIR: agentDir,
					},
				},
			);
			const [alphaProposal, betaProposal, modelProposal] = JSON.parse(finalizedJson);
			const pendingDirectory = join(state, overview.binding.vaultId, "wiki-review/pending");
			await mkdir(pendingDirectory, { recursive: true });
			for (const proposal of [alphaProposal, betaProposal]) {
				await mkdir(dirname(join(vault, proposal.path)), { recursive: true });
				await writeFile(join(vault, proposal.path), beforeWiki);
				await writeFile(join(pendingDirectory, `${proposal.id}.json`), JSON.stringify(proposal));
			}
			const proposalBytes = await readFile(join(pendingDirectory, `${alphaProposal.id}.json`), "utf8");
			stage = "review-application-isolation";
			const reviewApplication = bridge.selectSession(window, null);
			expect(
				await bridge.invoke(
					window,
					binding,
					"reviews",
					{ revision: overview.binding.revision },
					reviewApplication,
				),
			).toMatchObject({ project: null, total: 0, items: [] });
			stage = "review-readonly-session-preview";
			const reviewSelection = bridge.selectSession(window, session.sessionId);
			const reviewList = await bridge.invoke(
				window,
				binding,
				"reviews",
				{ revision: overview.binding.revision, limit: 1 },
				reviewSelection,
			);
			expect(reviewList).toMatchObject({ project: "alpha", total: 1, nextOffset: null, problems: [] });
			expect(reviewList.items.map((value) => ({ id: value.id, proposalHash: value.proposalHash }))).toEqual([
				{ id: alphaProposal.id, proposalHash: alphaProposal.proposalHash },
			]);
			const reviewInput = {
				revision: overview.binding.revision,
				id: alphaProposal.id,
				expectedProposalHash: alphaProposal.proposalHash,
			};
			const preview = await bridge.invoke(window, binding, "previewReview", reviewInput, reviewSelection);
			await expect(
				bridge.invoke(window, binding, "applyReview", reviewInput, reviewSelection),
			).rejects.toThrow("denied");
			expect(preview).toMatchObject({
				before: "Old summary",
				after: "New summary",
				protectedText: "# Orchid Wiki\nHuman-owned header.\n（此处为智能体托管区）\nHuman-owned footer.\n",
				project: "alpha",
				canApply: true,
				targetChanged: false,
				scientificallyVerified: false,
				sources: [{ ...sourceReceipt, currentHash: sourceReceipt.hash, changed: false, error: null }],
			});
			await expect(
				bridge.invoke(
					window,
					binding,
					"previewReview",
					{ ...reviewInput, id: betaProposal.id, expectedProposalHash: betaProposal.proposalHash },
					reviewSelection,
				),
			).rejects.toThrow("different project");
			await expect(
				bridge.invoke(
					window,
					binding,
					"previewReview",
					{ ...reviewInput, expectedProposalHash: "0".repeat(64) },
					reviewSelection,
				),
			).rejects.toThrow("changed");
			await expect(
				bridge.invoke(
					window,
					binding,
					"reviews",
					{ revision: overview.binding.revision, project: "beta" },
					reviewSelection,
				),
			).rejects.toThrow("Invalid plugin operation input");
			expect(await readFile(join(vault, alphaProposal.path), "utf8")).toBe(beforeWiki);
			expect(await readFile(join(pendingDirectory, `${alphaProposal.id}.json`), "utf8")).toBe(proposalBytes);
			stage = "review-source-and-target-change";
			await writeFile(join(vault, sharedNote), `${sourceText}Changed source after review list.\n`);
			const changedSource = await bridge.invoke(
				window,
				binding,
				"previewReview",
				reviewInput,
				reviewSelection,
			);
			expect(changedSource).toMatchObject({
				canApply: false,
				sources: [{ changed: true, currentHash: sha256(`${sourceText}Changed source after review list.\n`) }],
			});
			await writeFile(join(vault, sharedNote), sourceText);
			await writeFile(join(vault, alphaProposal.path), `${beforeWiki}Edited human footer.\n`);
			expect(
				await bridge.invoke(window, binding, "previewReview", reviewInput, reviewSelection),
			).toMatchObject({ targetChanged: true, canApply: false });
			await writeFile(join(vault, alphaProposal.path), beforeWiki);
			await writeFile(
				join(pendingDirectory, `${alphaProposal.id}.json`),
				JSON.stringify({ ...alphaProposal, after: `${afterWiki}tampered` }),
			);
			await expect(
				bridge.invoke(window, binding, "previewReview", reviewInput, reviewSelection),
			).rejects.toThrow("changed");
			await writeFile(join(pendingDirectory, `${alphaProposal.id}.json`), proposalBytes);
			const reviewScopes = {
				application: 0,
				alpha: 1,
				betaHidden: true,
				readOnlySession: true,
				proposalHash: alphaProposal.proposalHash,
				beforeAfterProtectedExact: true,
				sourceLineHashes: true,
				sourceChangeDetected: true,
				targetChangeDetected: true,
				staleAndTamperedProposalRejected: true,
				readOnlyPreviewStagesDidNotWrite: true,
			};
			stage = "real-writable-sdk-session";
			writeBootstrap = bridge.beginNative(
				window,
				(path) => [...sources].find(([, value]) => value.nativeEntrypoint === path)?.[0],
			);
			const writeLoader = new DefaultResourceLoader({
				cwd: workspace,
				agentDir,
				settingsManager,
				noExtensions: true,
				noSkills: true,
				noPromptTemplates: true,
				noContextFiles: true,
				additionalExtensionPaths: [source.nativeEntrypoint],
				extensionFactoryForPath: writeBootstrap.factoryForPath,
			});
			await writeLoader.reload({ resolveProjectTrust: async () => true });
			expect(writeLoader.getExtensions().errors).toEqual([]);
			({ session: writeSession } = await createAgentSession({
				cwd: workspace,
				agentDir,
				settingsManager,
				resourceLoader: writeLoader,
				modelRuntime,
				sessionManager: SessionManager.inMemory(workspace),
				model: faux.getModel(),
			}));
			sessions.add({ session: writeSession, cwd: workspace, unsubscribe: () => {} });
			writeBootstrap.bindSession(writeSession.sessionId);
			await writeSession.bindExtensions({ onError: (error) => errors.push(error) });
			const writeSelection = bridge.selectSession(window, writeSession.sessionId);
			faux.setResponses([
				fauxAssistantMessage(fauxToolCall("knowledge_search", { query: "Orchid" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("Writable session searched through the same owner."),
			]);
			await writeSession.prompt("Search current Orchid evidence.");
			expect(writeSession.messages.find((message) => message.role === "toolResult")).toMatchObject({
				toolName: "knowledge_search",
				isError: false,
			});
			expect(await packageChildren(packageRoot)).toEqual(processes);
			const reviewWrite = (operation, input) =>
				bridge.invoke(window, binding, operation, input, writeSelection);
			stage = "review-write-authority-and-project";
			denyReviewWrites = true;
			await expect(reviewWrite("applyReview", reviewInput)).rejects.toThrow("denied");
			denyReviewWrites = false;
			expect(await readFile(join(vault, alphaProposal.path), "utf8")).toBe(beforeWiki);
			await expect(
				reviewWrite("applyReview", {
					...reviewInput,
					id: betaProposal.id,
					expectedProposalHash: betaProposal.proposalHash,
				}),
			).rejects.toThrow("different project");
			await expect(
				reviewWrite("applyReview", { ...reviewInput, expectedProposalHash: "0".repeat(64) }),
			).rejects.toThrow("changed");
			await writeFile(join(vault, alphaProposal.path), `${beforeWiki}Human edit before apply.\n`);
			await expect(reviewWrite("applyReview", reviewInput)).rejects.toThrow("no user edits were overwritten");
			expect(await readFile(join(vault, alphaProposal.path), "utf8")).toBe(
				`${beforeWiki}Human edit before apply.\n`,
			);
			await writeFile(join(vault, alphaProposal.path), beforeWiki);
			stage = "review-partial-write-receipt";
			failNextReviewRecord = true;
			const writesBefore = capabilityScopes.filter((call) => call.name === "files.writeText").length;
			const partial = await reviewWrite("applyReview", reviewInput);
			expect(partial).toMatchObject({
				vaultWritten: true,
				reviewRecorded: false,
				indexed: true,
				recovered: false,
				recordError: "Acceptance record persistence failure",
			});
			expect(await readFile(join(vault, alphaProposal.path), "utf8")).toBe(afterWiki);
			expect(await readFile(join(pendingDirectory, `${alphaProposal.id}.json`), "utf8")).toBe(proposalBytes);
			expect(await reviewWrite("reviewHistory", { revision: 1 })).toMatchObject({ items: [] });
			stage = "review-partial-retry-recovery";
			const applied = await reviewWrite("applyReview", reviewInput);
			expect(applied).toMatchObject({
				vaultWritten: true,
				reviewRecorded: true,
				indexed: true,
				recovered: true,
				recordError: null,
				indexError: null,
			});
			expect(capabilityScopes.filter((call) => call.name === "files.writeText").length - writesBefore).toBe(
				1,
			);
			const history = await reviewWrite("reviewHistory", { revision: 1 });
			expect(history).toMatchObject({
				project: "alpha",
				items: [
					{
						id: alphaProposal.id,
						path: alphaProposal.path,
						afterHash: alphaProposal.afterHash,
					},
				],
			});
			await expect(
				reviewWrite("undoReview", { revision: 1, id: betaProposal.id, expectedHash: betaProposal.afterHash }),
			).rejects.toThrow();
			await expect(
				reviewWrite("undoReview", { revision: 1, id: alphaProposal.id, expectedHash: "0".repeat(64) }),
			).rejects.toThrow("Refresh Wiki history before undo");
			await writeFile(join(vault, alphaProposal.path), `${afterWiki}Human edit after apply.\n`);
			await expect(
				reviewWrite("undoReview", {
					revision: 1,
					id: alphaProposal.id,
					expectedHash: alphaProposal.afterHash,
				}),
			).rejects.toThrow("undo would overwrite edits");
			expect(await readFile(join(vault, alphaProposal.path), "utf8")).toBe(
				`${afterWiki}Human edit after apply.\n`,
			);
			await writeFile(join(vault, alphaProposal.path), afterWiki);
			stage = "review-undo-and-history-readback";
			expect(
				await reviewWrite("undoReview", {
					revision: 1,
					id: alphaProposal.id,
					expectedHash: alphaProposal.afterHash,
				}),
			).toMatchObject({ status: "reverted", path: alphaProposal.path });
			expect(await readFile(join(vault, alphaProposal.path), "utf8")).toBe(beforeWiki);
			expect(await reviewWrite("reviewHistory", { revision: 1 })).toMatchObject({ items: [] });
			expect(await readFile(join(vault, betaProposal.path), "utf8")).toBe(beforeWiki);
			stage = "real-model-review-command-and-owner-audit";
			await writeFile(join(vault, modelProposal.path), beforeWiki);
			await writeFile(join(pendingDirectory, `${modelProposal.id}.json`), JSON.stringify(modelProposal));
			const modelIdentity = {
				revision: overview.binding.revision,
				id: modelProposal.id,
				expectedProposalHash: modelProposal.proposalHash,
			};
			const modelInput = { ...modelIdentity, acknowledged: true, autoApply: false };
			const complete = vi.spyOn(modelRuntime, "completeSimple");
			const advice = {
				summary: "The exact recorded source supports this bounded synthetic change.",
				verdict: "approve",
				cautions: [],
				source_paths: [sharedNote],
				checks: {
					evidenceSupportsChanges: true,
					scopeAndUncertaintyPreserved: true,
					noUnresolvedContradictions: true,
					humanContentPreserved: true,
					noInstructionInjection: true,
				},
			};
			denyModelGeneration = true;
			await expect(reviewWrite("modelReview", modelInput)).rejects.toThrow("denied");
			expect(complete).not.toHaveBeenCalled();
			denyModelGeneration = false;
			faux.setResponses([fauxAssistantMessage(fauxToolCall("structured_result", advice))]);
			const commandSignal = new AbortController();
			await new SessionEngine().command(
				writeSession,
				"knowledge-review-model",
				JSON.stringify({
					id: modelProposal.id,
					expectedProposalHash: modelProposal.proposalHash,
					acknowledged: true,
					autoApply: false,
				}),
				commandSignal.signal,
				() => {
					if (sessions.get(writeSession.sessionId)?.session !== writeSession)
						throw new Error("Acceptance command session was revoked");
				},
			);
			const modelInfo = await reviewWrite("modelReviewInfo", modelIdentity);
			expect(modelInfo.lastReview).toMatchObject({
				applied: false,
				canAutoApply: true,
				verdict: "approve",
				humanReviewed: false,
				scientificallyVerified: false,
				usage: { cost: null },
			});
			expect(complete).toHaveBeenCalledOnce();
			expect(await readFile(join(vault, modelProposal.path), "utf8")).toBe(beforeWiki);
			stage = "real-model-review-cancel-no-write";
			let enteredModel;
			const modelStarted = new Promise((resolve) => {
				enteredModel = resolve;
			});
			let actualModelAborted = false;
			faux.setResponses([
				(_context, options) =>
					new Promise((_resolve, reject) => {
						enteredModel();
						options.signal.addEventListener(
							"abort",
							() => {
								actualModelAborted = true;
								reject(new Error("Packed review model canceled"));
							},
							{ once: true },
						);
					}),
			]);
			const pendingModel = bridge.invoke(
				window,
				binding,
				"modelReview",
				{ ...modelInput, autoApply: true },
				writeSelection,
				"packed-model-cancel",
			);
			const canceledModel = expect(pendingModel).rejects.toThrow();
			await modelStarted;
			expect(await bridge.cancel(window, binding, writeSelection, "packed-model-cancel")).toBe(true);
			await canceledModel;
			expect(actualModelAborted).toBe(true);
			expect(await readFile(join(vault, modelProposal.path), "utf8")).toBe(beforeWiki);
			expect(await reviewWrite("modelReviewInfo", modelIdentity)).toMatchObject({
				lastReview: { auditId: modelInfo.lastReview.auditId, applied: false },
			});
			stage = "real-model-review-apply-undo";
			faux.setResponses([fauxAssistantMessage(fauxToolCall("structured_result", advice))]);
			const modelApplied = await reviewWrite("modelReview", { ...modelInput, autoApply: true });
			expect(modelApplied).toMatchObject({
				applied: true,
				partial: false,
				humanReviewed: false,
				scientificallyVerified: false,
				writeResult: { vaultWritten: true, reviewRecorded: true, indexed: true },
			});
			expect(await readFile(join(vault, modelProposal.path), "utf8")).toBe(afterWiki);
			expect(await reviewWrite("reviewHistory", { revision: 1 })).toMatchObject({
				items: [{ id: modelProposal.id, reviewMethod: "model" }],
			});
			await reviewWrite("undoReview", {
				revision: 1,
				id: modelProposal.id,
				expectedHash: modelProposal.afterHash,
			});
			expect(await readFile(join(vault, modelProposal.path), "utf8")).toBe(beforeWiki);
			expect(await reviewWrite("reviewHistory", { revision: 1 })).toMatchObject({ items: [] });
			expect(await packageChildren(packageRoot)).toEqual(processes);
			reviewScopes.model = {
				nativeCommandAuditReadback: true,
				denialBeforeGeneration: true,
				actualModelAborted,
				canceledWithoutVaultWrite: true,
				applyHistoryUndo: true,
				humanReviewed: false,
				scientificallyVerified: false,
				modelCalls: complete.mock.calls.length,
			};
			complete.mockRestore();
			stage = "last-native-close-retains-ui-owner";
			for (const active of [session, writeSession]) {
				sessions.revoke(active.sessionId);
				await new SessionEngine().dispose(active);
				sessions.delete(active.sessionId);
			}
			session = undefined;
			writeSession = undefined;
			await bootstrap.dispose();
			await writeBootstrap.dispose();
			const uiOnly = bridge.selectSession(window, null);
			expect(await bridge.invoke(window, binding, "overview", null, uiOnly)).toMatchObject({
				state: "bound",
			});
			expect(await packageChildren(packageRoot)).toEqual(processes);
			expect(await readdir(join(leases, "knowledge-writers"))).toHaveLength(2);
			expect(errors).toEqual([]);
			reviewScopes.writes = {
				fileGrantRequired: true,
				approvalDeniedWithoutWrite: true,
				crossProjectRejected: true,
				staleProposalRejected: true,
				humanEditRetained: true,
				partial,
				applied,
				partialRetryVaultWrites: 1,
				historyAfterApply: history.items.length,
				undoRestoredProtectedText: true,
				historyAfterUndo: 0,
				nativeCloseRetainsUi: true,
			};
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
				actualWritableSdkSession: true,
				productionCapabilityRouting: true,
				tools: results.map((result) => ({ name: result.toolName, error: result.isError })),
				sameOwnerProcesses: processes,
				uiOverviewNotes: overview.index.noteCount,
				searchMatchesNative: true,
				refresh: true,
				readingOperations: ["readNote", "links", "graph", "jobs", "recentByCategory"],
				readingScopes,
				statePolicy: stateReceipt,
				reviews: reviewScopes,
				readingInputSchemas: true,
				pagedReadHashAndLines: true,
				changedHashRejected: true,
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
			// Separate real shutdown and census phases so a failure identifies its owner.
			async function cleanupPhase(phase, operation) {
				const started = performance.now();
				const [result] = await Promise.allSettled([operation]);
				cleanup.push({ phase, durationMs: Math.round(performance.now() - started), ...result });
			}
			if (session) {
				sessions.revoke(session.sessionId);
				await cleanupPhase("sdk-dispose", new SessionEngine().dispose(session));
				sessions.delete(session.sessionId);
			}
			if (writeSession) {
				sessions.revoke(writeSession.sessionId);
				await cleanupPhase("writable-sdk-dispose", new SessionEngine().dispose(writeSession));
				sessions.delete(writeSession.sessionId);
			}
			await cleanupPhase("native-bootstrap-dispose", bootstrap?.dispose());
			await cleanupPhase("writable-native-bootstrap-dispose", writeBootstrap?.dispose());
			await cleanupPhase("coordinator-close", bridge?.close());
			await cleanupPhase(
				"knowledge-child-census",
				(async () => {
					if (packageRoot) expect(await packageChildren(packageRoot)).toEqual([]);
				})(),
			);
			await cleanupPhase(
				"control-child-census",
				(async () => {
					expect(await packageChildren(controlsRoot)).toEqual([]);
				})(),
			);
			await cleanupPhase(
				"sqlite-reopen-after-owner-close",
				(async () => {
					for (const directory of await readdir(cache)) {
						const database = new DatabaseSync(join(cache, directory, "index.sqlite"));
						try {
							database.exec("BEGIN EXCLUSIVE; ROLLBACK;");
							expect(database.prepare("PRAGMA quick_check").get()).toMatchObject({ quick_check: "ok" });
							sqliteReopened++;
						} finally {
							database.close();
						}
					}
				})(),
			);
			await cleanupPhase(
				"reservation-census",
				(async () => {
					for (const namespace of await readdir(leases))
						expect(await readdir(join(leases, namespace))).toEqual([]);
				})(),
			);
			await cleanupPhase("fixture-remove", rm(root, { recursive: true, force: true }));
		}
		const failures = cleanup.filter((result) => result.status === "rejected");
		if (failures.length) {
			if (process.env.DRONE_KNOWLEDGE_EVIDENCE) {
				const path = `${resolve(process.env.DRONE_KNOWLEDGE_EVIDENCE)}.cleanup-failure.txt`;
				await mkdir(dirname(path), { recursive: true });
				await writeFile(path, inspect(cleanup, { depth: 8 }));
			}
			throw new AggregateError(
				[...(failure ? [failure] : []), ...failures.map((result) => result.reason)],
				"Packed knowledge cleanup failed",
			);
		}
		if (failure) throw failure;
		expect(sqliteReopened).toBe(1);
		const evidence = {
			...receipt,
			childrenExited: true,
			reservationsReleased: true,
			sqliteExclusiveReopenAfterExit: sqliteReopened,
			cleanup: cleanup.map(({ phase, status, durationMs }) => ({ phase, status, durationMs })),
		};
		if (process.env.DRONE_KNOWLEDGE_EVIDENCE) {
			const path = resolve(process.env.DRONE_KNOWLEDGE_EVIDENCE);
			await mkdir(dirname(path), { recursive: true });
			await writeFile(path, `${JSON.stringify(evidence, null, 2)}\n`);
		}
		console.log(JSON.stringify(evidence));
	},
	120000,
);
