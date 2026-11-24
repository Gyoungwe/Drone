/**
 * Jev lesson library, learned side: every ★ Insight a session writes is queued at Stop, a constrained
 * writer model (lesson-writer.mjs) turns it into { cause, fix, signature, evidence }, and the code here
 * decides whether that draft may enter the library. All of it lives in the git-ignored jev-state
 * directory because it is derived from session text; known-failures.mjs keeps the reviewed seeds.
 *
 * Files: insight-inbox.jsonl (queued insights), insight-claimed.jsonl (the batch a drain took over),
 * insight-seen.json (ids already queued),
 * lessons.jsonl (accepted lessons; a merge rewrites the file atomically).
 */
import { createHash } from "node:crypto";
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import { redact } from "./jev-client.mjs";

export const FIELD_LIMITS = { cause: 300, fix: 300, signature: 200, evidence: 400 };
const MIN_SIGNATURE = 6;
const INSIGHT = /★ Insight ─+`?\n([\s\S]*?)\n`?─{5,}/g;
/** A signature that matches ordinary prose or nothing at all is not a signature. */
const TOO_BROAD = ["", " ", "error", "the test failed", "npm run lint", "检查失败"];

export const lessonFiles = (stateDir) => ({
	inbox: path.join(stateDir, "insight-inbox.jsonl"),
	seen: path.join(stateDir, "insight-seen.json"),
	claimed: path.join(stateDir, "insight-claimed.jsonl"),
	lessons: path.join(stateDir, "lessons.jsonl"),
});

export const insightId = (text) => createHash("sha1").update(text.trim()).digest("hex").slice(0, 16);

const assistantText = (entry) =>
	entry.type === "assistant" && Array.isArray(entry.message?.content)
		? entry.message.content.filter((part) => part.type === "text").map((part) => part.text)
		: [];

/** Every ★ Insight body in a transcript (JSONL), oldest first, each once. */
export function extractInsights(transcript) {
	const bodies = transcript
		.split("\n")
		.filter((line) => line.trim() !== "")
		.flatMap((line) => assistantText(JSON.parse(line)))
		.flatMap((text) => [...text.matchAll(INSIGHT)].map((match) => match[1].trim()));
	return [...new Map(bodies.map((body) => [insightId(body), body]))].map(([id, text]) => ({ id, text }));
}

const readJsonl = (file) =>
	existsSync(file)
		? readFileSync(file, "utf8")
				.split("\n")
				.filter((line) => line.trim() !== "")
				.map((line) => JSON.parse(line))
		: [];

/** Queue the insights not seen before; returns how many were queued. */
export function enqueueInsights(stateDir, insights, source) {
	const files = lessonFiles(stateDir);
	const seen = new Set(existsSync(files.seen) ? JSON.parse(readFileSync(files.seen, "utf8")) : []);
	const fresh = insights.filter((insight) => !seen.has(insight.id));
	if (fresh.length === 0) return 0;
	mkdirSync(stateDir, { recursive: true });
	const lines = fresh.map((insight) => JSON.stringify({ ...insight, text: redact(insight.text), source }));
	appendFileSync(files.inbox, `${lines.join("\n")}\n`);
	for (const insight of fresh) seen.add(insight.id);
	writeFileSync(files.seen, JSON.stringify([...seen]));
	return fresh.length;
}

export const readInbox = (stateDir) => readJsonl(lessonFiles(stateDir).inbox);
export const readLessons = (stateDir) => readJsonl(lessonFiles(stateDir).lessons);

function writeJsonl(file, rows) {
	mkdirSync(path.dirname(file), { recursive: true });
	const temp = `${file}.${process.pid}.tmp`;
	writeFileSync(temp, rows.map((row) => `${JSON.stringify(row)}\n`).join(""));
	renameSync(temp, file);
}

export const writeLessons = (stateDir, rows) => writeJsonl(lessonFiles(stateDir).lessons, rows);

/**
 * The drain's queue. The Stop hook only appends to the inbox, so the drain takes the inbox over by an
 * atomic rename and from then on rewrites only its claim: an insight appended meanwhile lands in a new
 * inbox instead of being overwritten, and a drain that dies leaves its claim for the next one.
 */
export function claimInbox(stateDir) {
	const files = lessonFiles(stateDir);
	if (!existsSync(files.claimed) && existsSync(files.inbox)) renameSync(files.inbox, files.claimed);
	return readJsonl(files.claimed);
}

export function writeClaim(stateDir, rows) {
	const { claimed } = lessonFiles(stateDir);
	if (rows.length === 0) rmSync(claimed, { force: true });
	else writeJsonl(claimed, rows);
}

const compile = (source) => new RegExp(source, "i");

/**
 * The writer's draft becomes a lesson only if: it says it is a failure lesson, every field is a
 * non-empty string within its limit, the evidence is quoted from the insight itself, and the signature
 * compiles, matches that evidence and does not match ordinary text. Returns { lesson } or { reason }.
 */
export function validateDraft(draft, insight) {
	if (draft?.is_failure_lesson !== true) return { reason: "not-a-failure-lesson" };
	for (const [field, limit] of Object.entries(FIELD_LIMITS)) {
		const value = draft[field];
		if (typeof value !== "string" || value.trim() === "") return { reason: `empty-${field}` };
		if (value.length > limit) return { reason: `long-${field}` };
	}
	if (!insight.text.includes(draft.evidence)) return { reason: "evidence-not-quoted" };
	if (draft.signature.length < MIN_SIGNATURE) return { reason: "bad-signature" };
	let signature;
	try {
		signature = compile(draft.signature);
	} catch (error) {
		if (error instanceof SyntaxError) return { reason: "bad-signature" };
		throw error;
	}
	if (!signature.test(draft.evidence)) return { reason: "signature-misses-evidence" };
	if (TOO_BROAD.some((text) => signature.test(text))) return { reason: "signature-too-broad" };
	const lesson = {
		id: `L-${insight.id}`,
		cause: redact(draft.cause.trim()),
		fix: redact(draft.fix.trim()),
		signature: draft.signature,
		evidence: redact(draft.evidence.trim()),
		sources: [insight.source],
		count: 1,
	};
	return { lesson };
}

/** Lessons whose signature matches the failure text: the fast path that needs no model. Every stored
 * signature passed validateDraft, so one that no longer compiles means a corrupt library and throws. */
export function signatureMatches(lessons, text) {
	return lessons.filter((lesson) => compile(lesson.signature).test(text));
}

const tokens = (text) => new Set(text.toLowerCase().match(/[a-z0-9_.-]{3,}|[一-鿿]{2}/g) ?? []);

/** The `limit` lessons sharing the most words with `text`: the candidates Jev is asked about. */
export function nearestLessons(lessons, text, limit) {
	const wanted = tokens(text);
	return lessons
		.map((lesson) => {
			const own = tokens(`${lesson.evidence} ${lesson.cause}`);
			return { lesson, overlap: [...own].filter((token) => wanted.has(token)).length };
		})
		.filter((scored) => scored.overlap > 0)
		.sort((a, b) => b.overlap - a.overlap)
		.slice(0, limit)
		.map((scored) => scored.lesson);
}
