/**
 * The one door to TypeSafe's Jev (POST /v1/systemone). Jev answers typed questions about a state; the
 * harness turns the answers into decisions in code. The key comes from TYPESAFE_API_KEY or the macOS
 * Keychain item `typesafe-jev` and never reaches a file, a log line or a hook output. Without a key the
 * model layer is off and every point keeps its deterministic rule. A failed call is an error, never an
 * answer: callers record it and fall back to the rule, which can only be stricter than the model.
 */
import { spawnSync } from "node:child_process";

export const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
export const JEV_MODEL = "jev-latest";
export const KEYCHAIN_SERVICE = "typesafe-jev";
/** Hooks time out at 10 s; a slow answer must leave room for the rule path. */
export const JEV_TIMEOUT_MS = 7000;

/** `null` when no key is configured. */
export function apiKey(env = process.env, run = spawnSync) {
	if (env.TYPESAFE_API_KEY) return env.TYPESAFE_API_KEY;
	if (process.platform !== "darwin") return null;
	const found = run("security", ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"], {
		encoding: "utf8",
	});
	const key = found.status === 0 ? found.stdout.trim() : "";
	return key === "" ? null : key;
}

const SECRET_ASSIGNMENT =
	/\b([\w-]*(?:api[_-]?key|token|secret|password|passwd)[\w-]*)(\s*[:=]\s*)(["']?)[^\s"']+\3/gi;
const LONG_OPAQUE = /\b(?:sk|gh[pousr]|xox[bp])[-_][A-Za-z0-9_-]{16,}|\b[A-Za-z0-9+/_-]{40,}={0,2}/g;

/** Strip credential-looking values before any text leaves the machine. */
export function redact(text) {
	return text.replace(SECRET_ASSIGNMENT, "$1$2$3[redacted]$3").replace(LONG_OPAQUE, "[redacted]");
}

/**
 * Ask Jev; resolves to `{ answers, usage, model }` or throws. `deps.fetch` and `deps.key` exist for tests.
 * `questions` is a map of id → { type, instructions, criteria? } as in the TypeSafe API.
 */
export async function askJev(state, questions, deps = {}) {
	const key = "key" in deps ? deps.key : apiKey();
	if (key === null) throw new Error("no TypeSafe key");
	const response = await (deps.fetch ?? fetch)(JEV_ENDPOINT, {
		method: "POST",
		headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
		body: JSON.stringify({ model: JEV_MODEL, state, questions }),
		signal: AbortSignal.timeout(deps.timeoutMs ?? JEV_TIMEOUT_MS),
	});
	if (!response.ok) throw new Error(`TypeSafe HTTP ${response.status}`);
	const body = await response.json();
	for (const id of Object.keys(questions)) {
		if (body.answers?.[id] === undefined) throw new Error(`TypeSafe answer missing: ${id}`);
	}
	return { answers: body.answers, usage: body.usage ?? null, model: body.model ?? JEV_MODEL };
}
