import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { TaskHostLoader } from "@gyoungwe/plugin-api/tasks";
import { expect, it, vi } from "vitest";
import { createBackend } from "../src/create-backend";
import type { SessionService } from "../src/session-service";

const run = promisify(execFile),
	tarball = process.env.DRONE_CORE_TARBALL;
it.skipIf(!tarball)(
	"a clean installed core tarball drives the production backend's native task session",
	async () => {
		const api = process.env.DRONE_PLUGIN_API_TARBALL;
		if (!api)
			throw new Error("Core candidate acceptance requires explicit DRONE_PLUGIN_API_TARBALL for API 1.3");
		const root = await realpath(await mkdtemp(join(tmpdir(), "drone-packed-core-owner-")));
		let services: ReturnType<typeof createBackend> | undefined;
		try {
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
					await realpath(tarball!),
					await realpath(api),
				],
				{ maxBuffer: 8 * 1024 * 1024 },
			);
			const packageRoot = join(root, "node_modules/@gyoungwe/pi-core");
			const manifest = JSON.parse(await readFile(join(packageRoot, "plugin.manifest.json"), "utf8"));
			expect(manifest.capabilities).toContain("tasks");
			const { taskHostLoader } = (await import(
				/* @vite-ignore */ pathToFileURL(join(packageRoot, manifest.entrypoints.host)).href
			)) as { taskHostLoader: TaskHostLoader };
			const agentDir = join(root, "agent"),
				cwd = join(root, "project");
			await mkdir(agentDir);
			await mkdir(cwd);
			vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
			const runtime = await ModelRuntime.create({
				authPath: join(agentDir, "auth.json"),
				modelsPath: null,
				allowModelNetwork: false,
				refreshOnCreate: false,
			});
			const faux = fauxProvider({ provider: "packed-core-owner", tokensPerSecond: 0 });
			runtime.registerNativeProvider(faux.provider);
			vi.spyOn(runtime, "hasConfiguredAuth").mockReturnValue(true);
			services = createBackend({
				projectTrust: false,
				lazyCapabilities: false,
				webFetch: false,
				subagentPreferBuiltin: false,
				taskHostLoader,
			});
			const sessions = services.sessions as SessionService;
			sessions.modelRuntime = runtime;
			let approvals = 0;
			sessions.onAskRequest((request) => {
				approvals++;
				queueMicrotask(() =>
					sessions.respondAsk(request.id, {
						kind: "answer",
						mode: "submit",
						answers: Object.fromEntries(
							request.questions.map((question) => [
								question.id,
								{ values: [question.options.find((option) => option.value === "同意本次请求")!.value] },
							]),
						),
					}),
				);
			});
			const meta = await sessions.createSession({
				cwd,
				provider: faux.provider.id,
				modelId: faux.getModel().id,
			});
			const session = sessions.registry.get(meta.sessionId)!.session;
			const call = (name: string, input: Record<string, unknown>) =>
				fauxAssistantMessage(fauxToolCall(name, input));
			faux.setResponses([
				call("task_plan", {
					goal: "Deliver a checked file",
					summary: "One synthetic output",
					writeDirectories: ["."],
					milestones: [{ id: "report", title: "Report", acceptance: { kind: "file", path: "report.txt" } }],
				}),
				call("write", { path: "report.txt", content: "installed canonical owner" }),
				call("task_status", {}),
				fauxAssistantMessage("done"),
			]);
			await session.prompt("Create the report after the one task authorization.");
			await session.waitForIdle();
			expect(approvals).toBe(1);
			expect(await readFile(join(cwd, "report.txt"), "utf8")).toBe("installed canonical owner");
			const view = session.messages.findLast((message) => "details" in message && message.details?.taskView)
				?.details?.taskView;
			expect(
				view.tasks.find((task: { id: string }) => task.id === view.activeTaskId).remainingSummary,
			).toContain("已验收 1/1");
			expect(services.runtime.tasks).toEqual({});
		} finally {
			await services?.dispose();
			vi.restoreAllMocks();
			vi.unstubAllEnvs();
			await rm(root, { recursive: true, force: true });
		}
	},
	60000,
);
