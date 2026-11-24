#!/usr/bin/env node
/**
 * The lesson library's two doors.
 *   drain                 turn queued insights into lessons (Codex drafts, code validates, Jev dedupes);
 *                         the Stop hook starts it detached
 *   ask <text>            what the library knows about a failure: seed and lesson signatures first, then
 *   ask --chunk <id>      Jev on the nearest lessons. A chunk id is the one the output ladder printed.
 * Without a TypeSafe key, dedupe falls back to identical signatures and ask lists signature hits only.
 */
import { closeSync, existsSync, openSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decision, record, STATE_DIR } from "./decision.mjs";
import { apiKey, askJev, redact } from "./jev-client.mjs";
import { KNOWN_FAILURES } from "./known-failures.mjs";
import { judgeCandidates, mergeOrAdd } from "./lesson-judge.mjs";
import {
	claimInbox,
	lessonFiles,
	nearestLessons,
	readLessons,
	signatureMatches,
	validateDraft,
	writeClaim,
	writeLessons,
} from "./lesson-store.mjs";
import { BATCH, draftLessons } from "./lesson-writer.mjs";

const MAX_BATCHES = 5;
const STALE_LOCK_MS = 20 * 60_000;
const FAILURE_LIMIT = 6000;
/** How many existing lessons Jev is shown for one judgement. */
const CANDIDATES = 8;

function takeLock(stateDir) {
	const lock = `${lessonFiles(stateDir).lessons}.lock`;
	if (existsSync(lock) && Date.now() - statSync(lock).mtimeMs > STALE_LOCK_MS) rmSync(lock);
	try {
		closeSync(openSync(lock, "wx"));
	} catch (error) {
		if (error.code === "EEXIST") return null;
		throw error;
	}
	return () => rmSync(lock, { force: true });
}

/** Jev when a TypeSafe key is set, otherwise null: callers then fall back to signatures alone. */
function resolveAsk(deps) {
	if (deps.ask !== undefined) return deps.ask;
	const key = "key" in deps ? deps.key : apiKey();
	return key === null ? null : (state, questions) => askJev(state, questions, { key });
}

const via = (ask) => (ask === null ? "signature" : "jev");

async function judgeIntake(lesson, lessons, ask) {
	if (ask === null) {
		const twin = lessons.find((existing) => existing.signature === lesson.signature);
		return twin === undefined ? [] : [{ lesson: twin, probability: 1, label: "same" }];
	}
	const state = { new_lesson: { cause: lesson.cause, evidence: lesson.evidence } };
	return judgeCandidates(
		state,
		nearestLessons(lessons, `${lesson.evidence} ${lesson.cause}`, CANDIDATES),
		"sameLesson",
		ask,
	);
}

async function drainBatch(stateDir, batch, ask, writeDrafts) {
	const drafts = writeDrafts(batch);
	let lessons = readLessons(stateDir);
	for (const [index, insight] of batch.entries()) {
		const drafted = drafts.find((entry) => entry.index === index);
		const { lesson, reason } = validateDraft(drafted, insight);
		if (lesson === undefined) {
			record(stateDir, { ...decision("lesson", "reject", reason), insight: insight.id });
			continue;
		}
		const result = mergeOrAdd(lessons, lesson, await judgeIntake(lesson, lessons, ask));
		lessons = result.lessons;
		const answer = result.merged === null ? "add" : "merge";
		record(stateDir, {
			...decision("lesson", answer, via(ask)),
			lesson: result.merged ?? lesson.id,
		});
	}
	writeLessons(stateDir, lessons);
}

export async function drain(stateDir = STATE_DIR, deps = {}) {
	const release = takeLock(stateDir);
	if (release === null) return;
	try {
		const ask = resolveAsk(deps);
		for (let round = 0; round < MAX_BATCHES; round += 1) {
			const claimed = claimInbox(stateDir);
			if (claimed.length === 0) return;
			await drainBatch(stateDir, claimed.slice(0, BATCH), ask, deps.draft ?? draftLessons);
			writeClaim(stateDir, claimed.slice(BATCH));
		}
	} finally {
		release();
	}
}

const seedHits = (text) =>
	KNOWN_FAILURES.filter((rule) => rule.command === undefined && rule.output.test(text)).map((rule) => ({
		id: rule.id,
		cause: rule.cause,
		fix: rule.fix,
	}));

/**
 * Resolves to { known, possible }: entries with id, cause, fix (and probability when Jev judged). Only a
 * reviewed seed is known on its signature alone; a learned signature was written from prose and can be
 * too broad, so its hit is a candidate that Jev confirms, or merely possible when no key is set.
 */
export async function lookup(failure, stateDir = STATE_DIR, ask = null) {
	const text = redact(failure.slice(-FAILURE_LIMIT));
	const lessons = readLessons(stateDir);
	const hits = signatureMatches(lessons, text);
	const seeds = seedHits(text);
	if (ask === null) return { known: seeds, possible: hits };
	const near = nearestLessons(
		lessons.filter((lesson) => !hits.includes(lesson)),
		text,
		CANDIDATES,
	);
	const candidates = [...hits, ...near].slice(0, CANDIDATES);
	const judged = await judgeCandidates({ failure: text }, candidates, "explainsFailure", ask);
	const pick = (label) =>
		judged
			.filter((entry) => entry.label === label)
			.map(({ lesson, probability }) => ({ ...lesson, probability }));
	return { known: [...seeds, ...pick("same")], possible: pick("maybe") };
}

const line = (entry) =>
	`- ${entry.id}${entry.probability === undefined ? "" : ` (p=${entry.probability.toFixed(2)})`}：${entry.cause} → ${entry.fix}`;

async function askCommand(args) {
	const chunk = args[0] === "--chunk" ? args[1] : null;
	const failure =
		chunk === null ? args.join(" ") : readFileSync(path.join(STATE_DIR, "chunks", `${chunk}.log`), "utf8");
	if (failure.trim() === "") throw new Error("usage: jev-lessons.mjs ask <failure text> | --chunk <id>");
	const ask = resolveAsk({});
	const { known, possible } = await lookup(failure, STATE_DIR, ask);
	record(STATE_DIR, {
		...decision("lesson", known.length > 0 ? "known" : "none", via(ask)),
		hits: known.length + possible.length,
	});
	const out = [
		known.length > 0 ? `已知：\n${known.map(line).join("\n")}` : "经验库里没有已知原因。",
		possible.length > 0 ? `可能：\n${possible.map(line).join("\n")}` : "",
		ask === null ? "（未配置 TypeSafe key：只做了签名匹配）" : "",
	];
	process.stdout.write(`${out.filter(Boolean).join("\n")}\n`);
}

/** Real paths on both sides: /tmp is a symlink on macOS and a plain comparison would skip silently. */
const isMain = () =>
	process.argv[1] !== undefined &&
	realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));

if (isMain()) {
	const [command, ...args] = process.argv.slice(2);
	if (command === "drain") await drain();
	else if (command === "ask") await askCommand(args);
	else throw new Error("usage: jev-lessons.mjs drain | ask <failure text> | ask --chunk <id>");
}
