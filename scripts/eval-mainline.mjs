#!/usr/bin/env node
/**
 * Offline mainline metric for the fixed knowledge questions.
 *
 * Each round uses the real Pi AI faux provider and a deterministic local
 * knowledge index. The fetch guard makes accidental network access fail fast;
 * the resulting trace is enough to distinguish local answers from answers that
 * used a network tool.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_FIXTURE = resolve(root, "fixtures/mainline-questions.json");
const DEFAULT_OUTPUT_DIR = resolve(root, "docs/evals");
const CITATION_PATTERN = /\[\[([^\]]+)\]\]/g;

function invariant(condition, message) {
	if (!condition) throw new Error(`Invalid mainline fixture: ${message}`);
}

/** Validate and return the fixed 20-question, two-round fixture. */
export function validateMainlineFixture(value) {
	invariant(value && typeof value === "object", "expected an object");
	invariant(value.schema === 1, "schema must be 1");
	invariant(value.kind === "drone-mainline-questions", "kind must be drone-mainline-questions");
	invariant(value.roundsPerQuestion === 2, "roundsPerQuestion must be 2");
	invariant(Array.isArray(value.questions), "questions must be an array");
	invariant(value.questions.length === 20, `expected 20 questions, got ${value.questions.length}`);
	const questionIds = new Set();
	for (const question of value.questions) {
		invariant(question && typeof question === "object", "question must be an object");
		invariant(typeof question.id === "string" && question.id.length > 0, "question id is required");
		invariant(!questionIds.has(question.id), `duplicate question id ${question.id}`);
		questionIds.add(question.id);
		invariant(
			typeof question.topic === "string" && question.topic.length > 0,
			`${question.id} topic is required`,
		);
		invariant(
			question.localSource && typeof question.localSource === "object",
			`${question.id} localSource is required`,
		);
		invariant(
			typeof question.localSource.path === "string" && question.localSource.path.length > 0,
			`${question.id} localSource.path is required`,
		);
		invariant(
			typeof question.localSource.text === "string" && question.localSource.text.trim().length > 0,
			`${question.id} localSource.text is required`,
		);
		invariant(
			Array.isArray(question.rounds) && question.rounds.length === 2,
			`${question.id} must have two rounds`,
		);
		const roundIds = new Set();
		for (const round of question.rounds) {
			invariant(round && typeof round === "object", `${question.id} round must be an object`);
			invariant(typeof round.id === "string" && round.id.length > 0, `${question.id} round id is required`);
			invariant(!roundIds.has(round.id), `duplicate round id ${question.id}/${round.id}`);
			roundIds.add(round.id);
			invariant(
				typeof round.prompt === "string" && round.prompt.trim().length > 0,
				`${question.id}/${round.id} prompt is required`,
			);
			invariant(
				round.expectedLocalSource === question.localSource.path,
				`${question.id}/${round.id} must point to its local source`,
			);
		}
	}
	return value;
}

export async function loadMainlineFixture(file = DEFAULT_FIXTURE) {
	const parsed = JSON.parse(await readFile(file, "utf8"));
	return validateMainlineFixture(parsed);
}

