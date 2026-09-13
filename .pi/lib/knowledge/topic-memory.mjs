import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { knowledgeDirectory } from "./config.mjs";
import { canRead, readNoteFile, validateNote } from "./files.mjs";

export const TOPIC_MEMORY_VERSION = 1;
export const TOPIC_MEMORY_LIMITS = Object.freeze({
	maxTopics: 64,
	maxSummaryChars: 4000,
	maxContextChars: 2400,
	maxEntities: 24,
	maxQuestions: 16,
	maxSources: 24,
	maxArtifacts: 12,
	maxHistory: 8,
	maxRecentRuns: 12,
	maxFileBytes: 512 * 1024,
});

const queueKey = Symbol.for("percho.knowledge.topic-memory-queues.v1");
if (!globalThis[queueKey]) globalThis[queueKey] = new Map();
const queues = globalThis[queueKey];
const digest = (value) => createHash("sha256").update(String(value)).digest("hex");
const text = (value, limit) =>
	String(value ?? "")
		.normalize("NFKC")
		// biome-ignore lint/suspicious/noControlCharactersInRegex: strip control bytes from untrusted metadata
		.replace(/[\u0000-\u001f\u007f]/g, " ")
		.trim()
		.slice(0, limit);
const slug = (value) =>
	text(value, 160)
		.toLowerCase()
		.replace(/[^a-z0-9\u0080-\uffff]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 96) || "topic";

