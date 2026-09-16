import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { knowledgeDirectory, readKnowledgeBinding, withKnowledgeBinding } from "./config.mjs";
import { invalidateKnowledgeUi } from "./ui-state.mjs";

const key = Symbol.for("drone.knowledge.specialists.v1");
globalThis[key] ??= {
	hosts: new Map(),
	active: 0,
	queue: [],
	settingsQueue: Promise.resolve(),
};
const state = globalThis[key];
export const SPECIALIST_LIMITS = Object.freeze({
	maxRunsPerTurn: 4,
	maxRunsPerSession: 20,
	maxToolOperations: 80,
	concurrency: 2,
	maxConcurrency: 4,
	queueLimit: 8,
	queueWaitMs: 15000,
	timeoutMs: 120000,
	maxTokensPerTurn: 24000,
	maxTokensPerSession: 120000,
	maxCostPerTurn: 1,
	maxCostPerSession: 5,
});
export const contextSessionId = (ctx) => ctx?.sessionManager?.getSessionId?.() || ctx?.sessionId || null;
export const specialistQueueSnapshot = () => ({ active: state.active, queueLength: state.queue.length });
export function registerKnowledgeSpecialistHost(id, run) {
	if (!id || typeof run !== "function") throw new Error("A specialist host requires a session identity");
	state.hosts.set(id, run);
	return () => {
		if (state.hosts.get(id) === run) state.hosts.delete(id);
	};
}
export function knowledgeSpecialistHost(ctx) {
	return state.hosts.get(contextSessionId(ctx));
}
export async function specialistSettings() {
	const dir = knowledgeDirectory();
	if (!dir) return { mode: "off", revision: 0, ...SPECIALIST_LIMITS };
	let data = { mode: "automatic", revision: 0 };
	try {
		data = JSON.parse(await readFile(join(dir, "specialists.json"), "utf8"));
	} catch (e) {
		if (e.code !== "ENOENT") throw new Error("Knowledge specialist settings cannot be read");
	}
	if (
		!["automatic", "manual", "off"].includes(data.mode) ||
		!Number.isSafeInteger(data.revision) ||
		data.revision < 0
	)
		throw new Error("Invalid knowledge specialist settings");
	const integerLimits = {
		maxRunsPerTurn: [1, SPECIALIST_LIMITS.maxRunsPerTurn],
		maxRunsPerSession: [1, SPECIALIST_LIMITS.maxRunsPerSession],
		maxToolOperations: [1, SPECIALIST_LIMITS.maxToolOperations],
		concurrency: [1, SPECIALIST_LIMITS.maxConcurrency],
		queueLimit: [1, SPECIALIST_LIMITS.queueLimit],
		queueWaitMs: [50, SPECIALIST_LIMITS.queueWaitMs],
		timeoutMs: [50, SPECIALIST_LIMITS.timeoutMs],
		maxTokensPerTurn: [1, SPECIALIST_LIMITS.maxTokensPerTurn],
		maxTokensPerSession: [1, SPECIALIST_LIMITS.maxTokensPerSession],
	};
	for (const key of Object.keys(integerLimits))
		if (data[key] !== undefined && (!Number.isSafeInteger(data[key]) || data[key] < integerLimits[key][0]))
			throw new Error("Invalid knowledge specialist settings");
	const costLimits = {
		maxCostPerTurn: SPECIALIST_LIMITS.maxCostPerTurn,
		maxCostPerSession: SPECIALIST_LIMITS.maxCostPerSession,
	};
	for (const key of Object.keys(costLimits))
		if (
			data[key] !== undefined &&
			(typeof data[key] !== "number" || !Number.isFinite(data[key]) || data[key] < 0)
		)
			throw new Error("Invalid knowledge specialist settings");
	const bounded = {};
	for (const [key, [min, max]] of Object.entries(integerLimits))
		bounded[key] = Math.min(max, Math.max(min, data[key] ?? SPECIALIST_LIMITS[key]));
	for (const [key, max] of Object.entries(costLimits))
		bounded[key] = Math.min(max, Math.max(0, data[key] ?? SPECIALIST_LIMITS[key]));
	return { ...SPECIALIST_LIMITS, ...bounded, mode: data.mode, revision: data.revision };
}
/** Only exposed through desktop human IPC. The model has no settings mutation tool. */
export async function setSpecialistSettings({ mode, revision, bindingRevision, ...requested }) {
	if (!["automatic", "manual", "off"].includes(mode) || !Number.isSafeInteger(revision))
		throw new Error("Invalid specialist setting request");
	const allowedRequested = new Set([
		"maxRunsPerTurn",
		"maxRunsPerSession",
		"maxToolOperations",
		"concurrency",
		"queueLimit",
		"queueWaitMs",
		"timeoutMs",
		"maxTokensPerTurn",
		"maxTokensPerSession",
		"maxCostPerTurn",
		"maxCostPerSession",
	]);
	for (const key of Object.keys(requested))
		if (!allowedRequested.has(key)) throw new Error(`Unknown specialist setting: ${key}`);
	const operation = state.settingsQueue
		.catch(() => {})
		.then(async () => {
			const binding = await readKnowledgeBinding({ fresh: true });
			if (!binding || binding.revision !== bindingRevision)
				throw new Error("Knowledge binding changed; refresh settings");
			return withKnowledgeBinding(binding, async () => {
				const current = await specialistSettings();
				if (current.revision !== revision) throw new Error("Specialist settings changed; refresh first");
				const data = { ...current, ...requested, mode, revision: revision + 1 };
				const minimums = {
					maxRunsPerTurn: 1,
					maxRunsPerSession: 1,
					maxToolOperations: 1,
					concurrency: 1,
					queueLimit: 1,
					queueWaitMs: 50,
					timeoutMs: 50,
					maxTokensPerTurn: 1,
					maxTokensPerSession: 1,
				};
				for (const [key, minimum] of Object.entries(minimums))
					if (data[key] !== undefined && (!Number.isSafeInteger(data[key]) || data[key] < minimum))
						throw new Error("Invalid knowledge specialist settings");
				for (const key of ["maxCostPerTurn", "maxCostPerSession"])
					if (
						data[key] !== undefined &&
						(typeof data[key] !== "number" || !Number.isFinite(data[key]) || data[key] < 0)
					)
						throw new Error("Invalid knowledge specialist settings");
				for (const key of [
					"maxRunsPerTurn",
					"maxRunsPerSession",
					"maxToolOperations",
					"concurrency",
					"queueLimit",
					"queueWaitMs",
					"timeoutMs",
					"maxTokensPerTurn",
					"maxTokensPerSession",
					"maxCostPerTurn",
					"maxCostPerSession",
				])
					data[key] = Math.min(data[key] ?? SPECIALIST_LIMITS[key], SPECIALIST_LIMITS[key]);
				data.mode = mode;
				data.revision = revision + 1;
				const dir = knowledgeDirectory(),
					temp = join(dir, `specialists.${randomUUID()}.tmp`);
				await mkdir(dir, { recursive: true, mode: 0o700 });
				try {
					await writeFile(temp, `${JSON.stringify(data)}\n`, { flag: "wx", mode: 0o600 });
					await rename(temp, join(dir, "specialists.json"));
				} finally {
					await unlink(temp).catch((e) => {
						if (e.code !== "ENOENT") throw e;
					});
				}
				invalidateKnowledgeUi();
				return { ...SPECIALIST_LIMITS, ...data };
			});
		});
	state.settingsQueue = operation;
	return operation;
}
export async function withSpecialistSlot(signal, work, options = {}) {
	signal?.throwIfAborted();
	const bounded = (value, fallback, max) =>
		Number.isSafeInteger(value) ? Math.min(max, Math.max(1, value)) : fallback;
	const concurrency = bounded(
		options.concurrency,
		SPECIALIST_LIMITS.concurrency,
		SPECIALIST_LIMITS.maxConcurrency,
	);
	const queueLimit = bounded(options.queueLimit, SPECIALIST_LIMITS.queueLimit, SPECIALIST_LIMITS.queueLimit);
	const queueWaitMs = bounded(
		options.queueWaitMs,
		SPECIALIST_LIMITS.queueWaitMs,
		SPECIALIST_LIMITS.queueWaitMs,
	);
	if (state.active >= concurrency) {
		if (state.queue.length >= queueLimit) throw new Error("Knowledge specialist queue is full");
		await new Promise((resolve, reject) => {
			let settled = false;
			const item = {
				resolve: () => {
					if (settled) return;
					settled = true;
					signal?.removeEventListener("abort", abort);
					clearTimeout(timer);
					resolve();
				},
			};
			const abort = () => {
				if (settled) return;
				settled = true;
				const at = state.queue.indexOf(item);
				if (at >= 0) state.queue.splice(at, 1);
				clearTimeout(timer);
				signal?.removeEventListener("abort", abort);
				reject(new Error("Knowledge specialist cancelled while queued"));
			};
			const timer = setTimeout(() => {
				if (settled) return;
				settled = true;
				const at = state.queue.indexOf(item);
				if (at >= 0) state.queue.splice(at, 1);
				signal?.removeEventListener("abort", abort);
				reject(new Error("Knowledge specialist queue wait deadline exceeded"));
			}, queueWaitMs);
			state.queue.push(item);
			signal?.addEventListener("abort", abort, { once: true });
		});
	} else state.active++;
	try {
		signal?.throwIfAborted();
		return await work();
	} finally {
		if (state.queue.length) state.queue.shift().resolve();
		else state.active--;
	}
}
