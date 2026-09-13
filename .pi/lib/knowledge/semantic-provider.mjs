import { URL } from "node:url";

const MAX_BATCH = 32;
const MAX_CHARS = 120_000;
const MAX_RESPONSE = 8 * 1024 * 1024;
const ENV_NAME = /^[A-Z_][A-Z0-9_]{0,127}$/;
const MAX_VECTOR_COMPONENT = 1_000_000;
const MAX_VECTOR_NORM = 1_000_000_000;
const CONFIG_KEYS = new Set([
	"enabled",
	"provider",
	"baseUrl",
	"model",
	"credentialEnv",
	"remoteConsent",
	"timeoutMs",
	"chunkChars",
	"minSimilarity",
]);

function loopback(hostname) {
	return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}

export function validateSemanticConfig(input = {}) {
	if (!input || typeof input !== "object" || Array.isArray(input))
		throw new Error("Semantic settings must be an object");
	for (const key of Object.keys(input))
		if (!CONFIG_KEYS.has(key)) throw new Error(`Unknown semantic setting: ${key}`);
	if (input.enabled !== undefined && typeof input.enabled !== "boolean")
		throw new Error("enabled must be boolean");
	if (input.provider !== undefined && typeof input.provider !== "string")
		throw new Error("provider must be a string");
	const provider = input.provider ?? "none";
	if (!["none", "ollama", "openai-compatible"].includes(provider))
		throw new Error("Unknown semantic provider");
	if (input.remoteConsent !== undefined && typeof input.remoteConsent !== "boolean")
		throw new Error("remoteConsent must be boolean");
	if (
		input.timeoutMs !== undefined &&
		(!Number.isInteger(input.timeoutMs) || input.timeoutMs < 500 || input.timeoutMs > 30_000)
	)
		throw new Error("timeoutMs must be an integer between 500 and 30000");
	if (
		input.chunkChars !== undefined &&
		(!Number.isInteger(input.chunkChars) || input.chunkChars < 256 || input.chunkChars > 8_000)
	)
		throw new Error("chunkChars must be an integer between 256 and 8000");
	if (
		input.minSimilarity !== undefined &&
		(typeof input.minSimilarity !== "number" ||
			!Number.isFinite(input.minSimilarity) ||
			input.minSimilarity < 0 ||
			input.minSimilarity > 1)
	)
		throw new Error("minSimilarity must be a finite number between 0 and 1");
	const enabled = input.enabled ?? provider !== "none";
	const baseUrl = input.baseUrl === undefined ? "" : input.baseUrl;
	const model = input.model === undefined ? "" : input.model;
	const credentialEnv =
		input.credentialEnv === undefined || input.credentialEnv === null ? "" : input.credentialEnv;
	if (typeof baseUrl !== "string" || typeof model !== "string" || typeof credentialEnv !== "string")
		throw new Error("Semantic provider fields must be strings");
	const trimmedBase = baseUrl.trim();
	const trimmedModel = model.trim();
	const trimmedCredential = credentialEnv.trim();
	if (provider === "none") {
		if (enabled) throw new Error("The none provider cannot be enabled");
		if (input.remoteConsent === true) throw new Error("remoteConsent is not valid for the none provider");
		return {
			enabled: false,
			provider: "none",
			baseUrl: "",
			model: "",
			credentialEnv: "",
			remoteConsent: false,
		};
	}
	if (!enabled && !trimmedBase && !trimmedModel)
		return {
			enabled: false,
			provider,
			baseUrl: "",
			model: "",
			credentialEnv: trimmedCredential,
			remoteConsent: input.remoteConsent === true,
			timeoutMs: input.timeoutMs ?? 10_000,
			chunkChars: input.chunkChars ?? 1200,
			minSimilarity: input.minSimilarity ?? 0.45,
		};
	if (!trimmedBase || trimmedBase.length > 500 || !trimmedModel || trimmedModel.length > 200)
		throw new Error("Semantic provider base URL and model are required");
	if (trimmedCredential && !ENV_NAME.test(trimmedCredential))
		throw new Error("credentialEnv must be a valid environment variable name");
	let url;
	try {
		url = new URL(trimmedBase);
	} catch {
		throw new Error("Semantic provider base URL is invalid");
	}
	if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash)
		throw new Error("Semantic provider URL must be plain http(s) without credentials, query, or fragment");
	const remote = !loopback(url.hostname);
	if (remote && url.protocol === "http:") throw new Error("Remote semantic providers require HTTPS");
	if (remote && input.remoteConsent !== true)
		throw new Error("Remote semantic provider requires explicit remoteConsent");
	if (remote && !trimmedCredential)
		throw new Error("Remote semantic providers require a credential environment variable");
	return {
		enabled,
		provider,
		baseUrl: url.toString().replace(/\/+$/, ""),
		model: trimmedModel,
		credentialEnv: trimmedCredential,
		remoteConsent: input.remoteConsent === true,
		timeoutMs: input.timeoutMs ?? 10_000,
		chunkChars: input.chunkChars ?? 1200,
		minSimilarity: input.minSimilarity ?? 0.45,
	};
}