function projectKey(project) {
	const value = text(project, 120);
	if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) throw new Error("Invalid knowledge project");
	return value;
}
function memoryPath(directory, vaultId, project) {
	if (!isAbsolute(directory) || !/^[a-f0-9]{24}$/.test(vaultId))
		throw new Error("Invalid topic memory binding");
	return join(resolve(directory), vaultId, "topic-memory", `${projectKey(project)}.json`);
}
async function ensureWithin(root, target) {
	const lexicalRoot = resolve(root);
	const actualRoot = await realpath(root).catch(() => lexicalRoot);
	const lexicalParent = resolve(dirname(target));
	const rebased = lexicalParent.startsWith(lexicalRoot)
		? join(actualRoot, lexicalParent.slice(lexicalRoot.length))
		: lexicalParent;
	const parent = await realpath(rebased).catch(() => rebased);
	const rel = relative(actualRoot, parent);
	if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`))
		throw new Error("Topic memory path escapes knowledge directory");
	let cursor = actualRoot;
	for (const part of relative(actualRoot, rebased).split(sep).filter(Boolean)) {
		cursor = join(cursor, part);
		try {
			if ((await lstat(cursor)).isSymbolicLink())
				throw new Error("Topic memory path cannot traverse symlinks");
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
			break;
		}
	}
	try {
		const stat = await lstat(target);
		if (stat.isSymbolicLink()) throw new Error("Topic memory file cannot be a symlink");
		if (!stat.isFile()) throw new Error("Topic memory path is not a regular file");
		if (stat.size > TOPIC_MEMORY_LIMITS.maxFileBytes) throw new Error("Topic memory file exceeds size limit");
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
	return target;
}
function blank(vaultId, project) {
	const now = new Date().toISOString();
	return { version: TOPIC_MEMORY_VERSION, vaultId, project, revision: 0, updatedAt: now, topics: [] };
}
function validateSource(source, project = null) {
	if (
		!source ||
		typeof source !== "object" ||
		typeof source.path !== "string" ||
		isAbsolute(source.path) ||
		source.path.includes("\\") ||
		source.path.split("/").includes("..") ||
		!/^[^\0]+\.md$/.test(source.path) ||
		source.path.length > 240 ||
		/(?:^|\/)(?:Runs|Explainers)\//i.test(source.path) ||
		!/^[a-f0-9]{64}$/.test(source.hash || "")
	)
		return null;
	try {
		validateNote(source.path);
	} catch {
		return null;
	}
	if (project && !canRead(source.path, project)) return null;
	return { path: source.path, hash: source.hash };
}
function normalizeTopic(topic, binding, project) {
	if (!topic || typeof topic !== "object" || typeof topic.id !== "string")
		throw new Error("Invalid topic record");
	const sources = Array.isArray(topic.sources)
		? (topic.sources.some((source) => !validateSource(source, project))
				? (() => {
						throw new Error("Invalid or out-of-scope topic source");
					})()
				: topic.sources
			)
				.map((source) => validateSource(source, project))
				.filter(Boolean)
				.slice(0, TOPIC_MEMORY_LIMITS.maxSources)
		: [];
	const id = text(topic.id, 120);
	if (!/^[a-z0-9][a-z0-9_-]{0,95}$/i.test(id)) throw new Error("Invalid topic id");
	return {
		id,
		title: text(topic.title || topic.id, 180),
		aliases: [
			...new Set(
				(Array.isArray(topic.aliases) ? topic.aliases : []).map((x) => text(x, 120)).filter(Boolean),
			),
		].slice(0, 12),
		summary: text(topic.summary, TOPIC_MEMORY_LIMITS.maxSummaryChars),
		entities: [
			...new Set(
				(Array.isArray(topic.entities) ? topic.entities : []).map((x) => text(x, 100)).filter(Boolean),
			),
		].slice(0, TOPIC_MEMORY_LIMITS.maxEntities),
		unresolvedQuestions: [
			...new Set(
				(Array.isArray(topic.unresolvedQuestions) ? topic.unresolvedQuestions : [])
					.map((x) => text(x, 240))
					.filter(Boolean),
			),
		].slice(0, TOPIC_MEMORY_LIMITS.maxQuestions),
		sources,
		artifacts: [
			...new Set(
				(Array.isArray(topic.artifacts) ? topic.artifacts : []).map((x) => text(x, 240)).filter(Boolean),
			),
		].slice(0, TOPIC_MEMORY_LIMITS.maxArtifacts),
		sessionId: topic.sessionId ? text(topic.sessionId, 160) : null,
		status: ["active", "stale", "conflict-candidate", "archived"].includes(topic.status)
			? topic.status
			: "active",
		createdAt: topic.createdAt || new Date().toISOString(),
		updatedAt: topic.updatedAt || new Date().toISOString(),
		lastRunHash: /^[a-f0-9]{64}$/.test(topic.lastRunHash || "") ? topic.lastRunHash : null,
		lastRunId: topic.lastRunId ? text(topic.lastRunId, 200) : null,
		recentRuns: Array.isArray(topic.recentRuns)
			? topic.recentRuns.filter((x) => /^[a-f0-9]{64}$/.test(x)).slice(-TOPIC_MEMORY_LIMITS.maxRecentRuns)
			: [],
		proposalIds: [
			...new Set(
				(Array.isArray(topic.proposalIds) ? topic.proposalIds : []).map((x) => text(x, 120)).filter(Boolean),
			),
		].slice(0, 12),
		keyFindings: Array.isArray(topic.keyFindings)
			? topic.keyFindings
					.map((x) => text(x, 300))
					.filter(Boolean)
					.slice(0, 16)
			: [],
		history: Array.isArray(topic.history)
			? topic.history
					.slice(-TOPIC_MEMORY_LIMITS.maxHistory)
					.map((entry) => ({ summary: text(entry?.summary, 800), updatedAt: text(entry?.updatedAt, 40) }))
					.filter((entry) => entry.summary)
			: [],
		vaultId: typeof binding === "string" ? binding : binding?.vaultId,
		project,
	};
}
function validateDocument(value, vaultId, project) {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("Corrupt topic memory; refusing overwrite");
	if (value.version !== TOPIC_MEMORY_VERSION)
		throw new Error("Unsupported topic memory schema version; refusing overwrite");
	if (
		value.vaultId !== vaultId ||
		value.project !== project ||
		!Number.isSafeInteger(value.revision) ||
		value.revision < 0 ||
		!Array.isArray(value.topics)
	)
		throw new Error("Corrupt topic memory; refusing overwrite");
	if (value.topics.length > TOPIC_MEMORY_LIMITS.maxTopics)
		throw new Error("Topic memory exceeds its bounded record limit");
	return { ...value, topics: value.topics.map((topic) => normalizeTopic(topic, vaultId, project)) };
}
async function readDocument(path, vaultId, project) {
	try {
		const raw = await readFile(path, "utf8");
		if (Buffer.byteLength(raw) > TOPIC_MEMORY_LIMITS.maxFileBytes)
			throw new Error("Topic memory file exceeds size limit");
		const parsed = JSON.parse(raw);
		return validateDocument(parsed, vaultId, project);
	} catch (error) {
		if (error.code === "ENOENT") return blank(vaultId, project);
		if (error instanceof SyntaxError) throw new Error("Corrupt topic memory; refusing overwrite");
		throw error;
	}
}
async function atomicWrite(path, value) {
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	const temp = join(dirname(path), `.${randomUUID()}.tmp`);
	try {
		await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
		await rename(temp, path);
	} finally {
		await unlink(temp).catch((error) => {
			if (error.code !== "ENOENT") throw error;
		});
	}
}
async function withLock(path, operation) {
	const previous = queues.get(path) || Promise.resolve();
	const next = previous.catch(() => {}).then(operation);
	queues.set(path, next);
	try {
		return await next;
	} finally {
		if (queues.get(path) === next) queues.delete(path);
	}
}
function tokens(value) {
	return new Set(
		text(value, 6000)
			.toLowerCase()
			.split(/[^\p{L}\p{N}]+/u)
			.filter((x) => x.length > 2),
	);
}
function overlap(a, b) {
	const left = tokens(a),
		right = tokens(b);
	if (!left.size || !right.size) return 0;
	let common = 0;
	for (const item of left) if (right.has(item)) common++;
	return common / Math.max(left.size, right.size);
}

export function classifyTopic(existing, incoming) {
	if (!existing) return "new";
	if (
		incoming.runHash &&
		(incoming.runHash === existing.lastRunHash || existing.recentRuns?.includes(incoming.runHash))
	)
		return "duplicate";
	const oldSources = new Map((existing.sources || []).map((source) => [source.path, source.hash]));
	const changed = (incoming.sources || []).some(
		(source) => oldSources.has(source.path) && oldSources.get(source.path) !== source.hash,
	);
	if (changed) return "stale";
	if (overlap(existing.summary, incoming.summary) < 0.12 && overlap(existing.title, incoming.title) < 0.2)
		return "conflict-candidate";
	return "additional";
}

export function createTopicMemory({ binding, project, directory = knowledgeDirectory() } = {}) {
	if (!binding?.vaultId) throw new Error("Topic memory requires a bound Vault");
	const scope = { vaultId: binding.vaultId, project: projectKey(project) };
	const path = memoryPath(directory, scope.vaultId, scope.project);
	const check = async () => ensureWithin(directory, path);
	const read = async () => {
		await check();
		return readDocument(path, scope.vaultId, scope.project);
	};
	const mutate = async (expectedRevision, updater) =>
		withLock(path, async () => {
			await check();
			const current = await readDocument(path, scope.vaultId, scope.project);
			if (
				expectedRevision !== undefined &&
				expectedRevision !== null &&
				current.revision !== expectedRevision
			)
				throw new Error("Topic memory revision changed");
			const next = updater(structuredClone(current));
			if (next?.__topicNoop) return current;
			const value = validateDocument(
				{
					...next,
					version: TOPIC_MEMORY_VERSION,
					vaultId: scope.vaultId,
					project: scope.project,
					revision: current.revision + 1,
					updatedAt: new Date().toISOString(),
				},
				scope.vaultId,
				scope.project,
			);
			if (value.topics.length > TOPIC_MEMORY_LIMITS.maxTopics) {
				const archived = value.topics.filter((topic) => topic.status === "archived");
				if (!archived.length)
					throw new Error("Topic memory quota exceeded; archive a topic before adding another");
				const remove = value.topics.length - TOPIC_MEMORY_LIMITS.maxTopics;
				const evict = new Set(archived.slice(-remove).map((topic) => topic.id));
				value.topics = value.topics.filter((topic) => !evict.has(topic.id));
			}
			await atomicWrite(path, value);
			return value;
		});
	const compact = (topic) => ({
		id: topic.id,
		title: topic.title,
		aliases: topic.aliases,
		summary: topic.summary.slice(0, TOPIC_MEMORY_LIMITS.maxContextChars),
		entities: topic.entities,
		unresolvedQuestions: topic.unresolvedQuestions,
		sources: topic.sources,
		artifacts: topic.artifacts,
		status: topic.status,
		revision: topic.revision,
		updatedAt: topic.updatedAt,
		lastRunHash: topic.lastRunHash,
		lastRunId: topic.lastRunId,
		recentRuns: topic.recentRuns,
		proposalIds: topic.proposalIds,
		keyFindings: topic.keyFindings,
		history: topic.history,
	});
	const context = (topic) => {
		const value = {
			id: topic.id,
			title: topic.title,
			entities: topic.entities.slice(0, 12),
			summary: topic.summary.slice(0, 900),
		};
		let output = JSON.stringify(value);
		if (output.length > TOPIC_MEMORY_LIMITS.maxContextChars)
			output = JSON.stringify({
				...value,
				summary: value.summary.slice(0, 400),
				entities: value.entities.slice(0, 6),
			});
		if (output.length > TOPIC_MEMORY_LIMITS.maxContextChars)
			output = JSON.stringify({ id: value.id, title: value.title, entities: value.entities.slice(0, 3) });
		return output;
	};
	return {
		path,
		scope,
		read,
		list: async (query = "", { includeArchived = false } = {}) => {
			const doc = await read();
			const q = text(query, 180).toLowerCase();
			return {
				revision: doc.revision,
				topics: doc.topics
					.filter((topic) => includeArchived || topic.status !== "archived")
					.filter(
						(topic) =>
							!q ||
							[topic.id, topic.title, ...topic.aliases].some((value) => value.toLowerCase().includes(q)),
					)
					.map(compact),
			};
		},
		get: async (idOrName) => {
			const doc = await read();
			const q = text(idOrName, 180).toLowerCase();
			const matches = doc.topics.filter((topic) =>
				[topic.id, topic.title, ...topic.aliases].some((value) => value.toLowerCase() === q),
			);
			return { revision: doc.revision, matches: matches.map(compact) };
		},
		context: async (topic) => {
			const doc = await read();
			const item = typeof topic === "string" ? doc.topics.find((x) => x.id === topic) : topic;
			return item ? context(item) : null;
		},
		refreshSourceCheck: async (topicId) => {
			const doc = await read();
			const topic = doc.topics.find((item) => item.id === text(topicId, 120));
			if (!topic) throw new Error("Topic not found");
			const stale = [];
			for (const source of topic.sources) {
				try {
					validateNote(source.path);
					if (!canRead(source.path, scope.project) || /(?:^|\/)(?:Runs|Explainers)\//i.test(source.path)) {
						stale.push({ path: source.path, reason: "out-of-scope" });
						continue;
					}
					const current = await readNoteFile(binding.vault, source.path);
					if (current.hash !== source.hash) stale.push({ path: source.path, reason: "changed" });
				} catch {
					stale.push({ path: source.path, reason: "missing-or-invalid" });
				}
			}
			if (stale.length && topic.status !== "stale") {
				await mutate(undefined, (value) => {
					const current = value.topics.find((item) => item.id === topic.id);
					if (current) current.status = "stale";
					return value;
				});
			}
			return {
				topic: { ...compact(topic), status: stale.length ? "stale" : topic.status },
				stale,
				status: stale.length ? "stale" : topic.status,
			};
		},
		link: async (topicId, { proposalIds = [], artifacts = [] } = {}) =>
			mutate(undefined, (doc) => {
				const topic = doc.topics.find((item) => item.id === text(topicId, 120));
				if (!topic) throw new Error("Topic not found");
				topic.proposalIds = [...new Set([...(topic.proposalIds || []), ...proposalIds])].slice(-12);
				topic.artifacts = [...new Set([...(topic.artifacts || []), ...artifacts])].slice(
					-TOPIC_MEMORY_LIMITS.maxArtifacts,
				);
				topic.updatedAt = new Date().toISOString();
				return doc;
			}),
		update: async (input, expectedRevision) => {
			if (!Number.isSafeInteger(expectedRevision)) throw new Error("expectedRevision is required");
			return mutate(expectedRevision, (doc) => {
				const allowed = new Set([
					"id",
					"title",
					"summary",
					"aliases",
					"entities",
					"unresolvedQuestions",
					"keyFindings",
				]);
				for (const key of Object.keys(input || {}))
					if (!allowed.has(key)) throw new Error(`Unsupported topic metadata field: ${key}`);
				const id = text(input.id, 120);
				if (!id) throw new Error("Topic id is required");
				const index = doc.topics.findIndex((topic) => topic.id === id);
				const previous = index >= 0 ? doc.topics[index] : null;
				const merged = normalizeTopic(
					{
						...previous,
						...input,
						id,
						createdAt: previous?.createdAt || new Date().toISOString(),
						updatedAt: new Date().toISOString(),
					},
					scope.vaultId,
					scope.project,
				);
				if (index >= 0) doc.topics[index] = merged;
				else doc.topics.unshift(merged);
				return doc;
			});
		},
		archive: async (id, expectedRevision) => {
			if (!Number.isSafeInteger(expectedRevision)) throw new Error("expectedRevision is required");
			return mutate(expectedRevision, (doc) => {
				const topic = doc.topics.find((item) => item.id === text(id, 120));
				if (!topic) throw new Error("Topic not found");
				topic.status = "archived";
				topic.updatedAt = new Date().toISOString();
				return doc;
			});
		},
		record: async (input, expectedRevision) => {
			if (!input || typeof input !== "object") throw new Error("Invalid topic record input");
			let receipt;
			const next = await mutate(expectedRevision, (value) => {
				if (
					Array.isArray(input.sources) &&
					input.sources.some((source) => !validateSource(source, scope.project))
				)
					throw new Error("Invalid or out-of-scope topic source");
				const key = text(input.topicId || input.title, 180).toLowerCase();
				const matches = value.topics.filter((topic) =>
					[topic.id, topic.title, ...topic.aliases].some((v) => v.toLowerCase() === key),
				);
				if (matches.length > 1) throw new Error("Ambiguous topic identity; choose an exact topic id");
				const existing =
					matches[0] ||
					(input.topicId ? value.topics.find((topic) => topic.id === text(input.topicId, 120)) : null);
				const classification = classifyTopic(existing, input);
				if (classification === "duplicate") {
					receipt = { classification, revision: value.revision, topic: compact(existing), changed: false };
					value.__topicNoop = true;
					return value;
				}
				const id =
					existing?.id ||
					text(input.topicId, 96) ||
					`${slug(input.title)}-${digest(input.title).slice(0, 8)}`;
				if (!/^[a-z0-9][a-z0-9_-]{0,95}$/i.test(id)) throw new Error("Invalid topic id");
				const index = value.topics.findIndex((topic) => topic.id === id);
				const prior = index >= 0 ? value.topics[index] : null;
				const mergedSources = [];
				for (const source of [...(prior?.sources || []), ...(input.sources || [])]) {
					if (
						!validateSource(source, scope.project) ||
						mergedSources.some((item) => item.path === source.path && item.hash === source.hash)
					)
						continue;
					mergedSources.push(source);
				}
				mergedSources.splice(0, Math.max(0, mergedSources.length - TOPIC_MEMORY_LIMITS.maxSources));
				const updated = normalizeTopic(
					{
						...prior,
						...input,
						id,
						aliases: [...new Set([...(prior?.aliases || []), ...(input.aliases || [])])].slice(-12),
						entities: [...new Set([...(prior?.entities || []), ...(input.entities || [])])].slice(
							-TOPIC_MEMORY_LIMITS.maxEntities,
						),
						unresolvedQuestions: [
							...new Set([...(prior?.unresolvedQuestions || []), ...(input.unresolvedQuestions || [])]),
						].slice(-TOPIC_MEMORY_LIMITS.maxQuestions),
						artifacts: [...new Set([...(prior?.artifacts || []), ...(input.artifacts || [])])].slice(
							-TOPIC_MEMORY_LIMITS.maxArtifacts,
						),
						proposalIds: [...new Set([...(prior?.proposalIds || []), ...(input.proposalIds || [])])].slice(
							-12,
						),
						keyFindings: [...new Set([...(prior?.keyFindings || []), ...(input.keyFindings || [])])].slice(
							-16,
						),
						history: [
							...(prior?.history || []),
							...(prior?.summary ? [{ summary: prior.summary, updatedAt: prior.updatedAt }] : []),
						].slice(-TOPIC_MEMORY_LIMITS.maxHistory),
						sources: mergedSources,
						status:
							classification === "stale" || classification === "conflict-candidate"
								? classification
								: "active",
						lastRunHash: input.runHash || prior?.lastRunHash,
						recentRuns: input.runHash
							? [...new Set([...(prior?.recentRuns || []), input.runHash])].slice(
									-TOPIC_MEMORY_LIMITS.maxRecentRuns,
								)
							: prior?.recentRuns,
						updatedAt: new Date().toISOString(),
					},
					scope.vaultId,
					scope.project,
				);
				if (index >= 0) value.topics[index] = updated;
				else value.topics.unshift(updated);
				receipt = { classification, topic: compact(updated), changed: true };
				return value;
			});
			return {
				...receipt,
				revision: next.revision,
				topic:
					receipt.topic && next.topics.find((topic) => topic.id === receipt.topic.id)
						? compact(next.topics.find((topic) => topic.id === receipt.topic.id))
						: receipt.topic,
			};
		},
	};
}

export function topicRunHash(summary, sources = []) {
	return digest(
		JSON.stringify({
			summary: text(summary, TOPIC_MEMORY_LIMITS.maxSummaryChars),
			sources: sources
				.map(validateSource)
				.filter(Boolean)
				.sort((a, b) => a.path.localeCompare(b.path) || a.hash.localeCompare(b.hash)),
		}),
	);
}

export async function listTopics(options = {}) {
	return (await createTopicMemory(options).list(options.query || "")).topics;
}

export async function readTopic(options = {}) {
	return (await createTopicMemory(options).get(options.topic || options.id || "")).matches;
}

export async function updateTopic(options = {}) {
	const { expectedRevision, ...input } = options;
	if (!Number.isSafeInteger(expectedRevision)) throw new Error("expectedRevision is required");
	return createTopicMemory(options).update(input, expectedRevision);
}

export async function archiveTopic(options = {}) {
	if (!Number.isSafeInteger(options.expectedRevision)) throw new Error("expectedRevision is required");
	return createTopicMemory(options).archive(options.id, options.expectedRevision);
}
