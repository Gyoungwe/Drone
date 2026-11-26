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
import { childEnvironment, declaredContextWindow, type LiveProvider, type LiveSelection, liveSelection, runtimeKey } from "./measure-desktop-research-baseline-provider.mts";
import { runDesktopScenario } from "./measure-desktop-research-baseline-sdk.mts";
import { checked, readJson, saveReport, sha256, tokensFor } from "./research-baseline-io.mts";

const repo = resolve(import.meta.dirname, "..");
const text = Type.String({ minLength: 1 });
const maxBilledTokens = 500000;
type Result = Awaited<ReturnType<typeof runDesktopScenario>>;

export function runFixtureChild<ResultType>(fixture: DesktopFixture, entry = import.meta.filename, live?: LiveProvider): Promise<ResultType> {
	return new Promise((resolveResult, reject) => {
		const child = fork(entry, [], { cwd: repo, execArgv: [], env: childEnvironment(fixture, live), stdio: ["ignore", "ignore", "ignore", "ipc"] });
		let response: { result?: ResultType; error?: string } | undefined;
		let childError: Error | undefined;
		child.once("message", (message) => { response = message as typeof response; });
		child.once("error", (error) => { childError = error; });
		child.once("close", (code, signal) => {
			if (childError) reject(childError);
			else if (code !== 0 || response?.result === undefined) reject(new Error(`${fixture.scenario.id}: ${response?.error ?? `scenario child exited (${code ?? signal}) without a result`}`));
			else resolveResult(response.result);
		});
		const { apiKey: _apiKey, ...selection } = live ?? {};
		child.send({ fixture, selection: live ? selection : undefined });
	});
}

export function serveFixtureChild<ResultType>(run: (fixture: DesktopFixture, live?: LiveProvider) => Promise<ResultType>) {
	process.once("message", async ({ fixture, selection }: { fixture: DesktopFixture; selection?: LiveSelection }) => {
		try {
			process.send?.({ result: await run(fixture, selection && { ...selection, apiKey: runtimeKey(process.env) }) });
		} catch (error) {
			process.exitCode = 1;
			process.send?.({ error: selection ? "Live scenario failed" : error instanceof Error ? error.message : "Offline scenario failed" });
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

type Runner = (fixture: DesktopFixture, live?: LiveProvider) => Promise<Result>;
async function runBaseline(fixturePath: string, out: string, run: Runner, live?: LiveProvider) {
	await assertNewOutput(out);
	await verifySourceBudget();
	const fixture = validateDesktopFixture(await readJson(fixturePath));
	const state = await repoState();
	const results = [];
	for (const scenario of fixture.scenarios) {
		const entry = await withDesktopFixture(scenario, async (prepared) => ({
			resources: prepared.resources.map(({ path, sha256: digest }) => ({ path: relative(prepared.agentDir, path), sha256: digest })),
			result: await run(prepared, live),
		}));
		printOutcome(entry.result);
		if (!live && !entry.result.observation.expectationMatched) throw new Error(`${scenario.id}: native terminal state differs from the design`);
		results.push(entry);
	}
	const [first] = results;
	const budgetEvidence = results.find(({ result }) => live ? result.observation.stop.breakerReceipt !== null :
		result.observation.scenarioId === "stall-loop")?.result.observation.stop.breakerReceipt ?? null;
	if (!first || (!live && budgetEvidence?.limits.maxBilledTokens !== maxBilledTokens)) throw new Error("Missing native 500000-token breaker evidence");
	const { provider, model, registeredToolNames } = first.result;
	if (results.some(({ result }) => result.registeredToolNames.join() !== registeredToolNames.join())) throw new Error("Desktop registered inventory varied by scenario");
	const report = validateDesktopReport({ kind: "drone.research.desktop-baseline", schemaVersion: 2, runId: randomUUID(),
		generatedAt: new Date().toISOString(), mode: live ? "live-sdk" : "offline-faux", toolSet: toolNames,
		repoState: { ...state, registeredToolNames },
		assembly: { artifacts: await Promise.all(artifactNames.map(async (name) => {
			const path = `.pi/extensions/${name}`;
			return { path, sha256: sha256(await readFile(join(repo, path))) };
		})), resources: first.resources },
		modelConfig: { provider, model, thinkingLevel: live?.thinkingLevel ?? "off",
			...(live ? { declaredContextWindow } : { contextWindow: first.result.observation.contextWindow }),
			baseUrl: live?.baseUrl ?? null, breakerBudget: { maxBilledTokens }, budgetEvidence },
		policy: { networkPolicy: live ? "loopback-gateway-only" : "deny-network", acquisition: "fixture-copy", identityTransport: "in-memory-zotero",
			approvalMechanism: "baseline-tool-call-policy", breakerUsageSource: live ? "sdk-provider" : "sdk-faux-estimate", setupConsent: "synthetic-unmeasured" },
		scenarios: results.map(({ result: { observation } }) => ({ ...observation, tokens: tokensFor(observation.usage), cost: null })),
	});
	await saveReport(out, report);
	console.log(`Saved Desktop baseline report: ${out}`);
}

export async function runDesktopBaseline(args: string[], env = process.env,
	run: Runner = (fixture, live) => runFixtureChild(fixture, import.meta.filename, live)) {
	const { values } = parseArgs({ args, options: { mode: { type: "string" }, fixture: { type: "string" }, out: { type: "string" },
		provider: { type: "string" }, model: { type: "string" }, thinking: { type: "string" }, "base-url": { type: "string" } } });
	if ((values.mode !== "offline-faux" && values.mode !== "live-sdk") || !values.fixture || !values.out)
		throw new Error("Expected --mode offline-faux|live-sdk --fixture PATH --out NEW_PATH");
	const selection = liveSelection(values);
	const live = selection && { ...selection, apiKey: runtimeKey(env) };
	const safeRunner: Runner = async (fixture, selected) => {
		try { return await run(fixture, selected); }
		catch (error) { if (selected) throw new Error(`${fixture.scenario.id}: Live scenario failed`); throw error; }
	};
	await runBaseline(resolve(values.fixture), resolve(values.out), safeRunner, live);
}

if (isMainModule(import.meta.url)) {
	if (process.send) serveFixtureChild(runDesktopScenario);
	else await runDesktopBaseline(process.argv.slice(2));
}
