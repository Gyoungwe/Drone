#!/usr/bin/env node
// Real SDK session against Drone's generated host adapter; no production Vault or model credentials.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const flag = (name, fallback) => {
	const index = process.argv.indexOf(name);
	return index < 0 ? fallback : process.argv[index + 1];
};
const hostRoot = resolve(flag("--host-root", resolve(import.meta.dirname, "..")));
if (!process.argv.includes("--probe")) {
	const root = await mkdtemp(join(tmpdir(), "drone-research-host-"));
	try {
		const home = join(root, "home");
		await mkdir(home);
		const child = spawnSync(
			process.execPath,
			[fileURLToPath(import.meta.url), "--probe", "--host-root", hostRoot, "--workspace-root", root],
			{
				cwd: root,
				encoding: "utf8",
				maxBuffer: 4 * 1024 * 1024,
				env: {
					PATH: process.env.PATH,
					HOME: home,
					TMPDIR: tmpdir(),
					LANG: "en_US.UTF-8",
					PI_CODING_AGENT_DIR: join(home, ".pi/agent"),
					DRONE_KNOWLEDGE_DIR: join(root, "knowledge-config"),
				},
			},
		);
		assert.equal(child.status, 0, child.stderr);
		const evidence = JSON.parse(child.stdout.trim().split("\n").at(-1));
		const output = flag("--out");
		if (output) await writeFile(resolve(output), `${JSON.stringify(evidence, null, 2)}\n`);
		console.log(JSON.stringify(evidence, null, 2));
	} finally {
		await rm(root, { recursive: true, force: true });
	}
} else {
	const { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } =
		await import(pathToFileURL(join(hostRoot, "node_modules/@earendil-works/pi-coding-agent/dist/index.js")));
	const { fauxProvider, fauxAssistantMessage, fauxToolCall } = await import(
		pathToFileURL(join(hostRoot, "node_modules/@earendil-works/pi-ai/dist/index.js"))
	);
	const extensionPath = join(hostRoot, ".pi/extensions/research-loop.mjs");
	const cwd = join(flag("--workspace-root"), "project");
	const agentDir = process.env.PI_CODING_AGENT_DIR;
	await mkdir(join(cwd, ".pi"), { recursive: true });
	await mkdir(agentDir, { recursive: true });
	await writeFile(
		join(cwd, ".pi/research-workspace.json"),
		JSON.stringify({ resultsRoot: "results", knowledgeProjectId: "host-session-acceptance" }),
	);
	await writeFile(join(cwd, "source.md"), "# Synthetic host session evidence\nHOST_RESEARCH_ACCEPTANCE\n");
	const settingsManager = SettingsManager.inMemory({ projectTrusted: true });
	const loader = new DefaultResourceLoader({
		cwd,
		agentDir,
		settingsManager,
		noExtensions: true,
		noSkills: true,
		additionalExtensionPaths: [extensionPath],
	});
	await loader.reload();
	assert.deepEqual(loader.getExtensions().errors, []);
	assert(loader.getExtensions().extensions.some((extension) => extension.tools.has("research_loop")));
	const modelRuntime = await ModelRuntime.create({
		authPath: join(agentDir, "auth.json"),
		modelsPath: null,
		modelsStorePath: join(agentDir, "models.json"),
		allowModelNetwork: false,
		refreshOnCreate: false,
	});
	const faux = fauxProvider({ provider: "host-research-acceptance", tokensPerSecond: 100000 });
	modelRuntime.registerNativeProvider(faux.provider);
	await modelRuntime.setRuntimeApiKey("host-research-acceptance", "offline-test-only");
	const sessions = [];
	const ids = [];
	let dispatchCount = 0;
	async function open() {
		const sessionManager = SessionManager.inMemory(cwd);
		ids.push(sessionManager.getSessionId());
		const { session } = await createAgentSession({
			cwd,
			agentDir,
			settingsManager,
			resourceLoader: loader,
			modelRuntime,
			model: faux.getModel(),
			sessionManager,
			tools: ["research_loop", "read"],
		});
		sessions.push(session);
		await session.bindExtensions({});
		return session;
	}
	async function turn(session, calls) {
		const receipts = [];
		const unsubscribe = session.subscribe((event) => {
			if (event.type === "tool_execution_end") receipts.push(event);
		});
		faux.setResponses([
			...calls.map(({ name, args }) =>
				fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" }),
			),
			fauxAssistantMessage("Host session acceptance complete."),
		]);
		try {
			await session.prompt("Execute the scheduled host acceptance checks.");
			assert.equal(receipts.length, calls.length);
			assert.deepEqual(
				receipts.map((receipt) => receipt.toolName),
				calls.map((call) => call.name),
			);
			dispatchCount += receipts.length;
			return receipts;
		} finally {
			unsubscribe();
		}
	}
	const research = (args) => ({ name: "research_loop", args });
	try {
		const first = await open();
		const initial = await turn(first, [
			research({ action: "start", query: "host acceptance", project: "wrong-model-project" }),
			{ name: "read", args: { path: "source.md" } },
			research({ action: "status" }),
		]);
		assert(initial.every((receipt) => receipt.isError === false));
		const runDir = initial[0].result.details.run_dir;
		assert.equal(initial[0].result.details.metadata.project, "host-session-acceptance");
		assert.equal(initial[2].result.details.evidence_gate.answerable, false);
		assert.equal(
			initial[2].result.details.receipt_journal.buffered,
			1,
			"actual SDK read event must reach the host receipt journal",
		);
		const invalid = await turn(first, [
			research({ action: "bind_claims", run_dir: runDir, claim_bindings: [] }),
			research({ action: "finalize", run_dir: runDir }),
		]);
		assert(
			invalid.every((receipt) => receipt.isError === true),
			"empty claims cannot close the research gate",
		);
		const second = await open();
		assert.notEqual(ids[0], ids[1]);
		const isolated = await turn(second, [
			research({ action: "status" }),
			research({ action: "status", run_dir: runDir }),
		]);
		assert.equal(isolated[0].isError, false);
		assert.equal(isolated[0].result.details.evidence_gate.stage, "not-started");
		assert.equal(isolated[1].isError, true, "another active session owns the run");
		const metadata = JSON.parse(await readFile(join(runDir, "metadata.json"), "utf8"));
		assert.equal(metadata.evidence_gate.answerable, false);
		const sdk = JSON.parse(
			await readFile(join(hostRoot, "node_modules/@earendil-works/pi-coding-agent/package.json"), "utf8"),
		);
		console.log(
			JSON.stringify({
				status: "PASS",
				sdkVersion: sdk.version,
				extensionSha256: createHash("sha256")
					.update(await readFile(extensionPath))
					.digest("hex"),
				sessions: ids.length,
				dispatchCount,
				hostWorkspaceProjectBinding: true,
				generatedHostAdapterLoaded: true,
				actualReadReceiptObserved: true,
				emptyClaimsBlocked: true,
				sameWorkspaceSessionIsolation: true,
				persistedGateReadBack: true,
				model: "SDK faux provider; real AgentSession and tool dispatch, offline deterministic model",
				isolation:
					"Fresh HOME/agent/workspace/knowledge configuration; environment allowlist; no production Vault or user credentials",
			}),
		);
	} finally {
		for (const session of sessions) session.dispose();
	}
}