function endpoint(config) {
	const suffix = config.provider === "ollama" ? ["api/embed", "api"] : ["v1/embeddings", "v1"];
	const base = config.baseUrl.replace(/\/+$/, "");
	if (base.endsWith(`/${suffix[0]}`)) return base;
	if (base.endsWith(`/${suffix[1]}`)) return `${base}/${suffix[0].split("/").at(-1)}`;
	return `${base}/${suffix[0]}`;
}

async function readBounded(response) {
	const length = Number(response.headers.get("content-length"));
	if (Number.isFinite(length) && length > MAX_RESPONSE)
		throw new Error("Semantic provider response is too large");
	const reader = response.body?.getReader();
	if (!reader) {
		const text = await response.text();
		if (Buffer.byteLength(text) > MAX_RESPONSE) throw new Error("Semantic provider response is too large");
		return text;
	}
	const chunks = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > MAX_RESPONSE) {
			await reader.cancel();
			throw new Error("Semantic provider response is too large");
		}
		chunks.push(value);
	}
	return Buffer.concat(chunks).toString("utf8");
}

function vectors(value, expected) {
	if (!Array.isArray(value) || value.length !== expected)
		throw new Error("Semantic provider returned an invalid vector count");
	let dimension = 0;
	const out = value.map((item) => {
		if (!Array.isArray(item) || !item.length || item.length > 16_384)
			throw new Error("Semantic provider returned an invalid vector");
		if (!dimension) dimension = item.length;
		if (item.length !== dimension)
			throw new Error("Semantic provider returned inconsistent vector dimensions");
		const vector = item.map((n) => n);
		if (
			vector.some((n) => typeof n !== "number" || !Number.isFinite(n) || Math.abs(n) > MAX_VECTOR_COMPONENT)
		)
			throw new Error("Semantic provider returned NaN or infinite vector values");
		let sum = 0;
		for (const n of vector) {
			sum += n * n;
			if (!Number.isFinite(sum) || sum > MAX_VECTOR_NORM ** 2)
				throw new Error("Semantic provider returned an oversized vector norm");
		}
		if (!(sum > 0)) throw new Error("Semantic provider returned a zero-norm vector");
		return vector;
	});
	return { vectors: out, dimension };
}

export async function embedTexts(rawConfig, texts, { signal } = {}) {
	const config = validateSemanticConfig(rawConfig);
	if (!config.enabled) throw new Error("Semantic embeddings are disabled");
	if (
		!Array.isArray(texts) ||
		!texts.length ||
		texts.length > MAX_BATCH ||
		texts.some((text) => typeof text !== "string" || !text.length || text.length > 16_000) ||
		texts.join("\n").length > MAX_CHARS
	)
		throw new Error("Semantic embedding batch is outside bounded limits");
	const headers = { "content-type": "application/json", accept: "application/json" };
	if (config.credentialEnv) {
		const token = process.env[config.credentialEnv];
		if (!token) throw new Error(`Credential environment variable ${config.credentialEnv} is not set`);
		headers.authorization = `Bearer ${token}`;
	}
	const body =
		config.provider === "ollama"
			? { model: config.model, input: texts, truncate: false }
			: { model: config.model, input: texts, encoding_format: "float" };
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(new Error("Semantic provider timeout")), config.timeoutMs);
	const onAbort = () => controller.abort(signal.reason);
	if (signal) {
		if (signal.aborted) controller.abort(signal.reason);
		else signal.addEventListener("abort", onAbort, { once: true });
	}
	try {
		const response = await fetch(endpoint(config), {
			method: "POST",
			headers,
			body: JSON.stringify(body),
			redirect: "error",
			signal: controller.signal,
		});
		let raw;
		try {
			raw = await readBounded(response);
		} catch (error) {
			try {
				await response.body?.cancel();
			} catch {}
			throw error;
		}
		let payload;
		try {
			payload = JSON.parse(raw);
		} catch {
			throw new Error(`Semantic provider returned HTTP ${response.status}`);
		}
		if (!response.ok) throw new Error(`Semantic provider returned HTTP ${response.status}`);
		if (payload?.model !== undefined && payload.model !== config.model)
			throw new Error("Semantic provider returned an unexpected model");
		const embeddings =
			config.provider === "ollama"
				? payload?.embeddings
				: Array.isArray(payload?.data) && payload.data.length === texts.length
					? [...payload.data]
							.sort((a, b) => (a?.index ?? 0) - (b?.index ?? 0))
							.map((item, index) => {
								if (
									!Number.isInteger(item?.index) ||
									item.index !== index ||
									!Object.hasOwn(item, "embedding")
								)
									throw new Error("Semantic provider returned invalid embedding indexes");
								return item.embedding;
							})
					: null;
		return { ...vectors(embeddings, texts.length), provider: config.provider, model: config.model };
	} finally {
		clearTimeout(timer);
		if (signal) signal.removeEventListener("abort", onAbort);
	}
}

export const semanticLimits = Object.freeze({ MAX_BATCH, MAX_CHARS, MAX_RESPONSE });
