/**
 * Jev judges similarity, code decides. Each candidate lesson gets one Noul (jev-questions.mjs); the
 * probability goes through classifySameCause, and the intake and query paths act on its label.
 */
import { LESSON_QUESTIONS } from "./jev-questions.mjs";

/**
 * The truth table every lesson decision reads: a Noul probability that two failures share a cause
 * becomes "same", "maybe" or "different". Intake merges only on "same"; a query lists "same" as known
 * and "maybe" as possible. SAME sits above TypeSafe's 0.7 starting point because a wrong merge fuses two
 * causes for good, while a missed merge only leaves a duplicate.
 */
export const SAME_CAUSE = { same: 0.8, different: 0.3 };

export function classifySameCause(probability) {
	if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
		throw new Error(`not a probability: ${probability}`);
	}
	if (probability >= SAME_CAUSE.same) return "same";
	if (probability <= SAME_CAUSE.different) return "different";
	return "maybe";
}

const questionId = (index) => `lesson_${index}`;

/** Ask Jev about each candidate; resolves to [{ lesson, probability, label }] in candidate order. */
export async function judgeCandidates(state, candidates, question, ask) {
	if (candidates.length === 0) return [];
	const questions = Object.fromEntries(
		candidates.map((lesson, index) => [questionId(index), LESSON_QUESTIONS[question](lesson)]),
	);
	const { answers } = await ask(state, questions);
	return candidates.map((lesson, index) => {
		const probability = answers[questionId(index)].noul;
		if (typeof probability !== "number") throw new Error(`Jev noul missing for ${lesson.id}`);
		return { lesson, probability, label: classifySameCause(probability) };
	});
}

/** Intake: merge into the best "same" lesson (sources and count), otherwise append the new one. */
export function mergeOrAdd(lessons, lesson, judged) {
	const best = judged
		.filter((entry) => entry.label === "same")
		.sort((a, b) => b.probability - a.probability)[0];
	if (best === undefined) return { lessons: [...lessons, lesson], merged: null };
	const merged = lessons.map((existing) =>
		existing.id === best.lesson.id
			? {
					...existing,
					sources: [...new Set([...existing.sources, ...lesson.sources])],
					count: existing.count + 1,
				}
			: existing,
	);
	return { lessons: merged, merged: best.lesson.id };
}
