// A downloaded PDF handed to a managed task, through a real SDK session, the real restricted plugin
// process and the installed @gyoungwe/pi-core runtime (docs/handoff-2026-10-29-p4.md §5.2 item 1).
// The managed process has no worker threads, so the identity can only come from the host's
// document.pdfText, which parses in its own one-shot sandboxed process. The model is the offline faux
// provider; everything between it and the plugin is production code.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { getCurrentTools } from "@earendil-works/pi-ai/utils/transcript";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, it, vi } from "vitest";
import { discoverInstalledPackages } from "../../desktop/src/main/ui-plugins/installed-package-sources";
import { createBackend } from "../src/create-backend";
import { PluginRuntimeBridge } from "../src/plugins/coordinator";
import { createProcessPluginRuntime } from "../src/plugins/process-runtime";

/** Per-test resources: temp root, backend, plugin bridge and the offline model. */
const live = {};
afterEach(async () => {
	await live.bridge?.close();
	await live.backend?.dispose();
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	if (live.root) await rm(live.root, { recursive: true, force: true });
	for (const key of Object.keys(live)) delete live[key];
});

const require = createRequire(import.meta.url);
const runtimeDirectory = resolve(
	import.meta.dirname,
	`../../desktop/plugin-runtime/${process.platform}-${process.arch}`,
);
const pdfjsRoot = await realpath(dirname(require.resolve("pdfjs-dist/package.json")));
const RUNTIME = `import {createManagedTaskApplication} from './dist/managed-runtime.mjs';
export default async context=>{
 const app=createManagedTaskApplication(context);
 return {...app,operations:{...app.operations,
  fixtureView:{effect:'read',inputSchema:{type:'null'},resultSchema:{type:'object'},execute:(_input,ctx)=>app.withCurrentSession(ctx.signal,session=>session.controller.journal.view())},
 }};
};`;
const TITLE = "Gut microbiota signatures in germ-free mice";
const DOI = "10.1000/gut.2021.001";

