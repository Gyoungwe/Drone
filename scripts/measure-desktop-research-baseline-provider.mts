import { readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ModelThinkingLevel, Usage } from "@earendil-works/pi-ai";
import type * as Sdk from "@earendil-works/pi-coding-agent";
import type { DesktopFixture, installFixtureFetch } from "./measure-desktop-research-baseline-fixture.mts";
import type { offlineModel } from "./measure-desktop-research-baseline-faux.mts";

const thinkingLevels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const satisfies readonly ModelThinkingLevel[];
export const declaredContextWindow = 1048576;
export type LiveSelection = { provider: string; model: string; thinkingLevel: ModelThinkingLevel; baseUrl: string };
export type LiveProvider = LiveSelection & { apiKey: string };

export function validateBaseUrl(value: string) {
	const literal = /^http:\/\/(127\.0\.0\.1|localhost):([1-9][0-9]*)(?:\/[^\s\\?#]*)?$/u.exec(value);
	const url = URL.parse(value);
	const port = Number(literal?.[2]);
	if (!literal || literal[0] !== value || !url || !Number.isInteger(port) || port < 1 || port > 65535 ||
		url.protocol !== "http:" || url.hostname !== literal[1] || Number(url.port || 80) !== port ||
		url.username || url.password || url.search || url.hash) throw new Error("只允许本机网关: expected explicit HTTP loopback host and port");
	return value;
}

export function liveSelection(values: { mode?: string; provider?: string; model?: string; thinking?: string; "base-url"?: string }) {
	const { mode, provider, model, thinking, "base-url": baseUrl } = values;
	if (mode === "offline-faux") {
		if ([provider, model, thinking, baseUrl].some((value) => value !== undefined)) throw new Error("--provider, --model, --thinking and --base-url require --mode live-sdk");
		return undefined;
	}
	const checkedUrl = validateBaseUrl(baseUrl ?? "");
	const thinkingLevel = thinkingLevels.find((level) => level === thinking);
	if (!provider?.trim() || !model?.trim() || !thinkingLevel) throw new Error("Expected --provider, --model and a valid --thinking level");
	return { provider, model, thinkingLevel, baseUrl: checkedUrl };
}

export function runtimeKey(env: NodeJS.ProcessEnv) {
	const key = env.DRONE_BASELINE_API_KEY;
	if (!key?.trim()) throw new Error("DRONE_BASELINE_API_KEY is required in live-sdk mode");
	return key;
}

export function childEnvironment(fixture: DesktopFixture, live?: LiveProvider) {
	return { HOME: fixture.home, USERPROFILE: fixture.home, PI_CODING_AGENT_DIR: fixture.agentDir,
		DRONE_KNOWLEDGE_DIR: fixture.app, TMPDIR: fixture.tmp, TMP: fixture.tmp, TEMP: fixture.tmp,
		XDG_CONFIG_HOME: fixture.config, XDG_CACHE_HOME: fixture.cache, XDG_DATA_HOME: fixture.data,
		...(live ? { DRONE_BASELINE_API_KEY: live.apiKey } : {}) };
}

export function gatewayFetch(baseUrl: string, fixtureFetch: typeof fetch, transport: typeof fetch,
	violations: ReturnType<typeof installFixtureFetch>["violations"]) {
	const endpoint = new URL(`${validateBaseUrl(baseUrl).replace(/\/+$/u, "")}/chat/completions`).href;
	return (async (input, init) => {
		const url = URL.parse(input instanceof Request ? input.url : String(input));
		const method = init?.method ?? (input instanceof Request ? input.method : "GET");
		if (url?.href !== endpoint || method !== "POST") return fixtureFetch(input, init);
		if (violations.length) throw new Error("Live fixture fetch blocked after a policy violation");
		const response = await transport(input, { ...init, redirect: "manual" });
		if (response.redirected || (response.status >= 300 && response.status < 400)) {
			violations.push({ reason: "gateway-redirect" });
			await response.body?.cancel();
			throw new Error("Live gateway redirect forbidden");
		}
		return response;
	}) satisfies typeof fetch;
}

export async function withLiveConfig<Result>(fixture: DesktopFixture, live: LiveProvider | undefined, run: () => Promise<Result>) {
	if (!live) return run();
	const { provider, model, thinkingLevel, baseUrl } = live;
	const path = join(fixture.agentDir, "models.json");
	const config = JSON.stringify({ providers: { [provider]: { api: "openai-completions", baseUrl: validateBaseUrl(baseUrl),
		models: [{ id: model, contextWindow: declaredContextWindow, input: ["text"], reasoning: thinkingLevel !== "off" }] } } });
	await writeFile(path, config, { mode: 0o600, flag: "wx" });
	try {
		if (await readFile(path, "utf8") !== config) throw new Error("Live models.json read-back mismatch");
		return await run();
	} finally {
		await unlink(path);
	}
}

export async function scenarioRuntime(sdk: typeof Sdk, agentDir: string, selected: ReturnType<typeof offlineModel> | LiveProvider) {
	const live = "apiKey" in selected;
	const modelRuntime = await sdk.ModelRuntime.create({ authPath: join(agentDir, "auth.json"),
		modelsPath: live ? join(agentDir, "models.json") : null, modelsStorePath: join(agentDir, "model-cache.json"),
		allowModelNetwork: false, refreshOnCreate: false });
	if (!live) {
		modelRuntime.registerNativeProvider(selected.provider);
		return { modelRuntime, model: selected.model, thinkingLevel: "off" as const };
	}
	await modelRuntime.setRuntimeApiKey(selected.provider, selected.apiKey);
	const model = modelRuntime.getModel(selected.provider, selected.model);
	if (!model || model.api !== "openai-completions" || model.baseUrl !== selected.baseUrl || model.contextWindow !== declaredContextWindow ||
		model.input.join() !== "text" || model.reasoning !== (selected.thinkingLevel !== "off")) throw new Error("Live provider resolution differs from isolated config");
	return { modelRuntime, model, thinkingLevel: selected.thinkingLevel };
}

export function liveUsage(sample: Usage & { reported?: boolean }) {
	const { input, output, cacheRead, cacheWrite, reasoning, reported } = sample;
	if (!(reported ?? [input, output, cacheRead, cacheWrite].some((value) => value > 0))) return null;
	return { input, output, cacheRead, cacheWrite, ...(reasoning === undefined ? {} : { reasoning }) };
}
