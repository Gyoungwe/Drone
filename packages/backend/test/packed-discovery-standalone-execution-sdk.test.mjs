// @vitest-environment node
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import {
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { expect, it, vi } from "vitest";

const run = promisify(execFile);
const tarball = process.env.DRONE_DISCOVERY_PLUGIN_TARBALL;
const api = process.env.DRONE_PLUGIN_API_TARBALL;
const realContainer = process.env.DRONE_REAL_DISCOVERY_CONTAINER === "1";
it.skipIf(!tarball)(
	`executes the installed standard Pi entry with actual SDK and durable receipts (${realContainer ? "cached local Docker" : "synthetic engine"})`,
	async () => {
		const root = await realpath(await mkdtemp(join(tmpdir(), "discovery-standalone-execution-")));
		let session;
		try {
			if (!api) throw new Error("Explicit private Plugin API tarball required");
			const cwd = join(root, "workspace"),
				agentDir = join(root, "agent");
			await Promise.all([mkdir(cwd), mkdir(agentDir)]);
			await run(
				"npm",
				[
					"install",
					"--prefix",
					root,
					"--ignore-scripts",
					"--omit=peer",
					"--no-audit",
					"--no-fund",
					await realpath(tarball),
					await realpath(api),
				],
				{ maxBuffer: 8 * 1024 * 1024 },
			);
			const realDocker = realContainer ? (await run("which", ["docker"])).stdout.trim() : undefined;
			const image = realContainer
				? JSON.parse((await run(realDocker, ["image", "inspect", "python:3.12-slim"])).stdout)[0].Id
				: `sha256:${"a".repeat(64)}`;
			expect(image).toMatch(/^sha256:[a-f0-9]{64}$/);
			await writeFile(
				join(root, "docker"),
				`#!${process.execPath}
const fs=require('node:fs'),args=process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(join(root, "engine-calls.jsonl"))},JSON.stringify(args)+'\\n');
if(${realContainer}){const child=require('node:child_process').spawnSync(${JSON.stringify(realDocker)},args,{stdio:'inherit'});if(child.error)throw child.error;process.exit(child.status??1);}
if(args[0]==='version'){console.log('synthetic-engine');process.exit(0);}
if(args[0]==='image'&&args.at(-1)==='python:3.12-slim'){console.log(${JSON.stringify(image)});process.exit(0);}
if(args[0]==='image')process.exit(1);
if(args[0]==='run'){console.log('[summary] standalone synthetic output');process.exit(0);}
if(args[0]==='inspect')process.exit(1);
if(args[0]==='container'&&args[1]==='ls')process.exit(0);
process.exit(2);
`,
			);
			await chmod(join(root, "docker"), 0o755);
			vi.stubEnv("PATH", `${root}${delimiter}${process.env.PATH}`);
			vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
			const settingsManager = SettingsManager.inMemory({ projectTrusted: true });
			const resourceLoader = new DefaultResourceLoader({
				cwd,
				agentDir,
				settingsManager,
				noExtensions: true,
				noSkills: true,
				noPromptTemplates: true,
				additionalExtensionPaths: [join(root, "node_modules/@gyoungwe/pi-discovery/dist/index.mjs")],
			});
			await resourceLoader.reload({ resolveProjectTrust: async () => true });
			expect(resourceLoader.getExtensions().errors).toEqual([]);
			const modelRuntime = await ModelRuntime.create({
				authPath: join(agentDir, "offline-auth.json"),
				modelsPath: null,
				allowModelNetwork: false,
				refreshOnCreate: false,
			});
			const provider = fauxProvider({ provider: "standalone-execution", tokensPerSecond: 0 });
			modelRuntime.registerNativeProvider(provider.provider);
			await modelRuntime.setRuntimeApiKey("standalone-execution", "offline-test-only");
			({ session } = await createAgentSession({
				cwd,
				agentDir,
				settingsManager,
				resourceLoader,
				modelRuntime,
				sessionManager: SessionManager.inMemory(cwd),
				model: provider.getModel(),
			}));
			const approvals = [];
			await session.bindExtensions({
				uiContext: {
					confirm: async (title, message, options) => {
						options.signal.throwIfAborted();
						approvals.push({ title, message });
						return true;
					},
					notify() {},
				},
			});
			const call = async (name, input) => {
				provider.setResponses([
					fauxAssistantMessage(fauxToolCall(name, input)),
					fauxAssistantMessage("Verified standalone protocol"),
				]);
				await session.prompt("Use only the requested discovery operation on synthetic temporary data.");
				await session.waitForIdle();
				const receipt = session.messages.filter((item) => item.role === "toolResult").at(-1);
				if (!receipt) throw new Error("Actual SDK did not append a tool result");
				expect(receipt.isError, JSON.stringify(receipt)).toBe(false);
				return receipt.details;
			};
			expect(await call("discovery_execution_environment", {})).toMatchObject({
				kind: "container",
				images: { python: image },
			});
			expect(await readdir(cwd)).toEqual([]);
			await call("discovery_bind_workspace", { root: "native-state", acknowledgeExistingData: true });
			const kernel = {
				sessionId: "native-owned",
				language: "python",
				runDirectory: "runs/native-owned",
				image,
				dataClassification: "public",
				executionTimeoutMs: 30000,
				idleTimeoutMs: 120000,
				maxExecutions: 2,
				maxOutputBytes: 1024,
			};
			expect(await call("discovery_create_kernel", kernel)).toMatchObject({
				logicalOnly: true,
				creatorSessionId: session.sessionId,
				kernel: { status: "ready" },
			});
			const code = realContainer
				? "from pathlib import Path\nPath('native-proof.txt').write_text('synthetic native proof')\nprint('[summary] standalone synthetic output')"
				: "print('[summary] standalone synthetic output')";
			const executed = await call("discovery_execute_kernel", { sessionId: kernel.sessionId, code });
			expect(executed).toMatchObject({
				execution: { status: "succeeded" },
				intents: [{ status: "succeeded" }],
			});
			if (realContainer)
				expect(await readFile(join(cwd, "runs/native-owned/native-proof.txt"), "utf8")).toBe(
					"synthetic native proof",
				);
			expect(approvals).toHaveLength(1);
			expect(approvals[0].message).toContain(await realpath(cwd));
			expect(approvals[0].message).toContain(session.sessionId);
			expect(approvals[0].message).toContain(code);
			const requestId = executed.intents[0].requestId;
			expect(await call("discovery_execution_receipt", { requestId })).toMatchObject({
				kind: "value",
				receipt: { status: "succeeded" },
			});
			await call("discovery_close_kernel", { sessionId: kernel.sessionId });
			expect((await call("discovery_list_kernels", {})).kernels).toMatchObject([
				{ status: "closed", ownership: "historical" },
			]);
			const persisted = JSON.parse(await readFile(join(cwd, "runs/.drone-discovery/sessions.json"), "utf8"));
			expect(persisted).toMatchObject([{ sessionId: kernel.sessionId, status: "closed", executionCount: 1 }]);
			const calls = (await readFile(join(root, "engine-calls.jsonl"), "utf8"))
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line));
			expect(calls.filter((args) => args[0] === "run")).toHaveLength(1);
			expect(calls.some((args) => args.includes("pull"))).toBe(false);
			if (realContainer) {
				const args = calls.find((args) => args[0] === "run");
				expect(args).toContain("--pull=never");
				const name = args[args.indexOf("--name") + 1];
				expect(
					(
						await run(realDocker, [
							"container",
							"ls",
							"--all",
							"--filter",
							`name=^/${name}$`,
							"--format",
							"{{.Names}}",
						])
					).stdout.trim(),
				).toBe("");
			}
			const shutdown = [];
			session.extensionRunner.onError((error) => shutdown.push(error));
			await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
			expect(shutdown).toEqual([]);
			console.log(
				JSON.stringify({
					test: "installed-standard-pi-execution",
					actualSdk: "1.1.0",
					samePublicNodeRunner: true,
					actualCreatorScope: true,
					interactiveApproval: "SDK UI confirm fixture",
					durableNativeAtomicReceipt: true,
					closedJournalReadback: true,
					realDocker: realContainer ? "PASS_CACHED_EXACT_IMAGE" : "NOT_RUN_SYNTHETIC_ENGINE",
					configuredImage: image,
					formalGui: "NOT_RUN",
				}),
			);
		} finally {
			if (session) {
				await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
				await session.abort();
				session.dispose();
			}
			vi.unstubAllEnvs();
			await rm(root, { recursive: true, force: true });
		}
	},
	120000,
);