/** A one-page PDF showing `text`. */
function pdfWith(text) {
	const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
	const objects = [
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
		`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
	];
	let body = "%PDF-1.4\n";
	const offsets = objects.map((object, index) => {
		const offset = body.length;
		body += `${index + 1} 0 obj\n${object}\nendobj\n`;
		return offset;
	});
	const xref = body.length;
	body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
	body += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
	body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	return Buffer.from(body, "latin1");
}

async function writeFixture(dir) {
	await mkdir(dir);
	await writeFile(
		join(dir, "package.json"),
		JSON.stringify({
			name: "@fixture/tasks",
			version: "1.0.0",
			type: "module",
			files: ["runtime.mjs", "native.mjs", "plugin.manifest.json", "dist"],
			pi: { extensions: ["./native.mjs"] },
		}),
	);
	await writeFile(join(dir, "runtime.mjs"), RUNTIME);
	await writeFile(
		join(dir, "native.mjs"),
		"export default()=>{throw new Error('Desktop must use the managed owner.');};",
	);
	await cp(dirname(require.resolve("@gyoungwe/pi-core")), join(dir, "dist"), { recursive: true });
	await writeFile(
		join(dir, "plugin.manifest.json"),
		JSON.stringify({
			schemaVersion: 1,
			id: "drone-fixture-tasks",
			version: "1.0.0",
			pi: { apiVersion: 1, minHostVersion: "1.1.0", testedHosts: ["1.1.0"] },
			capabilities: ["core"],
			hosts: ["drone-desktop", "native-pi"],
			entrypoints: { desktopRuntime: "./runtime.mjs", extension: "./native.mjs" },
			drone: {
				pluginApi: 1,
				resultContract: "drone-result/v3",
				taskGrants: "request",
				workspaceRead: "session",
				// As pi-core's manifest declares it at the managed switch: Vault acceptance asks the knowledge plugin.
				requires: { knowledge: { service: "knowledge.binding", version: 1 } },
				provides: { "fixture.tasks": { version: 1, operations: ["fixtureView"] } },
			},
			permissions: { filesystem: ["workspace-read"], network: [], subprocess: [] },
			tools: [],
		}),
	);
}

async function installFixture() {
	const dir = join(live.root, "source");
	await writeFixture(dir);
	const [pack] = JSON.parse(
		execFileSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", live.root], {
			cwd: dir,
			encoding: "utf8",
		}),
	);
	const prefix = join(live.root, "installed");
	await mkdir(prefix);
	await writeFile(join(prefix, "package.json"), JSON.stringify({ private: true, type: "module" }));
	const flags = ["--ignore-scripts", "--offline", "--no-audit", "--no-fund", "--package-lock=false"];
	execFileSync("npm", ["install", "--prefix", prefix, ...flags, join(live.root, pack.filename)], {
		encoding: "utf8",
	});
	return (await discoverInstalledPackages(join(prefix, "node_modules"))).map((item) => {
		if ("error" in item || !item.runtime) throw new Error(JSON.stringify(item));
		return { name: `package:${item.packageRoot}`, source: item.runtime, state: "enabled" };
	});
}

/** The host's real capabilities, recording each PDF the plugin hands to document.pdfText. */
const hostCapabilities = (service, source, parsed) => {
	const handlers = {
		...service.getPluginSessionCapabilities(),
		...service.getPluginSourceCapabilities(source),
		...service.getPluginWorkspaceCapabilities({ runtimeDirectory, pdfjsRoot }),
	};
	const pdfText = handlers["document.pdfText"];
	if (pdfText)
		handlers["document.pdfText"] = {
			...pdfText,
			execute: (input, context) => {
				parsed.push(createHash("sha256").update(Buffer.from(input.base64, "base64")).digest("hex"));
				return pdfText.execute(input, context);
			},
		};
	return handlers;
};

async function startBackend(catalog, cwd, agentDir) {
	const owner = { id: 21, isDestroyed: () => false };
	const parsed = [];
	live.backend = createBackend({
		projectTrust: false,
		lazyCapabilities: false,
		permissionGates: true,
		tools: ["read", "task_plan", "task_wait", "task_status", "task_reconcile"],
		desktopIntegration: {
			appendSystemPrompt: [],
			additionalSkillPaths: [],
			additionalExtensionPaths: catalog.map((item) => item.source.nativeEntrypoint),
			pluginRuntimeDirectory: runtimeDirectory,
			nativeRuntime: {
				begin: () =>
					live.bridge.beginNative(
						owner,
						(path) => catalog.find((i) => i.source.nativeEntrypoint === path)?.name,
					),
				manages: (path) => catalog.some((i) => i.source.nativeEntrypoint === path),
			},
		},
	});
	const service = live.backend.sessions;
	service.modelRuntime = await offlineModels(agentDir);
	live.bridge = new PluginRuntimeBridge({
		source: (name) => catalog.find((item) => item.name === name)?.source,
		sources: () => catalog,
		enabled: () => true,
		approve: async () => true,
		factory: (source) => createProcessPluginRuntime({ ...source, runtimeDirectory }),
		getSessionContext: (id) => service?.getPluginCallerContext(id),
		taskGrants: service.getTaskGrants(),
		capabilities: (source) => () => ({ resources: [], handlers: hostCapabilities(service, source, parsed) }),
	});
	return { service, owner, parsed, cwd };
}

async function offlineModels(agentDir) {
	const modelRuntime = await ModelRuntime.create({
		authPath: join(agentDir, "auth.json"),
		modelsPath: null,
		allowModelNetwork: false,
		refreshOnCreate: false,
	});
	live.faux = fauxProvider({ provider: "managed-pdf-offline", tokensPerSecond: 0 });
	modelRuntime.registerNativeProvider(live.faux.provider);
	vi.spyOn(modelRuntime, "hasConfiguredAuth").mockReturnValue(true);
	return modelRuntime;
}

/** The offline model plans one report, asks the user to download the paper, then waits. */
const respond = (context) => {
	if (!getCurrentTools(context.messages || []).some((tool) => tool.name === "task_plan"))
		return fauxAssistantMessage("internal");
	const last = context.messages.findLast((m) => m.role === "assistant" || m.role === "toolResult");
	if (last?.role === "toolResult")
		return last.toolName === "task_plan"
			? fauxAssistantMessage(
					[
						fauxToolCall("task_wait", {
							kind: "download",
							title: TITLE,
							reason: "Download the paper",
							doi: DOI,
						}),
					],
					{ stopReason: "toolUse" },
				)
			: fauxAssistantMessage("waiting for the paper");
	return fauxAssistantMessage(
		[
			fauxToolCall("task_plan", {
				goal: "Summarize the paper",
				summary: "One summary of the downloaded paper",
				writeDirectories: ["outputs"],
				milestones: [
					{ id: "s", title: "Summary", dependsOn: [], acceptance: { kind: "file", path: "outputs/s.md" } },
				],
			}),
		],
		{ stopReason: "toolUse" },
	);
};

async function setup() {
	live.root = await realpath(await mkdtemp(join(tmpdir(), "drone-managed-pdf-")));
	const catalog = await installFixture();
	const home = join(live.root, "home"),
		cwd = join(home, "project"),
		agentDir = join(live.root, "agent");
	await mkdir(join(cwd, "outputs"), { recursive: true });
	await mkdir(agentDir);
	vi.stubEnv("HOME", home);
	vi.stubEnv("USERPROFILE", home);
	vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
	vi.stubEnv("DRONE_KNOWLEDGE_DIR", undefined);
	vi.stubEnv("DRONE_REPLY_LANGUAGE", "zh");
	const { service, owner, parsed } = await startBackend(catalog, cwd, agentDir);
	const meta = await service.createSession({
		cwd,
		provider: live.faux.provider.id,
		modelId: live.faux.getModel().id,
	});
	const entry = service.registry.get(meta.sessionId);
	const errors = [];
	entry.session.extensionRunner.onError((error) => errors.push(`${error.event}: ${error.error}`));
	const binding = await live.bridge.bind(catalog[0].name, owner),
		selection = live.bridge.selectSession(owner, meta.sessionId);
	live.faux.setResponses(Array.from({ length: 40 }, () => respond));
	const prompt = async (text) => {
		await entry.session.prompt(text, { expandPromptTemplates: text.startsWith("/") });
		await entry.session.agent.waitForIdle?.();
		await entry.session.waitForIdle?.();
		await vi.waitFor(() => expect(entry.session.isStreaming).toBe(false));
	};
	const view = () => live.bridge.invoke(owner, binding, "fixtureView", null, selection);
	return { cwd, errors, parsed, prompt, view };
}

/** Plans, waits for the download, then hands `pdf` to the action from the task panel. */
async function handOver(t, pdf) {
	await t.prompt("Summarize the paper I am about to download");
	const before = await t.view();
	const [task] = before.tasks;
	const [action] = task.actions;
	await writeFile(join(t.cwd, "outputs/paper.pdf"), pdf);
	const input = {
		taskId: task.id,
		revision: before.revision,
		actionId: action.id,
		action: "file",
		path: "outputs/paper.pdf",
	};
	await t.prompt(`/task-action ${Buffer.from(JSON.stringify(input)).toString("base64url")}`);
	return (await t.view()).tasks[0].actions.find((item) => item.id === action.id);
}

it("the host's isolated parser identifies the downloaded PDF for the managed task", async () => {
	const t = await setup();
	const pdf = pdfWith(`${TITLE} doi:${DOI}`);
	const action = await handOver(t, pdf);
	expect(t.parsed).toEqual([createHash("sha256").update(pdf).digest("hex")]);
	expect(action.file).toMatchObject({
		kind: "pdf",
		identity: "metadata-matched",
		sha256: createHash("sha256").update(pdf).digest("hex"),
		extraction: { pages: 1, partial: false },
	});
	expect(t.errors).toEqual([]);
}, 120000);

it("a PDF of another paper is refused and the action keeps waiting", async () => {
	const t = await setup();
	const action = await handOver(t, pdfWith(`${TITLE} doi:10.1000/other.2020.009`));
	expect(t.parsed).toHaveLength(1);
	expect(action).toMatchObject({ state: "pending", file: null });
}, 120000);
