import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { SubprocessFixtureRunner } from "@drone/discovery";
import { readDroneToolMeta } from "@drone/shared";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import {
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { DiscoveryHostLoader } from "@gyoungwe/plugin-api";
import { expect, it } from "vitest";
import { createDiscoveryService } from "../src/discovery/service";

const tarball = process.env.DRONE_DISCOVERY_PLUGIN_TARBALL;
const run = promisify(execFile);

it.skipIf(!tarball)(
	"reads real installed-plugin writer journals through the same tarball in native Pi sessions",
	async () => {
		const root = await mkdtemp(join(tmpdir(), "discovery-native-writer-"));
		const opened: Awaited<ReturnType<typeof createAgentSession>>["session"][] = [];
		try {
			const prefix = join(root, "installed");
			const api = process.env.DRONE_PLUGIN_API_TARBALL;
			if (!api) throw new Error("Discovery candidate requires explicit DRONE_PLUGIN_API_TARBALL");
			await run("npm", [
				"install",
				"--prefix",
				prefix,
				"--omit=peer",
				"--ignore-scripts",
				"--no-audit",
				"--no-fund",
				tarball as string,
				api,
			]);
			const packageRoot = join(prefix, "node_modules/@gyoungwe/pi-discovery");
			const { discoveryHostLoader } = (await import(
				/* @vite-ignore */ pathToFileURL(join(packageRoot, "dist/host.mjs")).href
			)) as { discoveryHostLoader: DiscoveryHostLoader };
			const manifest = JSON.parse(await readFile(join(packageRoot, "plugin.manifest.json"), "utf8"));
			const a = join(root, "a"),
				b = join(root, "b"),
				empty = join(root, "empty");
			for (const cwd of [a, b, empty]) await mkdir(cwd);
			const authorizations: string[] = [];
			for (const [cwd, id] of [
				[a, "writer-session-a"],
				[b, "writer-session-b"],
			] as const) {
				const { service } = createDiscoveryService(
					{
						projectId: id,
						projectRoot: cwd,
						authorize: async (operation) => {
							authorizations.push(operation.kind);
						},
						runner: new SubprocessFixtureRunner(),
					},
					discoveryHostLoader,
				);
				try {
					await service.createKernelSession({
						sessionId: id,
						runDirectory: `runs/${id}`,
						language: "python",
						dataClassification: "public",
					});
					const execution = await service.executeKernel(id, 'print("discovery-native-writer")');
					expect(execution.status, JSON.stringify(execution)).toBe("succeeded");
					expect(execution.output).toContain("discovery-native-writer");
					await service.closeKernelSession(id);
				} finally {
					await service.dispose();
				}
			}
			expect(authorizations).toEqual([
				"create-kernel-session",
				"execute-kernel",
				"close-kernel-session",
				"create-kernel-session",
				"execute-kernel",
				"close-kernel-session",
			]);
			const fileHash = async (cwd: string) =>
				createHash("sha256")
					.update(await readFile(join(cwd, "runs/.drone-discovery/sessions.json")))
					.digest("hex");
			const hashes = await Promise.all([fileHash(a), fileHash(b)]);
			const agentDir = join(root, "agent");
			await mkdir(agentDir);
			const runtime = await ModelRuntime.create({
				authPath: join(agentDir, "auth.json"),
				modelsPath: null,
				modelsStorePath: join(agentDir, "models.json"),
				allowModelNetwork: false,
				refreshOnCreate: false,
			});
			const faux = fauxProvider({ provider: "discovery-native-readback", tokensPerSecond: 100000 });
			runtime.registerNativeProvider(faux.provider);
			await runtime.setRuntimeApiKey("discovery-native-readback", "offline-test-only");
			let dispatches = 0;
			for (const [cwd, own, other] of [
				[a, "writer-session-a", "writer-session-b"],
				[b, "writer-session-b", "writer-session-a"],
				[empty, null, null],
			] as const) {
				const settingsManager = SettingsManager.inMemory({ projectTrusted: true });
				const resourceLoader = new DefaultResourceLoader({
					cwd,
					agentDir,
					settingsManager,
					noExtensions: true,
					noSkills: true,
					additionalExtensionPaths: [join(packageRoot, "dist/index.mjs")],
				});
				await resourceLoader.reload();
				expect(resourceLoader.getExtensions().errors).toEqual([]);
				const { session } = await createAgentSession({
					cwd,
					agentDir,
					settingsManager,
					resourceLoader,
					modelRuntime: runtime,
					model: faux.getModel(),
					sessionManager: SessionManager.inMemory(cwd),
					tools: manifest.tools,
				});
				opened.push(session);
				await session.bindExtensions({});
				for (const name of manifest.tools) {
					const meta = readDroneToolMeta(session.getToolDefinition(name));
					expect(meta.readOnly === true).toBe(
						![
							"discovery_bind_workspace",
							"discovery_create_plan",
							"discovery_create_kernel",
							"discovery_execute_kernel",
							"discovery_close_kernel",
							"discovery_reconcile_executions",
							"discovery_cancel_execution",
							"discovery_record_inquiry",
						].includes(name),
					);
					expect(meta).toMatchObject({
						capabilities: ["research", "analysis"],
					});
				}
				const call = async (name: string, input: Record<string, unknown>) => {
					const receipts: any[] = [];
					const stop = session.subscribe((event) => {
						if (event.type === "tool_execution_end") receipts.push(event);
					});
					faux.setResponses([
						fauxAssistantMessage([fauxToolCall(name, input)], { stopReason: "toolUse" }),
						fauxAssistantMessage("Readback complete."),
					]);
					try {
						await session.prompt("Read the discovery journal using the specified tool.");
						expect(receipts).toHaveLength(1);
						expect(receipts[0].isError).toBe(false);
						dispatches++;
						return receipts[0].result.details;
					} finally {
						stop();
					}
				};
				const status = await call("discovery_status", {});
				expect(status.status).toBe(own ? "configured" : "unconfigured");
				expect(status.execution).toBe("unavailable");
				if (!own) continue;
				const listed = await call("discovery_list_records", { journal: "sessions" });
				expect(listed.records[0]).toMatchObject({ sessionId: own, executionCount: 1, status: "closed" });
				expect((await call("discovery_search_records", { journal: "sessions", query: own })).count).toBe(1);
				expect((await call("discovery_search_records", { journal: "sessions", query: other })).count).toBe(0);
			}
			expect(dispatches).toBe(9);
			const matrixScript = process.env.DRONE_DISCOVERY_SDK_MATRIX_SCRIPT;
			if (matrixScript) {
				const matrix = await run(
					process.execPath,
					[matrixScript, "--writer-workspaces", a, b, empty, "--tarball", tarball as string],
					{ maxBuffer: 8 * 1024 * 1024, timeout: 240_000 },
				);
				const receipt = JSON.parse(matrix.stdout.trim().split("\n").at(-1) as string);
				expect(receipt.status).toBe("PASS");
				expect(receipt.matrix).toHaveLength(2);
				console.log(`DISCOVERY_NATIVE_MATRIX=${JSON.stringify(receipt)}`);
			}
			expect(await Promise.all([fileHash(a), fileHash(b)])).toEqual(hashes);
			expect(await readdir(empty)).toEqual([]);
		} finally {
			for (const session of opened) await session.dispose();
			await rm(root, { recursive: true, force: true });
		}
	},
	300_000,
);
