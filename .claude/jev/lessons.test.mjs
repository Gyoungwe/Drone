import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { drain, lookup } from "./jev-lessons.mjs";
import { classifySameCause, judgeCandidates, mergeOrAdd } from "./lesson-judge.mjs";
import {
	enqueueInsights,
	extractInsights,
	lessonFiles,
	nearestLessons,
	readInbox,
	readLessons,
	signatureMatches,
	validateDraft,
	writeLessons,
} from "./lesson-store.mjs";
import { DRAFT_SCHEMA, draftLessons } from "./lesson-writer.mjs";

const dirs = [];
const tempState = () => {
	const dir = mkdtempSync(path.join(os.tmpdir(), "jev-lessons-"));
	dirs.push(dir);
	return dir;
};
after(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const VITE = "EPERM .vite-temp 是环境病：把 node_modules 软链到主检出后 vitest 无法写 config bundle。";
const block = (body) => `前言\n\`★ Insight ─────\`\n${body}\n\`─────────────\`\n后文`;
const assistant = (text) =>
	JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text }] } });
const insight = { id: "abc", text: VITE, source: "session:test" };
const goodDraft = {
	index: 0,
	is_failure_lesson: true,
	cause: "软链 node_modules",
	fix: "加 --no-cache",
	signature: "EPERM[^\\n]*\\.vite-temp",
	evidence: "EPERM .vite-temp",
};

describe("lesson intake", () => {
	it("extracts each ★ Insight once from assistant text only", () => {
		const transcript = [
			assistant(block(VITE)),
			assistant(block(VITE)),
			JSON.stringify({ type: "user", message: { content: block("用户贴的") } }),
		].join("\n");
		const found = extractInsights(transcript);
		assert.deepEqual(
			found.map((entry) => entry.text),
			[VITE],
		);
	});

	it("queues an insight once across stops", () => {
		const state = tempState();
		const found = extractInsights(assistant(block(VITE)));
		assert.equal(enqueueInsights(state, found, "s1"), 1);
		assert.equal(enqueueInsights(state, found, "s1"), 0);
		assert.equal(readInbox(state).length, 1);
	});

	it("accepts a quoted, matching signature and rejects the rest with a reason", () => {
		assert.equal(validateDraft(goodDraft, insight).lesson.id, "L-abc");
		const reasons = [
			{ ...goodDraft, is_failure_lesson: false },
			{ ...goodDraft, evidence: "不在原文里的话" },
			{ ...goodDraft, signature: "([" },
			{ ...goodDraft, signature: "ENOENT.*dist" },
			{ ...goodDraft, signature: "[\\s\\S]*" },
			{ ...goodDraft, cause: "x".repeat(400) },
		].map((draft) => validateDraft(draft, insight).reason);
		assert.deepEqual(reasons, [
			"not-a-failure-lesson",
			"evidence-not-quoted",
			"bad-signature",
			"signature-misses-evidence",
			"signature-too-broad",
			"long-cause",
		]);
	});

	it("asks the writer for a strict schema and reads its drafts", () => {
		assert.equal(DRAFT_SCHEMA.properties.drafts.items.additionalProperties, false);
		const calls = [];
		const run = (bin, args, options) => {
			calls.push({ bin, args, input: options.input });
			writeFileSync(args[args.indexOf("-o") + 1], JSON.stringify({ drafts: [goodDraft] }));
			return { status: 0 };
		};
		assert.deepEqual(draftLessons([insight], run), [goodDraft]);
		assert.deepEqual(calls[0].args.slice(0, 4), ["exec", "--skip-git-repo-check", "-s", "read-only"]);
		assert.match(calls[0].input, /\[0\]\nEPERM \.vite-temp/);
		assert.throws(() => draftLessons([insight], () => ({ status: 1, stderr: "boom" })), /codex exit 1/);
	});
});

