import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { SqliteInquiryStorage } from "@drone/inquiry";
import { readDroneToolMeta } from "@drone/shared";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import {
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { expect, it, vi } from "vitest";
import { InquiryService } from "../src/services/inquiry";

const run = promisify(execFile),
	tarball = process.env.DRONE_INQUIRY_PLUGIN_TARBALL,
	api = process.env.DRONE_PLUGIN_API_TARBALL;
it.skipIf(!tarball)(
	"loads the standard installed Inquiry Pi entry and persists original SQLite through actual caller approvals",
	async () => {
		const root = await realpath(await mkdtemp(join(tmpdir(), "packed-inquiry-native-")));
		let session, legacy;
		try {
			if (!api) throw new Error("Explicit public API candidate required");
			const cwd = join(root, "workspace"),
				agentDir = join(root, "agent"),
				state = join(cwd, "runs", ".drone-inquiry");
			await mkdir(cwd);
			await mkdir(agentDir);
			await mkdir(state, { recursive: true });
			const seed = new SqliteInquiryStorage("legacy-project", join(state, "ledger.sqlite"));
			await seed.close();
			const original = await readFile(join(state, "ledger.sqlite"));
			const installed = join(root, "installed");
			await mkdir(installed);
			await run(
				"npm",
				[
					"install",
					"--prefix",
					installed,
					"--ignore-scripts",
					"--omit=peer",
					"--no-audit",
					"--no-fund",
					tarball,
					api,
				],
				{ maxBuffer: 8 * 1024 * 1024 },
			);
			const packageRoot = join(installed, "node_modules/@gyoungwe/pi-inquiry"),
				manifest = JSON.parse(await readFile(join(packageRoot, "plugin.manifest.json"), "utf8"));
			const settings = SettingsManager.inMemory({ projectTrusted: true });
			const loader = new DefaultResourceLoader({
				cwd,
				agentDir,
				settingsManager: settings,
				noExtensions: true,
				noSkills: true,
				noPromptTemplates: true,
				additionalExtensionPaths: [join(packageRoot, "dist/index.mjs")],
			});
			await loader.reload({ resolveProjectTrust: async () => true });
			expect(loader.getExtensions().errors).toEqual([]);
			const models = await ModelRuntime.create({
				authPath: join(agentDir, "auth.json"),
				modelsPath: null,
				allowModelNetwork: false,
				refreshOnCreate: false,
			});
			const faux = fauxProvider({ provider: "inquiry-native-offline", tokensPerSecond: 0 });
			models.registerNativeProvider(faux.provider);
			await models.setRuntimeApiKey("inquiry-native-offline", "offline-test-only");
			({ session } = await createAgentSession({
				cwd,
				agentDir,
				settingsManager: settings,
				resourceLoader: loader,
				modelRuntime: models,
				sessionManager: SessionManager.inMemory(cwd),
				model: faux.getModel(),
			}));
			let allowed = true,
				hold,
				entered;
			const approvals = [];
			await session.bindExtensions({
				uiContext: {
					confirm: async (title, message, options) => {
						approvals.push({ title, message });
						if (hold && title === "Write Inquiry JSON metadata" && message.includes('"status": "pending"')) {
							entered();
							return hold;
						}
						options.signal.throwIfAborted();
						return allowed;
					},
					notify() {},
				},
			});
			expect(manifest.tools).toEqual(["inquiry_read", "inquiry_write"]);
			for (const name of manifest.tools)
				expect(readDroneToolMeta(session.getToolDefinition(name)).readOnly === true).toBe(
					name === "inquiry_read",
				);
			const call = async (name, request, expectError = false) => {
				faux.setResponses([
					fauxAssistantMessage(fauxToolCall(name, { request })),
					fauxAssistantMessage("Synthetic native Inquiry result"),
				]);
				await session.prompt("Use only the requested Inquiry operation in the synthetic workspace.");
				await session.waitForIdle();
				const result = session.messages.filter((message) => message.role === "toolResult").at(-1);
				if (!result) throw new Error("Actual SDK result missing");
				expect(result.isError, JSON.stringify(result)).toBe(expectError);
				return result.details;
			};
			const status = await call("inquiry_read", { action: "status" });
			expect(status.state).toBe("needs-binding");
			await call("inquiry_write", {
				action: "bind",
				root: "native-inquiry-binary",
				metadataRoot: "native-inquiry-json",
				acknowledgeExistingData: true,
			});
			const date = "2026-10-28T00:00:00.000Z",
				question = (id) => ({
					id,
					schemaVersion: 2,
					projectId: "legacy-project",
					kind: "hypothesis",
					statement: `Synthetic ${id}`,
					competingExplanations: [],
					testsDone: [],
					testsPlanned: [],
					status: "open",
					proposer: "user",
					priority: 1,
					createdAt: date,
					updatedAt: date,
				});
			await call("inquiry_write", { action: "recordQuestion", record: question("native-question") });
			expect((await call("inquiry_read", { action: "snapshot" })).value.questions).toMatchObject([
				{ id: "native-question" },
			]);
			expect(() => new InquiryService({ inquiryDir: state, projectId: "legacy-project" })).toThrow(
				"already reserved",
			);
			const before = await readFile(join(state, "ledger.sqlite"));
			allowed = false;
			await call("inquiry_write", { action: "recordQuestion", record: question("denied") }, true);
			expect(await readFile(join(state, "ledger.sqlite"))).toEqual(before);
			allowed = true;
			let release;
			hold = new Promise((resolve) => {
				release = resolve;
			});
			const started = new Promise((resolve) => {
				entered = resolve;
			});
			const cancelling = call(
				"inquiry_write",
				{ action: "recordQuestion", record: question("late-approval") },
				true,
			);
			await started;
			const metadata = await readFile(join(state, "inquiry-binding.json"));
			const aborting = session.abort();
			release(true);
			await aborting;
			await cancelling;
			hold = undefined;
			expect(await readFile(join(state, "ledger.sqlite"))).toEqual(before);
			expect(await readFile(join(state, "inquiry-binding.json"))).toEqual(metadata);
			await call("inquiry_write", { action: "restoreOriginal" });
			expect(await readFile(join(state, "ledger.sqlite"))).toEqual(original);
			for (const approval of approvals) {
				expect(approval.message).toContain(await realpath(cwd));
				expect(approval.message).toContain(session.sessionId);
			}
			const failures = [];
			session.extensionRunner.onError((error) => failures.push(error));
			await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
			expect(failures).toEqual([]);
			legacy = new InquiryService({ inquiryDir: state, projectId: "legacy-project" });
			expect((await legacy.readOnlySnapshot()).questions).toEqual([]);
			await legacy.dispose();
			legacy = undefined;
			console.log(
				JSON.stringify({
					test: "packed-inquiry-native-sdk",
					standardPiPackage: true,
					actualSdk: "1.1.0",
					toolManifestExact: true,
					actualCreatorScope: true,
					interactiveApproval: "actual SDK UI confirm fixture",
					originalSqliteFormatAndProject: true,
					publicSharedBinaryIo: true,
					atomicNativeJsonAdapter: true,
					denialLeavesOriginal: true,
					lateApprovalAfterAbortZeroCommit: true,
					originalPathRestore: true,
					legacyWriterExclusiveUntilShutdown: true,
					hostJsonStore: "DESKTOP_ONLY",
					formalGui: "NOT_RUN",
				}),
			);
		} finally {
			await legacy?.dispose();
			await session?.dispose();
			vi.restoreAllMocks();
			await rm(root, { recursive: true, force: true });
		}
	},
	120000,
);
