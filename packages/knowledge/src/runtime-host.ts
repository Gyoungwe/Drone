/** Host seams used by knowledge runtime modules.
 *
 * The domain package owns the stateful implementation; desktop/CLI hosts inject
 * process event and runtime scheduling adapters at composition time. Defaults
 * are deterministic and safe for read-only package use and tests.
 */
export type RuntimeExclusive = <T>(namespace: string, key: string, work: () => Promise<T>) => Promise<T>;
export type ProcessEventEmitter = (event: unknown) => void;

const locks = new Map<string, Promise<void>>();
const defaultRunRuntimeExclusive: RuntimeExclusive = async <T>(_namespace: string, key: string, work: () => Promise<T>) => {
	const previous = locks.get(key) ?? Promise.resolve();
	let release!: () => void;
	const current = new Promise<void>((resolve) => {
		release = resolve;
	});
	locks.set(key, previous.then(() => current));
	await previous;
	try {
		return await work();
	} finally {
		release();
		if (locks.get(key) === current) locks.delete(key);
	}
};

let runtimeExclusive: RuntimeExclusive = defaultRunRuntimeExclusive;
let processEvent: ProcessEventEmitter = () => undefined;

export function configureKnowledgeRuntime(host: {
	runRuntimeExclusive?: RuntimeExclusive;
	emitProcessEvent?: ProcessEventEmitter;
} = {}): void {
	runtimeExclusive = host.runRuntimeExclusive ?? defaultRunRuntimeExclusive;
	processEvent = host.emitProcessEvent ?? (() => undefined);
}

export const runRuntimeExclusive: RuntimeExclusive = (namespace, key, work) =>
	runtimeExclusive(namespace, key, work);
export const emitProcessEvent: ProcessEventEmitter = (event) => processEvent(event);

const slots = new Map<string, unknown>();
export function runtimeSlot<T>(domain: string, key: string, factory: () => T): T {
	const slotKey = `${domain}:${key}`;
	if (!slots.has(slotKey)) slots.set(slotKey, factory());
	return slots.get(slotKey) as T;
}
export function diagnosticText(value: unknown, limit = 4096): string {
	if (typeof value !== "string" && typeof value !== "number") return "";
	return String(value)
		.slice(0, 8192)
		.replace(/https?:\/\/[^\s<>"']+/gi, (raw) => {
			try { const url = new URL(raw); url.username = ""; url.password = ""; url.search = ""; url.hash = ""; return url.toString(); }
			catch { return "[URL omitted]"; }
		})
		.replace(/(?:bearer\s+)[^\s,;"']+/gi, "Bearer [redacted]")
		.replace(/(["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|secret|authorization|cookie)["']?\s*[=:]\s*)(?:"[^"]*(?:"|$)|'[^']*(?:'|$)|[^\s,;]+)/gi, "$1[redacted]")
		.replace(/\b(?:sk-|ghp_|github_pat_)[A-Za-z0-9_-]{8,}/g, "[redacted]")
		.replace(/[\u0000-\u001f\u007f<>]/g, " ")
		.slice(0, Math.max(0, limit));
}
export function toolMeta(_toolName: string): unknown {
	return null;
}
export function flowCardBuilder(_toolName: string): unknown {
	return null;
}