describe("lesson drain", () => {
	it("drains the inbox into lessons and dedupes identical signatures without a key", async () => {
		const state = tempState();
		enqueueInsights(
			state,
			[
				{ id: "a", text: VITE },
				{ id: "b", text: `${VITE} 再次` },
			],
			"s1",
		);
		const draft = (batch) => batch.map((_, index) => ({ ...goodDraft, index }));
		await drain(state, { key: null, draft });
		const lessons = readLessons(state);
		assert.equal(lessons.length, 1);
		assert.equal(lessons[0].count, 2);
		assert.equal(readInbox(state).length, 0);
		assert.match(readFileSync(path.join(state, "decisions.jsonl"), "utf8"), /"answer":"merge"/);
	});

	it("resumes the claim of a drain that died and keeps insights queued while drafting", async () => {
		const state = tempState();
		enqueueInsights(state, [{ id: "a", text: VITE }], "s1");
		const died = () => {
			throw new Error("codex died");
		};
		await assert.rejects(drain(state, { key: null, draft: died }), /codex died/);
		const claimed = lessonFiles(state).claimed;
		assert.equal(existsSync(claimed), true);
		const queuedWhileDrafting = (batch) => {
			enqueueInsights(state, [{ id: "b", text: `${VITE} 再次` }], "s2");
			return batch.map((_, index) => ({ ...goodDraft, index }));
		};
		await drain(state, { key: null, draft: queuedWhileDrafting });
		assert.equal(readLessons(state)[0].count, 2);
		assert.deepEqual([existsSync(claimed), readInbox(state).length], [false, 0]);
	});
});

describe("lesson judgement and lookup", () => {
	const lesson = {
		id: "L-1",
		cause: "软链 node_modules 让 vitest 写不了 .vite-temp",
		fix: "加 --no-cache",
		signature: "EPERM[^\\n]*\\.vite-temp",
		evidence: "EPERM .vite-temp",
		sources: ["s1"],
		count: 1,
	};

	it("labels clear probabilities and leaves the middle unsettled", () => {
		assert.deepEqual([0.95, 0.8, 0.79, 0.5, 0.31, 0.3, 0.05].map(classifySameCause), [
			"same",
			"same",
			"maybe",
			"maybe",
			"maybe",
			"different",
			"different",
		]);
		for (const bad of [Number.NaN, -0.1, 1.2])
			assert.throws(() => classifySameCause(bad), /not a probability/);
	});

	it("merges on a same-cause answer and appends otherwise", async () => {
		const fresh = { ...lesson, id: "L-2", sources: ["s2"] };
		const ask = (p) => async () => ({ answers: { lesson_0: { noul: p } } });
		const same = await judgeCandidates({}, [lesson], "sameLesson", ask(0.95));
		assert.equal(mergeOrAdd([lesson], fresh, same).lessons[0].count, 2);
		const other = await judgeCandidates({}, [lesson], "sameLesson", ask(0.05));
		assert.equal(mergeOrAdd([lesson], fresh, other).lessons.length, 2);
	});

	it("finds lessons by signature and by shared words", () => {
		assert.equal(signatureMatches([lesson], "Error: EPERM: open '/x/.vite-temp/a.mjs'").length, 1);
		assert.equal(nearestLessons([lesson], "vitest 又报 .vite-temp").length, 1);
		assert.equal(nearestLessons([lesson], "完全无关").length, 0);
		assert.throws(() => signatureMatches([{ ...lesson, signature: "([" }], "x"), SyntaxError);
	});

	it("lookup trusts seed signatures but only offers learned ones until Jev confirms", async () => {
		const state = tempState();
		const broad = { ...lesson, id: "L-broad", signature: "\\bEPERM\\b", cause: "取消竞态" };
		writeLessons(state, [broad]);
		const failure = "Error: EPERM: open '/x/.vite-temp/a'";
		const offline = await lookup(failure, state, null);
		assert.deepEqual(
			offline.known.map((entry) => entry.id),
			["vite-temp-eperm"],
		);
		assert.deepEqual(
			offline.possible.map((entry) => entry.id),
			["L-broad"],
		);
		const asked = [];
		const ask = (p) => async (_state, questions) => {
			asked.push(...Object.keys(questions));
			return { answers: { lesson_0: { noul: p } } };
		};
		const rejected = await lookup(failure, state, ask(0.1));
		assert.deepEqual(asked, ["lesson_0"]);
		assert.deepEqual([rejected.known.length, rejected.possible.length], [1, 0]);
		const confirmed = await lookup(failure, state, ask(0.9));
		assert.deepEqual(
			confirmed.known.map((entry) => entry.id),
			["vite-temp-eperm", "L-broad"],
		);
	});
});
