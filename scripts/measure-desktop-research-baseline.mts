import { execFileSync, fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { Type } from "typebox";
import { isMainModule } from "./is-main-module.mjs";
import { artifactNames, type DesktopScenario, toolNames, validateDesktopFixture, validateDesktopReport } from "./measure-desktop-research-baseline-contract.mts";
import { type DesktopFixture, prepareDesktopFixture } from "./measure-desktop-research-baseline-fixture.mts";
import { runDesktopScenario } from "./measure-desktop-research-baseline-sdk.mts";
import { checked, readJson, saveReport, sha256, tokensFor } from "./research-baseline-io.mts";

const repo = resolve(import.meta.dirname, "..");
const text = Type.String({ minLength: 1 });
const maxBilledTokens = 500000;
type Result = Awaited<ReturnType<typeof runDesktopScenario>>;

function childEnvironment(fixture: DesktopFixture) {
	return { HOME: fixture.home, USERPROFILE: fixture.home, PI_CODING_AGENT_DIR: fixture.agentDir,
		DRONE_KNOWLEDGE_DIR: fixture.app, TMPDIR: fixture.tmp, TMP: fixture.tmp, TEMP: fixture.tmp,
		XDG_CONFIG_HOME: fixture.config, XDG_CACHE_HOME: fixture.cache, XDG_DATA_HOME: fixture.data };
}

export function runFixtureChild<ResultType>(fixture: DesktopFixture, entry = import.meta.filename): Promise<ResultType> {
	return new Promise((resolveResult, reject) => {
		const child = fork(entry, [], { cwd: repo, execArgv: [], env: childEnvironment(fixture), stdio: ["ignore", "ignore", "ignore", "ipc"] });
		let response: { result?: ResultType; error?: string } | undefined;
		let childError: Error | undefined;
		child.once("message", (message) => { response = message as typeof response; });
		child.once("error", (error) => { childError = error; });
		child.once("close", (code, signal) => {
			if (childError) reject(childError);
			else if (code !== 0 || response?.result === undefined) reject(new Error(`${fixture.scenario.id}: ${response?.error ?? `scenario child exited (${code ?? signal}) without a result`}`));
			else resolveResult(response.result);
		});
		child.send(fixture);
	});
}

export function serveFixtureChild<ResultType>(run: (fixture: DesktopFixture) => Promise<ResultType>) {
	process.once("message", async (fixture: DesktopFixture) => {
		try {
			process.send?.({ result: await run(fixture) });
		} catch (error) {
			process.exitCode = 1;
			process.send?.({ error: error instanceof Error ? error.message : "Offline scenario failed" });
		} finally {
			process.disconnect?.();
		}
	});
}

export async function withDesktopFixture<ResultType>(scenario: DesktopScenario, run: (fixture: DesktopFixture) => Promise<ResultType>) {
	const sandbox = await mkdtemp(join(tmpdir(), "drone-desktop-baseline-"));
	try {
		return await run(await prepareDesktopFixture(sandbox, scenario));
	} finally {
		await rm(sandbox, { recursive: true, force: true });
	}
}

async function repoState() {
	const [sdk, lock, staged] = await Promise.all([
		readJson(join(repo, "node_modules/@earendil-works/pi-coding-agent/package.json")),
		readJson(join(repo, "plugins.lock.json")), readJson(join(repo, "vendor/plugins/pi-research/.drone-fetch.json")),
	]);
	const plugins = checked(Type.Object({ plugins: Type.Array(Type.Object({ name: text, commit: text })) }), lock, "plugin pins").plugins;
	const installed = checked(Type.Object({ commit: text, sha256: text }), staged, "staged research package");
	if (plugins.find(({ name }) => name === "@gyoungwe/pi-research")?.commit !== installed.commit) throw new Error("Staged research differs from its pin");
	return { droneCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(),
		pluginsCommit: installed.commit, stagedPluginSha256: installed.sha256,
		piSdkVersion: checked(Type.Object({ version: text }), sdk, "SDK version").version };
}

async function assertNewOutput(out: string) {
	try { await lstat(out); } catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
		throw error;
	}
	throw new Error("Output already exists");
}