function localDate(date = new Date()) {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

function messageText(message) {
	if (!message || !Array.isArray(message.content)) return "";
	return message.content
		.filter((block) => block?.type === "text")
		.map((block) => block.text)
		.join("\n");
}

/** Return every citation and whether its path is present in the local index. */
export function resolveCitations(text, localIndex) {
	const citations = [];
	const source = String(text ?? "");
	for (const match of source.matchAll(CITATION_PATTERN)) {
		const path = match[1].trim();
		if (!path) continue;
		citations.push({ path, resolved: localIndex.has(path) });
	}
	return {
		citations,
		resolved: citations.filter((citation) => citation.resolved).length,
	};
}

function localSearch(question, round, localIndex) {
	const path = round.expectedLocalSource;
	const source = localIndex.get(path);
	if (!source) {
		return { hit: false, path, reason: "source-not-found" };
	}
	return {
		hit: true,
		path,
		title: source.title,
		text: source.text,
		// The faux search is deliberately deterministic: fixture rounds carry the
		// expected source so this metric measures trace accounting, not ranking.
		query: round.prompt,
		questionId: question.id,
	};
}

function toolResult(toolCall, result) {
	return {
		role: "toolResult",
		toolCallId: toolCall.id,
		toolName: toolCall.name,
		content: [{ type: "text", text: JSON.stringify(result) }],
		isError: false,
		timestamp: Date.now(),
	};
}

async function runRound({ question, round, context, models, model, faux, localIndex, sessionId }) {
	const started = performance.now();
	context.messages.push({ role: "user", content: round.prompt, timestamp: Date.now() });
	const local = localSearch(question, round, localIndex);
	const providerStart = faux.state.callCount;
	faux.setResponses([
		(contextAtToolCall) => {
			const previous = contextAtToolCall.messages.at(-1);
			if (previous?.role !== "user") {
				throw new Error(`faux provider received an unexpected context for ${question.id}/${round.id}`);
			}
			return fauxAssistantMessage(fauxToolCall("knowledge_search", { query: round.prompt, limit: 1 }), {
				stopReason: "toolUse",
			});
		},
		(contextAtAnswer) => {
			const lastTool = contextAtAnswer.messages.at(-1);
			if (lastTool?.role !== "toolResult") {
				throw new Error(`faux provider did not receive a local tool result for ${question.id}/${round.id}`);
			}
			const answer = local.hit
				? `本地知识回答：${local.text} [[${local.path}]]`
				: "本地知识没有命中，无法完成本轮回答。";
			return fauxAssistantMessage(answer);
		},
	]);

	const first = await models.complete(model, context, { sessionId, cacheRetention: "none" });
	context.messages.push(first);
	const call = first.content.find((block) => block?.type === "toolCall");
	if (!call) throw new Error(`faux provider did not issue knowledge_search for ${question.id}/${round.id}`);
	const toolScope = call.name === "knowledge_search" ? "local" : "network";
	const trace = [
		{ type: "turn_start", questionId: question.id, roundId: round.id, prompt: round.prompt },
		{ type: "tool_call", toolName: call.name, scope: toolScope, arguments: call.arguments },
	];
	if (toolScope === "network") {
		throw new Error(`offline mainline fixture attempted network tool ${call.name}`);
	}
	const result = local.hit
		? { status: "ok", path: local.path, title: local.title, text: local.text }
		: { status: "miss", path: local.path };
	context.messages.push(toolResult(call, result));
	trace.push({
		type: "tool_result",
		toolName: call.name,
		scope: toolScope,
		hit: local.hit,
		path: local.path,
	});
	const final = await models.complete(model, context, { sessionId, cacheRetention: "none" });
	context.messages.push(final);
	const answer = messageText(final);
	const citationState = resolveCitations(answer, localIndex);
	const elapsedMs = performance.now() - started;
	const networkCalls = trace.filter(
		(event) => event.type === "tool_call" && event.scope === "network",
	).length;
	const localAnswer =
		trace.some((event) => event.type === "tool_result" && event.scope === "local" && event.hit === true) &&
		networkCalls === 0 &&
		final.stopReason === "stop";
	trace.push({
		type: "assistant_end",
		stopReason: final.stopReason,
		localAnswer,
		networkCalls,
		citations: citationState.citations,
	});
	return {
		questionId: question.id,
		roundId: round.id,
		prompt: round.prompt,
		localHit: local.hit,
		localAnswer,
		networkCalls,
		citations: citationState.citations,
		citationsResolved: citationState.resolved,
		elapsedMs,
		providerCalls: faux.state.callCount - providerStart,
		trace,
	};
}

function percentile(values, fraction) {
	if (!values.length) return 0;
	const sorted = [...values].sort((left, right) => left - right);
	const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
	return sorted[index];
}

/** Run all 40 rounds with a real offline faux provider and write an evidence report. */
export async function runMainlineEval({ fixture = DEFAULT_FIXTURE, output, now = new Date() } = {}) {
	const fixtureData = await loadMainlineFixture(fixture);
	const questions = fixtureData.questions;
	const localIndex = new Map(questions.map((question) => [question.localSource.path, question.localSource]));
	const faux = fauxProvider({ provider: "drone-mainline-offline", tokensPerSecond: 0 });
	const models = createModels();
	models.setProvider(faux.provider);
	const model = faux.getModel();
	const originalFetch = globalThis.fetch;
	let networkCalls = 0;
	// Any network use is a fixture failure. Counting before throwing leaves a
	// useful metric in the error message and protects CI from accidental I/O.
	globalThis.fetch = async () => {
		networkCalls++;
		throw new Error("mainline eval is offline: network access is disabled");
	};
	const started = performance.now();
	const rounds = [];
	try {
		for (const question of questions) {
			const context = { messages: [] };
			for (const round of question.rounds) {
				const row = await runRound({
					question,
					round,
					context,
					models,
					model,
					faux,
					localIndex,
					sessionId: `mainline-${question.id}`,
				});
				rounds.push(row);
			}
		}
	} finally {
		globalThis.fetch = originalFetch;
	}
	const elapsedMs = performance.now() - started;
	const localAnswers = rounds.filter((round) => round.localAnswer).length;
	const localHits = rounds.filter((round) => round.localHit).length;
	const networkToolCalls = rounds.reduce((total, round) => total + round.networkCalls, 0);
	const citationCount = rounds.reduce((total, round) => total + round.citations.length, 0);
	const citationsResolved = rounds.reduce((total, round) => total + round.citationsResolved, 0);
	const latencies = rounds.map((round) => round.elapsedMs);
	const report = {
		schema: 1,
		kind: "drone-mainline-eval",
		mode: "offline-faux-provider",
		fixture: relative(root, resolve(fixture)),
		generatedAt: now.toISOString(),
		provider: { id: faux.provider.id, model: model.id, calls: faux.state.callCount },
		metrics: {
			questions: questions.length,
			rounds: rounds.length,
			localHits,
			localAnswers,
			localHitRate: rounds.length ? localAnswers / rounds.length : 0,
			localAnswerRate: rounds.length ? localAnswers / rounds.length : 0,
			networkCalls: networkCalls + networkToolCalls,
			networkToolCalls,
			citations: citationCount,
			citationsResolved,
			citationResolvableRate: citationCount ? citationsResolved / citationCount : 0,
			elapsedMs,
			latencyMs: {
				mean: latencies.length ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length : 0,
				p50: percentile(latencies, 0.5),
				p95: percentile(latencies, 0.95),
				max: Math.max(0, ...latencies),
			},
		},
		rounds,
	};
	const reportPath = resolve(output || resolve(DEFAULT_OUTPUT_DIR, `mainline-${localDate(now)}.json`));
	await mkdir(dirname(reportPath), { recursive: true });
	await writeFile(reportPath, `${JSON.stringify(report, null, "\t")}\n`, "utf8");
	return { ...report, reportPath };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		const report = await runMainlineEval({ output: process.env.MAINLINE_EVAL_OUT });
		console.log(
			JSON.stringify(
				{
					report: report.reportPath,
					metrics: report.metrics,
				},
				null,
				2,
			),
		);
	} catch (error) {
		console.error(`[eval:mainline] ${error instanceof Error ? error.stack || error.message : String(error)}`);
		process.exitCode = 1;
	}
}