async function verifySourceBudget() {
	const source = await readFile(join(repo, "packages/extensions/src/research-loop.ts"), "utf8");
	const configured = /breakerBudget:\s*\{\s*maxBilledTokens:\s*([\d_]+)\s*\}/.exec(source)?.[1];
	if (Number(configured?.replaceAll("_", "")) !== maxBilledTokens) throw new Error("Desktop source breaker budget differs from the baseline");
}

function printOutcome(result: Result) {
	const { scenarioId, routeObserved, toolCalls, runStatus, evidence, preflight, publication, stop, expectationMatched } = result.observation;
	console.log(JSON.stringify({ scenarioId, routeObserved, toolCalls, runStatus, evidence, preflight, publication, stop, expectationMatched }));
}

async function runOffline(fixturePath: string, out: string) {
	await assertNewOutput(out);
	await verifySourceBudget();
	const fixture = validateDesktopFixture(await readJson(fixturePath));
	const state = await repoState();
	const results = [];
	for (const scenario of fixture.scenarios) {
		const entry = await withDesktopFixture(scenario, async (prepared) => ({
			resources: prepared.resources.map(({ path, sha256: digest }) => ({ path: relative(prepared.agentDir, path), sha256: digest })),
			result: await runFixtureChild<Result>(prepared),
		}));
		printOutcome(entry.result);
		if (!entry.result.observation.expectationMatched) throw new Error(`${scenario.id}: native terminal state differs from the design`);
		results.push(entry);
	}
	const [first] = results;
	const budgetEvidence = results.find(({ result }) => result.observation.scenarioId === "stall-loop")?.result.observation.stop.breakerReceipt;
	if (!first || budgetEvidence?.limits.maxBilledTokens !== maxBilledTokens) throw new Error("Missing native 500000-token breaker evidence");
	const { provider, model, registeredToolNames } = first.result;
	if (results.some(({ result }) => result.registeredToolNames.join() !== registeredToolNames.join())) throw new Error("Desktop registered inventory varied by scenario");
	const report = validateDesktopReport({ kind: "drone.research.desktop-baseline", schemaVersion: 2, runId: randomUUID(),
		generatedAt: new Date().toISOString(), mode: "offline-faux", toolSet: toolNames,
		repoState: { ...state, registeredToolNames },
		assembly: { artifacts: await Promise.all(artifactNames.map(async (name) => {
			const path = `.pi/extensions/${name}`;
			return { path, sha256: sha256(await readFile(join(repo, path))) };
		})), resources: first.resources },
		modelConfig: { provider, model, thinkingLevel: "off", contextWindow: first.result.observation.contextWindow,
			baseUrl: null, breakerBudget: { maxBilledTokens }, budgetEvidence },
		policy: { networkPolicy: "deny-network", acquisition: "fixture-copy", identityTransport: "in-memory-zotero",
			approvalMechanism: "baseline-tool-call-policy", breakerUsageSource: "sdk-faux-estimate", setupConsent: "synthetic-unmeasured" },
		scenarios: results.map(({ result: { observation } }) => ({ ...observation, tokens: tokensFor(observation.usage), cost: null })),
	});
	await saveReport(out, report);
	console.log(`Saved Desktop baseline report: ${out}`);
}

if (isMainModule(import.meta.url)) {
	if (process.send) serveFixtureChild(runDesktopScenario);
	else {
		const { values } = parseArgs({ options: { mode: { type: "string" }, fixture: { type: "string" }, out: { type: "string" } } });
		if (values.mode !== "offline-faux" || !values.fixture || !values.out) throw new Error("Expected --mode offline-faux --fixture PATH --out NEW_PATH");
		await runOffline(resolve(values.fixture), resolve(values.out));
	}
}
